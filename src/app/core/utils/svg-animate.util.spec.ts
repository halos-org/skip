import { describe, expect, it } from 'vitest';
import { effectiveAnimationDuration } from './svg-animate.util';
import { DEFAULT_WIDGET_UPDATE_INTERVAL_MS } from '../interfaces/widgets-interface';

describe('effectiveAnimationDuration', () => {
  it('returns the update interval unchanged when it is below the cap', () => {
    expect(effectiveAnimationDuration(100)).toBe(100);
    expect(effectiveAnimationDuration(500)).toBe(500);
  });

  it('caps the duration at the default update interval', () => {
    expect(effectiveAnimationDuration(DEFAULT_WIDGET_UPDATE_INTERVAL_MS + 1)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration(5000)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
  });

  it('returns the cap at exactly the default interval', () => {
    expect(effectiveAnimationDuration(DEFAULT_WIDGET_UPDATE_INTERVAL_MS)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
  });

  it('never animates longer than one update interval, so a tween completes within the sample period', () => {
    for (const interval of [50, 100, 200, 333, 500, 750, 1000, 1500, 3000]) {
      expect(effectiveAnimationDuration(interval)).toBeLessThanOrEqual(interval);
    }
  });

  it('is monotonic non-decreasing in the update interval (smaller cadence never yields more motion)', () => {
    const intervals = [50, 100, 200, 333, 500, 750, 1000, 1500, 3000];
    let previous = -Infinity;
    for (const interval of intervals) {
      const duration = effectiveAnimationDuration(interval);
      expect(duration).toBeGreaterThanOrEqual(previous);
      previous = duration;
    }
  });

  it('falls back to the default for non-positive or non-finite input', () => {
    expect(effectiveAnimationDuration(0)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration(-100)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration(Number.NaN)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration(Number.POSITIVE_INFINITY)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
  });

  it('coerces string and undefined updateInterval from a persisted config', () => {
    expect(effectiveAnimationDuration(undefined)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration('500' as unknown as number)).toBe(500);
    expect(effectiveAnimationDuration('5000' as unknown as number)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration('abc' as unknown as number)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
  });
});
