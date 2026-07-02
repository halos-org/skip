import { describe, expect, it } from 'vitest';
import { circularMeanRad, circularMinMaxRad, computeWindowStats, normalizeDirectionRad, normalizeSignedRad } from './chart-stats.util';

describe('chart-stats.util', () => {
  it('computes scalar value / sma / average / min / max over the window', () => {
    const stats = computeWindowStats([1, 2, 3], 2, 'scalar');
    expect(stats.value).toBe(3);
    expect(stats.sma).toBeCloseTo(2.5); // mean of the last 2
    expect(stats.lastAverage).toBeCloseTo(2); // mean of all
    expect(stats.lastMinimum).toBe(1);
    expect(stats.lastMaximum).toBe(3);
  });

  it('circular mean averages angles without the 0/2π wrap artefact', () => {
    // Mean of 350° and 10° is 0°, not 180°. Signed-normalize so ~0 and ~2π both read as 0.
    const mean = circularMeanRad([(350 * Math.PI) / 180, (10 * Math.PI) / 180]);
    expect(normalizeSignedRad(mean)).toBeCloseTo(0, 5);
  });

  it('circular min/max returns the smallest arc containing the angles', () => {
    const { min, max } = circularMinMaxRad([(350 * Math.PI) / 180, (10 * Math.PI) / 180]);
    expect((min * 180) / Math.PI).toBeCloseTo(350, 4);
    expect((max * 180) / Math.PI).toBeCloseTo(10, 4);
  });

  it('normalizes to the direction domain [0, 2π)', () => {
    expect(normalizeDirectionRad(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 5);
  });

  it('normalizes to the signed domain (-π, π]', () => {
    expect(normalizeSignedRad((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('wraps circular stats into the requested domain', () => {
    const dir = computeWindowStats([(350 * Math.PI) / 180], 1, 'direction');
    expect(dir.value).toBeGreaterThanOrEqual(0);
    expect(dir.value).toBeLessThan(2 * Math.PI);
  });
});
