import { describe, expect, it } from 'vitest';
import { parseBitgetFee } from './bitget-fee.js';

describe('parseBitgetFee', () => {
  it('reads REST feeDetail JSON keyed by coin (feeCoinCode)', () => {
    const feeDetail =
      '{"newFees":{"c":0,"d":0,"deduction":false,"r":-1,"t":-1,"totalDeductionFee":0},"TRX":{"deduction":false,"feeCoinCode":"TRX","totalDeductionFee":0,"totalFee":-1.0000000000000000}}';
    expect(parseBitgetFee({ side: 'buy', feeDetail }, 'TRX-USDT')).toEqual({
      fee: '-1',
      feeCcy: 'TRX',
    });
  });

  it('falls back to newFees.t with side-based currency', () => {
    const feeDetail = '{"newFees":{"t":-0.3109}}';
    expect(parseBitgetFee({ side: 'sell', feeDetail }, 'TRX-USDT')).toEqual({
      fee: '-0.3109',
      feeCcy: 'USDT',
    });
  });

  it('prefers WS feeDetail total over the per-trade fillFee', () => {
    expect(
      parseBitgetFee(
        {
          side: 'sell',
          fillFee: '-0.0517126188',
          fillFeeCoin: 'USDT',
          feeDetail: [{ feeCoin: 'USDT', fee: '-0.3109' }],
        },
        'TRX-USDT',
      ),
    ).toEqual({ fee: '-0.3109', feeCcy: 'USDT' });
  });

  it('uses fillFee when feeDetail is missing', () => {
    expect(
      parseBitgetFee({ fillFee: '-0.02', fillFeeCoin: 'TRX' }, 'TRX-USDT'),
    ).toEqual({ fee: '-0.02', feeCcy: 'TRX' });
  });

  it('reads BGB deduction rows', () => {
    const feeDetail =
      '{"newFees":{"t":-0.01,"deduction":true},"BGB":{"deduction":true,"feeCoinCode":"BGB","totalDeductionFee":-0.01,"totalFee":-0.01}}';
    expect(parseBitgetFee({ side: 'buy', feeDetail }, 'TRX-USDT')).toEqual({
      fee: '-0.01',
      feeCcy: 'BGB',
    });
  });
});
