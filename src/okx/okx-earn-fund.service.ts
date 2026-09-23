import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import {
  DUST_AMT,
  type OkxCredentials,
  OkxApiError,
  formatAmt,
  okxRestRequest,
  parseAmt,
  sleep,
} from './okx-rest.js';

/** OKX account ids for POST /api/v5/asset/transfer */
const ACCT_FUNDING = '6';
const ACCT_TRADING = '18';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

export const STABLE_CCYS = ['USDT', 'USDC'] as const;
export type StableCcy = (typeof STABLE_CCYS)[number];
export const WITHDRAW_AMTS = [50, 100, 200] as const;
export type WithdrawAmt = (typeof WITHDRAW_AMTS)[number];

type BalanceDetail = {
  ccy?: string;
  availBal?: string;
};

type BalanceRow = {
  details?: BalanceDetail[];
};

type LendingRateRow = {
  ccy?: string;
  avgApr?: string;
  estRate?: string;
  preRate?: string;
};

type SavingsBalanceRow = {
  ccy?: string;
  amt?: string;
  rate?: string;
};

type FundingBalanceRow = {
  ccy?: string;
  availBal?: string;
  bal?: string;
};

export type EarnMoveArgs = {
  ccy: string;
  amt: number;
  /** Short label for Telegram, e.g. "stake BUY XAUT-USDT #12" */
  context: string;
};

export type StableBalances = {
  usdt: { spot: string; earn: string };
  usdc: { spot: string; earn: string };
};

@Injectable()
export class OkxEarnFundService {
  private readonly logger = new Logger(OkxEarnFundService.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly telegramService: TelegramService,
  ) {}

  async getStableBalances(): Promise<StableBalances> {
    const creds = await this.requireCredentials();
    const [usdtSpot, usdcSpot, usdtEarn, usdcEarn] = await Promise.all([
      this.getTradingAvail(creds, 'USDT'),
      this.getTradingAvail(creds, 'USDC'),
      this.getEarnBalance(creds, 'USDT').then((r) => r.amt),
      this.getEarnBalance(creds, 'USDC').then((r) => r.amt),
    ]);
    return {
      usdt: { spot: formatAmt(usdtSpot), earn: formatAmt(usdtEarn) },
      usdc: { spot: formatAmt(usdcSpot), earn: formatAmt(usdcEarn) },
    };
  }

  /** Deposit all free Spot of ccy into Simple Earn. Throws on failure. */
  async depositAllSpot(ccy: StableCcy): Promise<StableBalances> {
    const creds = await this.requireCredentials();
    const avail = await this.getTradingAvail(creds, ccy);
    if (avail <= DUST_AMT) {
      throw new BadRequestException(`No free Spot ${ccy} to deposit`);
    }
    await this.purchaseToEarn(creds, ccy, avail, `deposit all ${ccy}`);
    return this.getStableBalances();
  }

  /** Withdraw fixed amt from Earn to Spot. Throws on failure. */
  async withdrawSpot(
    ccy: StableCcy,
    amt: WithdrawAmt,
  ): Promise<StableBalances> {
    const creds = await this.requireCredentials();
    await this.redeemToTrading(creds, ccy, amt, `withdraw ${amt} ${ccy}`);
    return this.getStableBalances();
  }

  /**
   * Move amt of ccy Trading → Funding → Simple Earn purchase.
   * Never throws to caller; errors go to Telegram only.
   */
  async moveTradingToEarn(args: EarnMoveArgs): Promise<void> {
    const { ccy, context } = args;
    const need = args.amt;
    if (!ccy || need <= DUST_AMT) return;

    try {
      const creds = await this.requireCredentials();
      await this.purchaseToEarn(creds, ccy, need, context);
    } catch (error) {
      await this.notifyError(context, ccy, (error as Error).message);
    }
  }

  /**
   * Redeem amt of ccy from Simple Earn → Funding → Trading.
   * Never throws to caller; errors go to Telegram only.
   */
  async moveEarnToTrading(args: EarnMoveArgs): Promise<void> {
    const { ccy, context } = args;
    const need = args.amt;
    if (!ccy || need <= DUST_AMT) return;

    try {
      const creds = await this.requireCredentials();
      await this.redeemToTrading(creds, ccy, need, context);
    } catch (error) {
      await this.notifyError(context, ccy, (error as Error).message);
    }
  }

