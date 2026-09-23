import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import {
  DUST_AMT,
  type BitgetCredentials,
  BitgetApiError,
  bitgetRestRequest,
  formatAmt,
  parseAmt,
  sleep,
} from './bitget-rest.js';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const PERIOD_FLEXIBLE = 'flexible';

export const STABLE_CCYS = ['USDT', 'USDC'] as const;
export type StableCcy = (typeof STABLE_CCYS)[number];
export const WITHDRAW_AMTS = [50, 100, 200, 300, 500, 1000] as const;
export type WithdrawAmt = (typeof WITHDRAW_AMTS)[number];

type SpotAssetRow = {
  coin?: string;
  available?: string;
  frozen?: string;
  locked?: string;
  limitAvailable?: string;
};

type SavingsProductRow = {
  productId?: string;
  coin?: string;
  periodType?: string;
  status?: string;
  productLevel?: string;
};

type SavingsAssetRow = {
  productId?: string;
  orderId?: string;
  productCoin?: string;
  holdAmount?: string;
  status?: string;
  periodType?: string;
};

type SavingsAssetsPage = {
  resultList?: SavingsAssetRow[];
  endId?: string;
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
export class BitgetEarnFundService {
  private readonly logger = new Logger(BitgetEarnFundService.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly telegramService: TelegramService,
  ) {}

  async getStableBalances(): Promise<StableBalances> {
    const creds = await this.requireCredentials();
    const [usdtSpot, usdcSpot, usdtEarn, usdcEarn] = await Promise.all([
      this.getSpotAvail(creds, 'USDT'),
      this.getSpotAvail(creds, 'USDC'),
      this.getEarnBalance(creds, 'USDT').then((r) => r.amt),
      this.getEarnBalance(creds, 'USDC').then((r) => r.amt),
    ]);
    return {
      usdt: { spot: formatAmt(usdtSpot), earn: formatAmt(usdtEarn) },
      usdc: { spot: formatAmt(usdcSpot), earn: formatAmt(usdcEarn) },
    };
  }

  /** Deposit all free Spot of ccy into Flexible Savings. Throws on failure. */
  async depositAllSpot(ccy: StableCcy): Promise<StableBalances> {
    const creds = await this.requireCredentials();
    const avail = await this.getSpotAvail(creds, ccy);
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
    await this.redeemToSpot(creds, ccy, amt, `withdraw ${amt} ${ccy}`);
    return this.getStableBalances();
  }

  /**
   * Move amt of ccy Spot → Flexible Savings.
   * Never throws to caller; errors go to Telegram only.
   */
  async moveSpotToEarn(args: EarnMoveArgs): Promise<void> {
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
   * Redeem amt of ccy from Flexible Savings → Spot.
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

  private async purchaseToEarn(
    creds: BitgetCredentials,
    ccy: string,
    need: number,
    context: string,
  ): Promise<void> {
    const productId = await this.getFlexibleProductId(creds, ccy);
    if (!productId) {
      throw new BadRequestException(`no Flexible Savings product for ${ccy}`);
    }

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
          throw new BitgetApiError(
            `Spot avail ${formatAmt(avail)} < need ${formatAmt(need)}`,
          );
        }
        const purchaseAmt = formatAmt(Math.min(avail, need));
        if (parseAmt(purchaseAmt) <= DUST_AMT) {
          throw new BitgetApiError(`Purchase amount too small for ${ccy}`);
        }

        await bitgetRestRequest(creds, 'POST', '/api/v2/earn/savings/subscribe', {
          productId,
          periodType: PERIOD_FLEXIBLE,
          amount: purchaseAmt,
        });

        this.logger.log(
          `Bitget Earn subscribed ${purchaseAmt} ${ccy} (${context})`,
        );
        return;
      } catch (error) {
        lastError = (error as Error).message;
        this.logger.warn(
          `Bitget Spot→Earn ${ccy} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastError}`,
        );
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

    throw new BadRequestException(lastError || 'subscribe failed');
  }

  private async redeemToSpot(
    creds: BitgetCredentials,
    ccy: string,
    need: number,
    context: string,
  ): Promise<void> {
    const holdings = await this.listEarnHoldings(creds, ccy);
    const earnAmt = holdings.reduce((sum, row) => sum + parseAmt(row.holdAmount), 0);
    if (!holdings.length) {
      throw new BadRequestException(`no Flexible Savings holding for ${ccy}`);
    }
    if (earnAmt + DUST_AMT < need) {
      throw new BadRequestException(
        `Earn ${formatAmt(earnAmt)} < need ${formatAmt(need)}`,
      );
    }

    let remaining = need;
    for (const holding of holdings) {
      if (remaining <= DUST_AMT) break;
      const holdAmt = parseAmt(holding.holdAmount);
      if (holdAmt <= DUST_AMT || !holding.productId) continue;

      const redeemAmt = formatAmt(Math.min(holdAmt, remaining));
      if (parseAmt(redeemAmt) <= DUST_AMT) continue;

      const body: Record<string, string> = {
        productId: holding.productId,
        periodType: PERIOD_FLEXIBLE,
        amount: redeemAmt,
      };
      if (holding.orderId) body.orderId = holding.orderId;

      await bitgetRestRequest(creds, 'POST', '/api/v2/earn/savings/redeem', body);
      this.logger.log(
        `Bitget Earn redeem ${redeemAmt} ${ccy} product=${holding.productId} (${context})`,
      );
      remaining -= parseAmt(redeemAmt);
    }

    if (remaining > DUST_AMT) {
      throw new BadRequestException(
        `Earn redeem shortfall ${formatAmt(remaining)} ${ccy}`,
      );
    }
  }

  private async notifyError(context: string, ccy: string, detail: string) {
    this.logger.warn(`Bitget Earn ${context}: ${ccy}: ${detail}`);
    await this.telegramService.sendMessage(
      [`❌ Bitget Earn`, context, `${ccy}: ${detail}`].join('\n'),
    );
  }

  private async requireCredentials(): Promise<BitgetCredentials> {
    const creds = await this.getCredentials();
    if (!creds) {
      throw new BadRequestException('Bitget credentials missing');
    }
    return creds;
  }

  private async getCredentials(): Promise<BitgetCredentials | null> {
    const settings = await this.settingsService.getRaw();
    if (
      !settings.bitgetApiKey ||
      !settings.bitgetSecret ||
      !settings.bitgetPassphrase
    ) {
      return null;
    }
    return {
      apiKey: settings.bitgetApiKey,
      secret: settings.bitgetSecret,
      passphrase: settings.bitgetPassphrase,
    };
  }

  private async getSpotAvail(
    creds: BitgetCredentials,
    ccy: string,
  ): Promise<number> {
    const rows = await bitgetRestRequest<SpotAssetRow[]>(
      creds,
      'GET',
      `/api/v2/spot/account/assets?coin=${encodeURIComponent(ccy)}`,
    );
    const list = Array.isArray(rows) ? rows : [];
    const row = list.find((d) => d.coin === ccy) || list[0];
    return parseAmt(row?.available);
  }

  private async getEarnBalance(
    creds: BitgetCredentials,
    ccy: string,
  ): Promise<{ amt: number; productId: string | null }> {
    try {
      const holdings = await this.listEarnHoldings(creds, ccy);
      const amt = holdings.reduce(
        (sum, row) => sum + parseAmt(row.holdAmount),
        0,
      );
      return { amt, productId: holdings[0]?.productId || null };
    } catch (error) {
      this.logger.warn(
        `Bitget Earn balance ${ccy} failed: ${(error as Error).message}`,
      );
      return { amt: 0, productId: null };
    }
  }

  private async getFlexibleProductId(
    creds: BitgetCredentials,
    ccy: string,
  ): Promise<string | null> {
    try {
      const rows = await bitgetRestRequest<SavingsProductRow[]>(
        creds,
        'GET',
        `/api/v2/earn/savings/product?coin=${encodeURIComponent(ccy)}`,
      );
      const list = (Array.isArray(rows) ? rows : []).filter(
        (row) =>
          row.coin === ccy &&
          row.periodType === PERIOD_FLEXIBLE &&
          row.productId &&
          (row.status === 'in_progress' || !row.status),
      );
      if (!list.length) return null;

      const normal = list.find((row) => row.productLevel === 'normal');
      return (normal || list[0])!.productId || null;
    } catch (error) {
      if (error instanceof BitgetApiError) {
        this.logger.debug(
          `Bitget Earn product ${ccy}: ${error.message} (${error.code || '-'})`,
        );
        return null;
      }
      throw error;
    }
  }

  private async listEarnHoldings(
    creds: BitgetCredentials,
    ccy: string,
  ): Promise<SavingsAssetRow[]> {
    const matched: SavingsAssetRow[] = [];
    let idLessThan: string | undefined;

    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({
        periodType: PERIOD_FLEXIBLE,
        limit: '100',
      });
      if (idLessThan) qs.set('idLessThan', idLessThan);

      const data = await bitgetRestRequest<SavingsAssetsPage>(
        creds,
        'GET',
        `/api/v2/earn/savings/assets?${qs.toString()}`,
      );
      const rows = data?.resultList || [];
      for (const row of rows) {
        if (
          row.productCoin === ccy &&
          (row.periodType === PERIOD_FLEXIBLE || !row.periodType) &&
          parseAmt(row.holdAmount) > DUST_AMT
        ) {
          matched.push(row);
        }
      }

      if (!rows.length || !data?.endId || data.endId === idLessThan) break;
      idLessThan = data.endId;
    }

    return matched;
  }

  private isRetryableBalanceError(msg: string): boolean {
    const m = msg.toLowerCase();
    return m.includes('insufficient') || m.includes('balance');
  }
}
