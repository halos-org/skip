import { describe, expect, it } from 'vitest';
import { reduceMinMax } from './numeric-minmax.util';

describe('reduceMinMax', () => {
  it('seeds min from the first sample (max is set by a later non-min sample)', () => {
    expect(reduceMinMax(null, null, 5)).toEqual({ min: 5, max: null });
  });

  it('lowers min on a new low', () => {
    expect(reduceMinMax(5, 10, 3)).toEqual({ min: 3, max: 10 });
  });

  it('raises max on a new high', () => {
    expect(reduceMinMax(3, 10, 12)).toEqual({ min: 3, max: 12 });
  });

  it('leaves min/max unchanged for an in-range sample', () => {
    expect(reduceMinMax(3, 10, 7)).toEqual({ min: 3, max: 10 });
  });

  it('preserves the tracked min/max on a null sample (sensor dropout)', () => {
    // Regression guard: previously a null coerced to 0 in the comparison and wiped
    // the running min (positive paths) or max (negative paths).
    expect(reduceMinMax(3, 10, null)).toEqual({ min: 3, max: 10 });
    expect(reduceMinMax(-8, -2, null)).toEqual({ min: -8, max: -2 });
  });
});
