import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import {
  DUST_AMT,
  type GateCredentials,
  GateApiError,
  formatAmt,
  gateRestRequest,
  parseAmt,
  sleep,
} from './gate-rest.js';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const DEFAULT_MIN_RATE = '0.0001';

export const STABLE_CCYS = ['USDT', 'USDC'] as const;
export type StableCcy = (typeof STABLE_CCYS)[number];
export const WITHDRAW_AMTS = [50, 100, 200, 300, 500, 1000] as const;
export type WithdrawAmt = (typeof WITHDRAW_AMTS)[number];

type SpotAccountRow = {
  currency?: string;
  available?: string;
  locked?: string;
};

type UniLendRow = {
  currency?: string;
  amount?: string;
  last_lend_time?: number;
};

type UniCurrencyRow = {
  currency?: string;
  min_rate?: string;
  max_rate?: string;
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

export type AssetHolding = {
  ccy: string;
  trading: string;
  earn: string;
};

export type AssetHoldings = {
  assets: AssetHolding[];
};

const STABLE_FIRST = ['USDT', 'USDC'];

function mergeHoldings(
  trading: Map<string, number>,
  earn: Map<string, number>,
): AssetHolding[] {
  const ccys = new Set([...trading.keys(), ...earn.keys()]);
  const assets: AssetHolding[] = [];
  for (const ccy of ccys) {
    const tradingAmt = trading.get(ccy) || 0;
    const earnAmt = earn.get(ccy) || 0;
    if (tradingAmt <= DUST_AMT && earnAmt <= DUST_AMT) continue;
    assets.push({
      ccy,
      trading: formatAmt(tradingAmt),
      earn: formatAmt(earnAmt),
    });
  }
  assets.sort((a, b) => {
    const ia = STABLE_FIRST.indexOf(a.ccy);
    const ib = STABLE_FIRST.indexOf(b.ccy);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a.ccy.localeCompare(b.ccy);
  });
  return assets;
}

@Injectable()
export class GateEarnFundService {
  private readonly logger = new Logger(GateEarnFundService.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly telegramService: TelegramService,
  ) {}

  async getStableBalances(): Promise<StableBalances> {
    const creds = await this.requireCredentials();
    const [usdtSpot, usdcSpot, usdtEarn, usdcEarn] = await Promise.all([
      this.getSpotAvail(creds, 'USDT'),
      this.getSpotAvail(creds, 'USDC'),
      this.getEarnBalance(creds, 'USDT'),
      this.getEarnBalance(creds, 'USDC'),
    ]);
    return {
      usdt: { spot: formatAmt(usdtSpot), earn: formatAmt(usdtEarn) },
      usdc: { spot: formatAmt(usdcSpot), earn: formatAmt(usdcEarn) },
    };
  }

  async getHoldings(): Promise<AssetHoldings> {
    const creds = await this.requireCredentials();
    const [trading, earn] = await Promise.all([
      this.listTradingBalances(creds),
      this.listEarnBalances(creds),
    ]);
    return { assets: mergeHoldings(trading, earn) };
  }

  /** Deposit all free Spot of ccy into Simple Earn Uni. Throws on failure. */
  async depositAllSpot(ccy: StableCcy): Promise<StableBalances> {
    const creds = await this.requireCredentials();
    const avail = await this.getSpotAvail(creds, ccy);
    if (avail <= DUST_AMT) {
      throw new BadRequestException(`No free Spot ${ccy} to deposit`);
    }
    await this.lendToEarn(creds, ccy, avail, `deposit all ${ccy}`);
    return this.getStableBalances();
  }

  /** Withdraw fixed amt from Earn to Spot. Throws on failure. */
  async withdrawSpot(
    ccy: StableCcy,
    amt: WithdrawAmt,
  ): Promise<StableBalances> {
    const creds = await this.requireCredentials();
    await this.redeemToSpot(creds, ccy, amt, `withdraw ${amt} ${ccy}`);
    return this.getStableBalances();
  }

  /**
   * Move amt of ccy Spot → Simple Earn Uni.
   * Never throws to caller; errors go to Telegram only.
   */
  async moveSpotToEarn(args: EarnMoveArgs): Promise<void> {
    const { ccy, context } = args;
    const need = args.amt;
    if (!ccy || need <= DUST_AMT) return;

    try {
      const creds = await this.requireCredentials();
      await this.lendToEarn(creds, ccy, need, context);
    } catch (error) {
      await this.notifyError(context, ccy, (error as Error).message);
    }
  }

  /**
   * Redeem amt of ccy from Simple Earn Uni → Spot.
   * Never throws to caller; errors go to Telegram only.
   */
  async moveEarnToSpot(args: EarnMoveArgs): Promise<void> {
    const { ccy, context } = args;
    const need = args.amt;
    if (!ccy || need <= DUST_AMT) return;

    try {
      const creds = await this.requireCredentials();
      await this.redeemToSpot(creds, ccy, need, context);
    } catch (error) {
      await this.notifyError(context, ccy, (error as Error).message);
    }
  }

  private async lendToEarn(
    creds: GateCredentials,
    ccy: string,
    need: number,
    context: string,
  ): Promise<void> {
    const minRate = await this.getMinRate(creds, ccy);
    const spotAvail = await this.getSpotAvail(creds, ccy);
    if (spotAvail + DUST_AMT < need) {
      throw new BadRequestException(
        `Spot avail ${formatAmt(spotAvail)} < need ${formatAmt(need)}`,
      );
    }

    let lastError: string | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const avail = await this.getSpotAvail(creds, ccy);
        if (avail + DUST_AMT < need) {
          throw new GateApiError(
            `Spot avail ${formatAmt(avail)} < need ${formatAmt(need)}`,
          );
        }
        const lendAmt = formatAmt(Math.min(avail, need));
        if (parseAmt(lendAmt) <= DUST_AMT) {
          throw new GateApiError(`Lend amount too small for ${ccy}`);
        }

        await gateRestRequest(creds, 'POST', '/earn/uni/lends', {
          currency: ccy,
          amount: lendAmt,
          type: 'lend',
          min_rate: minRate,
        });

        this.logger.log(`Gate Earn lent ${lendAmt} ${ccy} (${context})`);
        return;
      } catch (error) {
        lastError = (error as Error).message;
        this.logger.warn(
          `Gate Spot→Earn ${ccy} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastError}`,
        );
        if (attempt < MAX_ATTEMPTS && this.isRetryableBalanceError(lastError)) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }

    throw new BadRequestException(lastError || 'lend failed');
  }

  private async redeemToSpot(
    creds: GateCredentials,
    ccy: string,
    need: number,
    context: string,
  ): Promise<void> {
    const earnAmt = await this.getEarnBalance(creds, ccy);
    if (earnAmt <= DUST_AMT) {
      throw new BadRequestException(`no Simple Earn holding for ${ccy}`);
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

    await gateRestRequest(creds, 'POST', '/earn/uni/lends', {
      currency: ccy,
      amount: redeemAmt,
      type: 'redeem',
    });
    this.logger.log(`Gate Earn redeem ${redeemAmt} ${ccy} (${context})`);
  }

  private async notifyError(context: string, ccy: string, detail: string) {
    this.logger.warn(`Gate Earn ${context}: ${ccy}: ${detail}`);
    await this.telegramService.sendMessage(
      [`❌ Gate Earn`, context, `${ccy}: ${detail}`].join('\n'),
    );
  }

  private async requireCredentials(): Promise<GateCredentials> {
    const creds = await this.getCredentials();
    if (!creds) {
      throw new BadRequestException('Gate credentials missing');
    }
    return creds;
  }

  private async getCredentials(): Promise<GateCredentials | null> {
    const settings = await this.settingsService.getRaw();
    if (!settings.gateApiKey || !settings.gateSecret) return null;
    return {
      apiKey: settings.gateApiKey,
      secret: settings.gateSecret,
    };
  }

  private async listTradingBalances(
    creds: GateCredentials,
  ): Promise<Map<string, number>> {
    const rows = await gateRestRequest<SpotAccountRow[]>(
      creds,
      'GET',
      '/spot/accounts',
    );
    const map = new Map<string, number>();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row.currency) continue;
      const amt = parseAmt(row.available) + parseAmt(row.locked);
      if (amt > DUST_AMT) map.set(row.currency, amt);
    }
    return map;
  }

  private async listEarnBalances(
    creds: GateCredentials,
  ): Promise<Map<string, number>> {
    try {
      const rows = await this.listUniLends(creds);
      const map = new Map<string, number>();
      for (const row of rows) {
        if (!row.currency) continue;
        const amt = parseAmt(row.amount);
        if (amt <= DUST_AMT) continue;
        map.set(row.currency, (map.get(row.currency) || 0) + amt);
      }
      return map;
    } catch (error) {
      this.logger.warn(
        `Gate Earn balances failed: ${(error as Error).message}`,
      );
      return new Map();
    }
  }

  private async getSpotAvail(
    creds: GateCredentials,
    ccy: string,
  ): Promise<number> {
    const rows = await gateRestRequest<SpotAccountRow[]>(
      creds,
      'GET',
      `/spot/accounts?currency=${encodeURIComponent(ccy)}`,
    );
    const list = Array.isArray(rows) ? rows : [];
    const row = list.find((d) => d.currency === ccy) || list[0];
    return parseAmt(row?.available);
  }

  private async getEarnBalance(
    creds: GateCredentials,
    ccy: string,
  ): Promise<number> {
    try {
      const rows = await this.listUniLends(creds, ccy);
      return rows.reduce((sum, row) => sum + parseAmt(row.amount), 0);
    } catch (error) {
      this.logger.warn(
        `Gate Earn balance ${ccy} failed: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  private async listUniLends(
    creds: GateCredentials,
    ccy?: string,
  ): Promise<UniLendRow[]> {
    const qs = new URLSearchParams({ limit: '100' });
    if (ccy) qs.set('currency', ccy);
    const rows = await gateRestRequest<UniLendRow[]>(
      creds,
      'GET',
      `/earn/uni/lends?${qs.toString()}`,
    );
    return (Array.isArray(rows) ? rows : []).filter(
      (row) => parseAmt(row.amount) > DUST_AMT,
    );
  }

  private async getMinRate(
    creds: GateCredentials,
    ccy: string,
  ): Promise<string> {
    try {
      const row = await gateRestRequest<UniCurrencyRow>(
        creds,
        'GET',
        `/earn/uni/currencies/${encodeURIComponent(ccy)}`,
      );
      if (row?.min_rate && parseAmt(row.min_rate) >= 0) {
        return String(row.min_rate);
      }
    } catch (error) {
      this.logger.debug(
        `Gate Earn min_rate ${ccy}: ${(error as Error).message}`,
      );
    }
    return DEFAULT_MIN_RATE;
  }

  private isRetryableBalanceError(msg: string): boolean {
    const m = msg.toLowerCase();
    return m.includes('insufficient') || m.includes('balance');
  }
}
