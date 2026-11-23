import { describe, expect, it } from 'vitest';
import { parseGateFee } from './gate-fee.js';

describe('parseGateFee', () => {
  it('uses gt_fee when the fee was paid in GT', () => {
    expect(
      parseGateFee({
        fee: '0.0',
        fee_currency: 'USDT',
        point_fee: '0.0',
        gt_fee: '0.007915049226441631',
      }),
    ).toEqual({ fee: '0.007915049226441631', feeCcy: 'GT' });
  });

  it('uses the regular fee when present', () => {
    expect(
      parseGateFee({ fee: '0.000002', fee_currency: 'BTC', gt_fee: '0' }),
    ).toEqual({ fee: '0.000002', feeCcy: 'BTC' });
  });

  it('uses point_fee for POINT payments', () => {
    expect(
      parseGateFee({
        fee: '0',
        fee_currency: 'USDT',
        gt_fee: '0',
        point_fee: '0.06',
      }),
    ).toEqual({ fee: '0.06', feeCcy: 'POINT' });
  });

  it('keeps a zero fee when nothing was charged', () => {
    expect(parseGateFee({ fee: '0', fee_currency: 'USDT' })).toEqual({
      fee: '0',
      feeCcy: 'USDT',
    });
  });
});