  private async purchaseToEarn(
    creds: OkxCredentials,
    ccy: string,
    need: number,
    context: string,
  ): Promise<void> {
    const rate = await this.getEarnRate(creds, ccy);
    if (!rate) {
      throw new BadRequestException(`no Simple Earn product for ${ccy}`);
    }

    const tradingAvail = await this.getTradingAvail(creds, ccy);
    if (tradingAvail + DUST_AMT < need) {
      throw new BadRequestException(
        `Trading avail ${formatAmt(tradingAvail)} < need ${formatAmt(need)}`,
      );
    }

    let lastError: string | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const avail = await this.getTradingAvail(creds, ccy);
        if (avail + DUST_AMT < need) {
          throw new OkxApiError(
            `Trading avail ${formatAmt(avail)} < need ${formatAmt(need)}`,
          );
        }
        const wanted = formatAmt(Math.min(avail, need));
        await this.transfer(creds, ccy, wanted, ACCT_TRADING, ACCT_FUNDING);

        let fundingAvail = 0;
        for (let poll = 0; poll < 6; poll++) {
          if (poll > 0) await sleep(1000);
          fundingAvail = await this.getFundingAvail(creds, ccy);
          if (fundingAvail > DUST_AMT) break;
        }
        if (fundingAvail <= DUST_AMT) {
          throw new OkxApiError(
            `Funding empty after transfer of ${wanted} ${ccy}`,
          );
        }

        const purchaseAmt = formatAmt(
          Math.min(parseAmt(wanted), fundingAvail),
        );
        if (parseAmt(purchaseAmt) <= DUST_AMT) {
          throw new OkxApiError(`Purchase amount too small for ${ccy}`);
        }

        await okxRestRequest(
          creds,
          'POST',
          '/api/v5/finance/savings/purchase-redempt',
          {
            ccy,
            amt: purchaseAmt,
            side: 'purchase',
            rate,
          },
        );

        this.logger.log(
          `OKX Earn purchased ${purchaseAmt} ${ccy} (${context})`,
        );
        return;
      } catch (error) {
        lastError = (error as Error).message;
        this.logger.warn(
          `OKX Trading→Earn ${ccy} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastError}`,
        );
        await this.rollbackFundingToTrading(creds, ccy);
        if (
          attempt < MAX_ATTEMPTS &&
          this.isRetryableBalanceError(lastError)
        ) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }

