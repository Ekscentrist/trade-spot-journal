import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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

const POST_FILL_DELAY_MS = 3000;
const RETRY_DELAY_MS = 2000;
const MAX_ATTEMPTS = 3;

/** Extra redeemed above liab so dust/rounding (e.g. 0.01 USDT) still gets repaid. */
const STABLE_REDEEM_BUFFER = 0.05;
const STABLE_CCY = new Set(['USDT', 'USDC', 'USD', 'EUR']);

function redeemBuffer(ccy: string, remaining: number): number {
  if (STABLE_CCY.has(ccy.toUpperCase())) return STABLE_REDEEM_BUFFER;
  // ~1% for crypto so we don't pull a huge absolute amount
  return Math.max(remaining * 0.01, DUST_AMT * 10);
}

/** Treat sub-cent USDT leftovers as still needing a full clear attempt. */
const CLEAR_LIAB_EPS = 1e-6;

type BalanceDetail = {
  ccy?: string;
  availBal?: string;
  cashBal?: string;
  liab?: string;
  crossLiab?: string;
  isoLiab?: string;
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
  pendingAmt?: string;
};

type FundingBalanceRow = {
  ccy?: string;
  availBal?: string;
  bal?: string;
};

export type ScheduleAfterFillArgs = {
  side: string;
  ccy: string;
  /** Quote currency from instId, e.g. USDT from BTC-USDT */
  quoteCcy?: string;
  ordId: string;
  fillSz?: string | null;
};

