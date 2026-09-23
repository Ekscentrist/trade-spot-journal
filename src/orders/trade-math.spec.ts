import { describe, expect, it } from 'vitest';
import { cleanDecimal } from './trade-math.js';

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
