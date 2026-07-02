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

  it('normalizes exactly π to +π in the signed domain (atan2 boundary, shared by both engines)', () => {
    // The single shared signed normalizer is the atan2 form, so 180° maps to +π (the included end of
    // (-π, π]), not the recorder's former mod-based -π. Both chart engines now agree here.
    expect(normalizeSignedRad(Math.PI)).toBeCloseTo(Math.PI, 10);
  });

  it('wraps a single value into the direction domain [0, 2π)', () => {
    const dir = computeWindowStats([(350 * Math.PI) / 180], 1, 'direction');
    expect(dir.value).toBeCloseTo((350 * Math.PI) / 180, 5);
    expect(dir.lastAverage).toBeCloseTo((350 * Math.PI) / 180, 5);
  });

  it('aggregates circularly across the 0/360 wrap (direction domain)', () => {
    // Buffer straddles the wrap; the circular average is ~0°, not the ~180° a linear mean gives.
    const dir = computeWindowStats([(350 * Math.PI) / 180, (10 * Math.PI) / 180], 2, 'direction');
    expect(dir.value).toBeCloseTo((10 * Math.PI) / 180, 5);
    expect(normalizeSignedRad(dir.lastAverage)).toBeCloseTo(0, 5);
    expect((dir.lastMinimum * 180) / Math.PI).toBeCloseTo(350, 4);
    expect((dir.lastMaximum * 180) / Math.PI).toBeCloseTo(10, 4);
  });

  it('aggregates circularly in the signed domain (-π, π]', () => {
    const signed = computeWindowStats([(350 * Math.PI) / 180, (10 * Math.PI) / 180], 2, 'signed');
    expect(signed.value).toBeCloseTo((10 * Math.PI) / 180, 5);
    expect(signed.lastAverage).toBeCloseTo(0, 5);
  });
});