@Injectable()
export class OkxEarnService implements OnModuleDestroy {
  private readonly logger = new Logger(OkxEarnService.name);
  private readonly pendingByOrdId = new Map<string, NodeJS.Timeout[]>();
  /** Serialize settle jobs — spot-manual-borrow-repay is 1 req / 3s. */
  private settleChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly telegramService: TelegramService,
  ) {}

  onModuleDestroy() {
    for (const timers of this.pendingByOrdId.values()) {
      for (const t of timers) clearTimeout(t);
    }
    this.pendingByOrdId.clear();
  }

  /**
   * After a live fill: wait POST_FILL_DELAY_MS, then run deposit / settle.
   * Buy: deposit base coin + settle liabilities (parallel).
   * Sell: settle sold-coin liability first, then deposit USDT/USDC proceeds to Earn.
   */
  scheduleAfterFill(args: ScheduleAfterFillArgs): void {
    const { side, ccy, quoteCcy, ordId } = args;
    if (!ordId || !ccy) return;

    if (this.pendingByOrdId.has(ordId)) {
      this.logger.debug(`OKX post-fill already scheduled for ${ordId}, skip`);
      return;
    }

    const timer = setTimeout(() => {
      this.pendingByOrdId.delete(ordId);
      this.logger.log(`OKX post-fill running: ${side} ${ccy} ord=${ordId}`);

      if (side === 'buy') {
        void this.runDepositJob(ccy);
        void this.enqueueSettleJob(undefined);
        return;
      }

      if (side === 'sell') {
        // Repay base-coin debt from Earn first; then park quote proceeds (any ccy) in Earn.
        void this.enqueueSettleJob(ccy).finally(() => {
          if (quoteCcy && quoteCcy.toUpperCase() !== ccy.toUpperCase()) {
            void this.runDepositJob(quoteCcy);
          }
        });
      }
    }, POST_FILL_DELAY_MS);

    this.pendingByOrdId.set(ordId, [timer]);
    this.logger.log(
      `OKX post-fill scheduled in ${POST_FILL_DELAY_MS}ms: ${side} ${ccy}` +
        (quoteCcy ? `/${quoteCcy}` : '') +
        ` ord=${ordId}`,
    );
  }

  private async runDepositJob(ccy: string): Promise<void> {
    try {
      await this.depositToEarnIfPossible(ccy);
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`OKX deposit job ${ccy} crashed: ${msg}`);
      void this.telegramService.sendMessage(
        `OKX Earn purchase failed\n${ccy}: ${msg}`,
      );
    }
  }

  /** Queue settle so parallel triggers never hit repay rate limit together. */
  private enqueueSettleJob(preferCcy?: string): Promise<void> {
    const run = this.settleChain.then(() => this.runSettleJob(preferCcy));
    this.settleChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runSettleJob(preferCcy?: string): Promise<void> {
    // Liabilities from a fresh buy can appear a few seconds after fill.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const settled = await this.settleLiabilities(preferCcy);
        if (settled > 0) return;
        if (attempt < 5) {
          this.logger.log(
            `OKX settle: no liabilities yet (try ${attempt}/5), wait ${RETRY_DELAY_MS}ms`,
          );
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        this.logger.log('OKX settle: no liabilities after retries');
        return;
      } catch (error) {
        const msg = (error as Error).message;
        this.logger.warn(`OKX settle job attempt ${attempt}/5: ${msg}`);
        if (
          attempt < 5 &&
          (this.isRetryableBalanceError(msg) || this.isRateLimitError(msg))
        ) {
          await sleep(this.isRateLimitError(msg) ? 3500 : RETRY_DELAY_MS);
          continue;
        }
        void this.telegramService.sendMessage(`OKX settle failed\n${msg}`);
        return;
      }
    }
  }

  private isRetryableBalanceError(msg: string): boolean {
    const m = msg.toLowerCase();
    return m.includes('insufficient') || m.includes('balance');
  }

  private isRateLimitError(msg: string): boolean {
    const m = msg.toLowerCase();
    return (
      m.includes('too many requests') ||
      m.includes('rate limit') ||
      m.includes('50011')
    );
  }

  /**
   * Move trading → funding, then Simple Earn purchase if available.
   * @returns true on purchase success, false on skip, throws on hard failure after internal handling
   */
  async depositToEarnIfPossible(ccy: string): Promise<boolean> {
    const creds = await this.getCredentials();
    if (!creds || !ccy) return false;

    const rate = await this.getEarnRate(creds, ccy);
    if (!rate) {
      this.logger.log(`OKX Earn: ${ccy} has no Simple Earn product, skip`);
      return false;
    }

    let tradingAvail = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await sleep(1000);
      tradingAvail = await this.getTradingAvail(creds, ccy);
      if (tradingAvail > DUST_AMT) break;
    }

    if (tradingAvail <= DUST_AMT) {
      this.logger.log(
        `OKX Earn: ${ccy} trading avail too small (${tradingAvail}), skip`,
      );
      return false;
    }

    let wanted = formatAmt(tradingAvail);
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        tradingAvail = await this.getTradingAvail(creds, ccy);
        if (tradingAvail <= DUST_AMT) {
          this.logger.log(`OKX Earn: ${ccy} trading empty on attempt ${attempt}`);
          break;
        }
        wanted = formatAmt(tradingAvail);

        await this.transfer(creds, ccy, wanted, ACCT_TRADING, ACCT_FUNDING);

        let fundingAvail = 0;
        for (let poll = 0; poll < 6; poll++) {
          if (poll > 0) await sleep(1000);
          fundingAvail = await this.getFundingAvail(creds, ccy);
          this.logger.log(
            `OKX Earn funding poll ${ccy}: ${formatAmt(fundingAvail)} (try ${poll + 1})`,
          );
          if (fundingAvail > DUST_AMT) break;
        }

        if (fundingAvail <= DUST_AMT) {
          throw new OkxApiError(
            `Funding balance still empty after transfer of ${wanted} ${ccy}`,
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
        this.logger.log(`OKX Earn: purchased ${purchaseAmt} ${ccy}`);
        void this.telegramService.sendMessage(
          `OKX Earn purchase\n${purchaseAmt} ${ccy}`,
        );
        // Buy can create USDT liability with a delay — queue another settle (serialized).
        void this.enqueueSettleJob().catch((err) => {
          this.logger.warn(
            `OKX settle after deposit failed: ${(err as Error).message}`,
          );
        });
        return true;
      } catch (error) {
        lastError = (error as Error).message;
        this.logger.warn(
          `OKX Earn purchase ${ccy} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastError}`,
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

    void this.telegramService.sendMessage(
      `OKX Earn purchase failed\n${ccy}: ${lastError || 'unknown'}`,
    );
    return false;
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

  /**
   * After any fill: redeem from Earn → funding→trading → repay Spot liabilities.
   * @returns number of currencies with liab > 0 that were processed (0 = nothing to do)
   */
  async settleLiabilities(preferCcy?: string): Promise<number> {
    const creds = await this.getCredentials();
    if (!creds) return 0;

    let details: BalanceDetail[];
    try {
      details = await this.getBalanceDetails(creds);
    } catch (error) {
      this.logger.warn(
        `OKX liability scan failed: ${(error as Error).message}`,
      );
      throw error;
    }

    const debts = details
      .map((d) => ({
        ccy: d.ccy || '',
        liab: Math.max(
          parseAmt(d.liab),
          parseAmt(d.crossLiab),
          parseAmt(d.isoLiab),
        ),
      }))
      .filter((d) => d.ccy && d.liab > DUST_AMT);

    if (debts.length === 0) {
      return 0;
    }

    this.logger.log(
      `OKX settle: liabilities ${debts.map((d) => `${d.ccy}=${formatAmt(d.liab)}`).join(', ')}`,
    );

    debts.sort((a, b) => {
      if (preferCcy) {
        if (a.ccy === preferCcy && b.ccy !== preferCcy) return -1;
        if (b.ccy === preferCcy && a.ccy !== preferCcy) return 1;
      }
      return a.ccy.localeCompare(b.ccy);
    });

    for (let i = 0; i < debts.length; i++) {
      if (i > 0) await sleep(3100); // spot-manual-borrow-repay: 1 req / 3s
      await this.settleOne(creds, debts[i].ccy, debts[i].liab);
    }
    return debts.length;
  }

  private async settleOne(
    creds: OkxCredentials,
    ccy: string,
    liab: number,
  ): Promise<void> {
    // 1) Burn whatever is already on trading against current debt.
    await this.repayUntilClear(creds, ccy);

    let remaining = await this.getCurrencyLiab(creds, ccy);
    if (remaining <= CLEAR_LIAB_EPS) {
      this.logger.log(`OKX settle: ${ccy} fully cleared from trading balance`);
      return;
    }

    let earnAmt = 0;
    let rate: string | null = null;
    try {
      const rows = await okxRestRequest<SavingsBalanceRow[]>(
        creds,
        'GET',
        `/api/v5/finance/savings/balance?ccy=${encodeURIComponent(ccy)}`,
      );
      const row = rows.find((r) => r.ccy === ccy) || rows[0];
      earnAmt = parseAmt(row?.amt);
      rate = row?.rate || (await this.getEarnRate(creds, ccy));
    } catch (error) {
      this.logger.warn(
        `OKX Earn balance ${ccy} failed: ${(error as Error).message}`,
      );
      return;
    }

    if (earnAmt <= DUST_AMT) {
      this.logger.log(
        `OKX Earn: liability ${formatAmt(remaining)} ${ccy} but Earn balance is 0`,
      );
      return;
    }

    if (!rate) {
      this.logger.warn(`OKX Earn: no rate for redeem ${ccy}`);
      return;
    }

    // Redeem liab + buffer so tiny leftovers (0.01 USDT) can be wiped.
    const buffer = redeemBuffer(ccy, remaining);
    const redeemTarget = remaining + buffer;
    const redeemAmt = Math.min(redeemTarget, earnAmt);
    const amt = formatAmt(redeemAmt);
    if (parseAmt(amt) <= DUST_AMT) return;

    try {
      await okxRestRequest(creds, 'POST', '/api/v5/finance/savings/purchase-redempt', {
        ccy,
        amt,
        side: 'redempt',
        rate,
      });
      this.logger.log(
        `OKX Earn: redeemed ${amt} ${ccy} (liab ${formatAmt(remaining)} + buffer ${formatAmt(buffer)})`,
      );
      void this.telegramService.sendMessage(
        `OKX Earn redeem\n${amt} ${ccy}`,
      );
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.warn(`OKX Earn redeem ${ccy} failed: ${msg}`);
      void this.telegramService.sendMessage(
        `OKX Earn redeem failed\n${ccy}: ${msg}`,
      );
      return;
    }

    await this.ensureOnTradingForRepay(creds, ccy, remaining + buffer);
    await this.repayUntilClear(creds, ccy);

    const left = await this.getCurrencyLiab(creds, ccy);
    if (left > CLEAR_LIAB_EPS) {
      this.logger.warn(
        `OKX settle: ${ccy} still owes ${formatAmt(left)} after clear attempts`,
      );
      void this.telegramService.sendMessage(
        `OKX settle incomplete\n${formatAmt(left)} ${ccy} still borrowed`,
      );
    } else {
      this.logger.log(`OKX settle: ${ccy} debt fully cleared`);
    }
  }

  /** Re-read liab and repay in a loop until debt is gone or nothing left to pay with. */
  private async repayUntilClear(
    creds: OkxCredentials,
    ccy: string,
  ): Promise<void> {
    for (let round = 1; round <= 5; round++) {
      const liab = await this.getCurrencyLiab(creds, ccy);
      if (liab <= CLEAR_LIAB_EPS) return;

      const avail = await this.getTradingAvail(creds, ccy);
      if (avail <= DUST_AMT) {
        this.logger.log(
          `OKX repayUntilClear ${ccy}: liab=${formatAmt(liab)} but trading avail=0 (round ${round})`,
        );
        return;
      }

      // Pay as much as possible toward full remaining debt this round.
      const pay = Math.min(liab, avail);
      this.logger.log(
        `OKX repayUntilClear ${ccy} round ${round}: pay ${formatAmt(pay)} of ${formatAmt(liab)}`,
      );
      const repaid = await this.repay(creds, ccy, pay);
      if (repaid <= DUST_AMT) return;

      // Rate limit between repay calls
      await sleep(3500);
    }
  }

  private async getCurrencyLiab(
    creds: OkxCredentials,
    ccy: string,
  ): Promise<number> {
    const details = await this.getBalanceDetails(creds);
    const row = details.find((d) => d.ccy === ccy);
    if (!row) return 0;
    return Math.max(
      parseAmt(row.liab),
      parseAmt(row.crossLiab),
      parseAmt(row.isoLiab),
    );
  }

  private async repay(
    creds: OkxCredentials,
    ccy: string,
    amount: number,
  ): Promise<number> {
    const repayAmt = formatAmt(amount);
    if (parseAmt(repayAmt) <= DUST_AMT) return 0;

    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) await sleep(3500);
        await okxRestRequest(
          creds,
          'POST',
          '/api/v5/account/spot-manual-borrow-repay',
          {
            ccy,
            side: 'repay',
            amt: repayAmt,
          },
        );
        this.logger.log(`OKX repay: ${repayAmt} ${ccy}`);
        void this.telegramService.sendMessage(
          `OKX liability repaid\n${repayAmt} ${ccy}`,
        );
        return parseAmt(repayAmt);
      } catch (error) {
        lastError = (error as Error).message;
        this.logger.warn(
          `OKX repay ${ccy} attempt ${attempt}/3: ${lastError}`,
        );
        if (attempt < 3 && this.isRateLimitError(lastError)) {
          continue;
        }
        break;
      }
    }

    void this.telegramService.sendMessage(
      `OKX repay failed\n${ccy}: ${lastError}`,
    );
    return 0;
  }

  /** After Earn redeem: wait for funds, transfer Funding→Trading if needed. */
  private async ensureOnTradingForRepay(
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
      if (trading > DUST_AMT && attempt >= 2) break;
    }

    if (funding > DUST_AMT) {
      const move = formatAmt(Math.min(funding, Math.max(need - trading, funding)));
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

  private async getBalanceDetails(
    creds: OkxCredentials,
  ): Promise<BalanceDetail[]> {
    const rows = await okxRestRequest<BalanceRow[]>(
      creds,
      'GET',
      '/api/v5/account/balance',
    );
    return rows[0]?.details || [];
  }

  private async getTradingAvail(
    creds: OkxCredentials,
    ccy: string,
  ): Promise<number> {
    const details = await this.getBalanceDetails(creds);
    const row = details.find((d) => d.ccy === ccy);
    const avail = parseAmt(row?.availBal);
    if (avail > DUST_AMT) return avail;
    return parseAmt(row?.cashBal);
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
}
