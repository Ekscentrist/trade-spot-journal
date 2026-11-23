import { describe, expect, it } from 'vitest';
import {
  absDecimal,
  calcRoundTrip,
  cleanDecimal,
  feeInQuote,
  isThirdCoinFee,
} from './trade-math.js';

describe('cleanDecimal', () => {
  it('keeps OKX XAUT prices without a float tail', () => {
    expect(cleanDecimal('4313.3')).toBe('4313.3');
    expect(cleanDecimal('4312.2')).toBe('4312.2');
    expect(cleanDecimal('4304.8')).toBe('4304.8');
    expect(cleanDecimal('4307.5')).toBe('4307.5');
    expect(cleanDecimal('0.003')).toBe('0.003');
    expect(cleanDecimal('-0.01035192')).toBe('-0.01035192');
  });

  it('repairs values already stored via toFixed(16)', () => {
    expect(cleanDecimal('4313.3000000000001819')).toBe('4313.3');
    expect(cleanDecimal('4312.199999999998181')).toBe('4312.2');
    expect(cleanDecimal('4312.1999999999998181')).toBe('4312.2');
    expect(cleanDecimal('4304.8000000000001819')).toBe('4304.8');
  });
});

describe('fees', () => {
  it('converts base fee at trade price and keeps quote fee', () => {
    expect(feeInQuote('1', 'TRX', 'TRX-USDT', 0.3)).toBeCloseTo(0.3);
    expect(feeInQuote('-0.3109', 'USDT', 'TRX-USDT', 0.3)).toBeCloseTo(0.3109);
  });

  it('prefers stored feeQuote for third-coin fees', () => {
    expect(feeInQuote('0.0079', 'GT', 'BTC-USDT', 63950, '0.064')).toBeCloseTo(
      0.064,
    );
  });

  it('detects third-coin fees and strips the sign', () => {
    expect(isThirdCoinFee('GT', 'BTC-USDT')).toBe(true);
    expect(isThirdCoinFee('btc', 'BTC-USDT')).toBe(false);
    expect(isThirdCoinFee(null, 'BTC-USDT')).toBe(false);
    expect(absDecimal('-0.3109')).toBe('0.3109');
    expect(absDecimal('1')).toBe('1');
    expect(absDecimal(null)).toBeNull();
  });

  it('subtracts converted fees from round-trip PnL', () => {
    const stats = calcRoundTrip({
      instId: 'BTC-USDT',
      buy: {
        accFillSz: '0.001',
        avgPx: '58485',
        fee: '0.0084',
        feeCcy: 'GT',
        feeQuote: '0.06',
      },
      sells: [
        {
          accFillSz: '0.001',
          avgPx: '63950',
          fee: '0.0079',
          feeCcy: 'GT',
          feeQuote: '0.064',
        },
      ],
    });
    expect(stats.feesQuote).toBeCloseTo(0.124);
    expect(stats.pnl).toBeCloseTo(5.465 - 0.124);
  });
});