    throw new BadRequestException(lastError || 'purchase failed');
  }

  private async redeemToTrading(
    creds: OkxCredentials,
    ccy: string,
    need: number,
    context: string,
  ): Promise<void> {
    const { amt: earnAmt, rate } = await this.getEarnBalance(creds, ccy);
    if (!rate) {
      throw new BadRequestException(`no Simple Earn product for ${ccy}`);
    }
    if (earnAmt + DUST_AMT < need) {
      throw new BadRequestException(
        `Earn ${formatAmt(earnAmt)} < need ${formatAmt(need)}`,
      );
    }

    const redeemAmt = formatAmt(Math.min(earnAmt, need));
    if (parseAmt(redeemAmt) <= DUST_AMT) {
      throw new BadRequestException(`Redeem amount too small for ${ccy}`);
    }

    await okxRestRequest(
      creds,
      'POST',
      '/api/v5/finance/savings/purchase-redempt',
      {
        ccy,
        amt: redeemAmt,
        side: 'redempt',
        rate,
      },
    );
    this.logger.log(`OKX Earn redeem ${redeemAmt} ${ccy} (${context})`);

    await this.moveFundingToTrading(creds, ccy, need);
  }

  private async notifyError(context: string, ccy: string, detail: string) {
    this.logger.warn(`OKX Earn ${context}: ${ccy}: ${detail}`);
    await this.telegramService.sendMessage(
      [`❌ OKX Earn`, context, `${ccy}: ${detail}`].join('\n'),
    );
  }

  private async requireCredentials(): Promise<OkxCredentials> {
    const creds = await this.getCredentials();
    if (!creds) {
      throw new BadRequestException('OKX credentials missing');
    }
    return creds;
  }

  private async getCredentials(): Promise<OkxCredentials | null> {
    const settings = await this.settingsService.getRaw();
    if (!settings.okxApiKey || !settings.okxSecret || !settings.okxPassphrase) {
      return null;
    }
    return {
      apiKey: settings.okxApiKey,
      secret: settings.okxSecret,
      passphrase: settings.okxPassphrase,
    };
  }

  private async getTradingAvail(
    creds: OkxCredentials,
    ccy: string,
  ): Promise<number> {
    const rows = await okxRestRequest<BalanceRow[]>(
      creds,
      'GET',
      '/api/v5/account/balance',
    );
    const details = rows[0]?.details || [];
    const row = details.find((d) => d.ccy === ccy);
    return parseAmt(row?.availBal);
  }

  private async getEarnBalance(
    creds: OkxCredentials,
    ccy: string,
  ): Promise<{ amt: number; rate: string | null }> {
    try {
      const rows = await okxRestRequest<SavingsBalanceRow[]>(
        creds,
        'GET',
        `/api/v5/finance/savings/balance?ccy=${encodeURIComponent(ccy)}`,
      );
      const row = rows.find((r) => r.ccy === ccy) || rows[0];
      const amt = parseAmt(row?.amt);
      const rate = row?.rate || (await this.getEarnRate(creds, ccy));
      return { amt, rate };
    } catch (error) {
      this.logger.warn(
        `OKX Earn balance ${ccy} failed: ${(error as Error).message}`,
      );
      return { amt: 0, rate: null };
    }
  }

  private async getEarnRate(
    creds: OkxCredentials,
    ccy: string,
  ): Promise<string | null> {
    try {
      const rows = await okxRestRequest<LendingRateRow[]>(
        creds,
        'GET',
        `/api/v5/finance/savings/lending-rate-summary?ccy=${encodeURIComponent(ccy)}`,
      );
      const row = rows.find((r) => r.ccy === ccy) || rows[0];
      if (!row) return null;
      const rate = row.estRate || row.preRate || row.avgApr;
      return rate && parseAmt(rate) >= 0 ? rate : null;
    } catch (error) {
      if (error instanceof OkxApiError) {
        this.logger.debug(
          `OKX Earn rate ${ccy}: ${error.message} (${error.code || '-'})`,
        );
        return null;
      }
      throw error;
    }
  }

  private async getFundingAvail(
    creds: OkxCredentials,
    ccy: string,
  ): Promise<number> {
    const rows = await okxRestRequest<FundingBalanceRow[]>(
      creds,
      'GET',
      `/api/v5/asset/balances?ccy=${encodeURIComponent(ccy)}`,
    );
    const row = rows.find((r) => r.ccy === ccy) || rows[0];
    const avail = parseAmt(row?.availBal);
    if (avail > DUST_AMT) return avail;
    return parseAmt(row?.bal);
  }

  private async moveFundingToTrading(
    creds: OkxCredentials,
    ccy: string,
    need: number,
  ): Promise<number> {
    let trading = 0;
    let funding = 0;

    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt > 0) await sleep(1000);
      trading = await this.getTradingAvail(creds, ccy);
      funding = await this.getFundingAvail(creds, ccy);
      this.logger.log(
        `OKX post-redeem ${ccy}: trading=${formatAmt(trading)} funding=${formatAmt(funding)} (try ${attempt + 1})`,
      );
      if (trading >= need - DUST_AMT) return trading;
      if (funding > DUST_AMT) break;
    }

    if (funding > DUST_AMT) {
      const move = formatAmt(
        Math.min(funding, Math.max(need - trading, funding)),
      );
      try {
        await this.transfer(creds, ccy, move, ACCT_FUNDING, ACCT_TRADING);
        await sleep(800);
        trading = await this.getTradingAvail(creds, ccy);
      } catch (error) {
        this.logger.warn(
          `OKX transfer to trading ${ccy} failed: ${(error as Error).message}`,
        );
        trading = await this.getTradingAvail(creds, ccy);
      }
    }

    return trading;
  }

  private async rollbackFundingToTrading(
    creds: OkxCredentials,
    ccy: string,
  ): Promise<void> {
    try {
      const funding = await this.getFundingAvail(creds, ccy);
      if (funding > DUST_AMT) {
        await this.transfer(
          creds,
          ccy,
          formatAmt(funding),
          ACCT_FUNDING,
          ACCT_TRADING,
        );
      }
    } catch (rollbackErr) {
      this.logger.warn(
        `OKX Earn rollback transfer ${ccy} failed: ${(rollbackErr as Error).message}`,
      );
    }
  }

  private async transfer(
    creds: OkxCredentials,
    ccy: string,
    amt: string,
    from: string,
    to: string,
  ): Promise<void> {
    if (parseAmt(amt) <= DUST_AMT) return;
    await okxRestRequest(creds, 'POST', '/api/v5/asset/transfer', {
      ccy,
      amt,
      from,
      to,
      type: '0',
    });
    this.logger.log(
      `OKX transfer ${amt} ${ccy}: ${from === ACCT_TRADING ? 'trading' : 'funding'} → ${to === ACCT_TRADING ? 'trading' : 'funding'}`,
    );
  }

  private isRetryableBalanceError(msg: string): boolean {
    const m = msg.toLowerCase();
    return m.includes('insufficient') || m.includes('balance');
  }
}
