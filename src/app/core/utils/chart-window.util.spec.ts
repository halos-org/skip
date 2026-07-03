import { describe, expect, it } from 'vitest';
import {
  resolveWindowMs,
  deriveDataSourceInfo,
  TARGET_POINTS_PER_WINDOW,
  MIN_SAMPLE_TIME_MS,
  SMOOTHING_PERIOD_FACTOR
} from './chart-window.util';

describe('chart-window.util', () => {
  describe('resolveWindowMs', () => {
    it('maps the fixed presets, ignoring period', () => {
      expect(resolveWindowMs('Last Minute', 999)).toBe(60_000);
      expect(resolveWindowMs('Last 5 Minutes', 999)).toBe(5 * 60_000);
      expect(resolveWindowMs('Last 30 Minutes', 999)).toBe(30 * 60_000);
    });

    it('scales the period-based formats', () => {
      expect(resolveWindowMs('second', 30)).toBe(30_000);
      expect(resolveWindowMs('minute', 10)).toBe(10 * 60_000);
      expect(resolveWindowMs('hour', 2)).toBe(2 * 60 * 60_000);
      expect(resolveWindowMs('day', 1)).toBe(24 * 60 * 60_000);
    });

    it('clamps a negative period to zero', () => {
      expect(resolveWindowMs('minute', -5)).toBe(0);
    });
  });

  describe('deriveDataSourceInfo', () => {
    const expectedSmoothing = (maxDataPoints: number) =>
      Math.max(1, Math.floor(maxDataPoints * SMOOTHING_PERIOD_FACTOR));

    it('samples a wide window at window/target cadence, hitting the target point count', () => {
      // A window that is an exact multiple of the target divides cleanly (cadence = window / target,
      // buffer = target), so the assertion tracks the target constant instead of a baked-in literal.
      const cadenceMs = 600; // comfortably above the floor
      const windowMs = TARGET_POINTS_PER_WINDOW * cadenceMs;
      const info = deriveDataSourceInfo(windowMs);
      expect(info.sampleTime).toBe(cadenceMs);
      expect(info.maxDataPoints).toBe(TARGET_POINTS_PER_WINDOW);
      expect(info.smoothingPeriod).toBe(expectedSmoothing(TARGET_POINTS_PER_WINDOW));
    });

    it('floors the sample interval for a window finer than the floor', () => {
      // window / target below the floor → cadence pins to MIN_SAMPLE_TIME_MS, buffer = window / floor.
      const windowMs = Math.floor((MIN_SAMPLE_TIME_MS * TARGET_POINTS_PER_WINDOW) / 2);
      const info = deriveDataSourceInfo(windowMs);
      expect(info.sampleTime).toBe(MIN_SAMPLE_TIME_MS);
      expect(info.maxDataPoints).toBe(Math.ceil(windowMs / MIN_SAMPLE_TIME_MS));
      expect(info.smoothingPeriod).toBe(expectedSmoothing(info.maxDataPoints));
    });

    it('holds the sample floor and a consistent smoothingPeriod across a wide sweep of windows', () => {
      const windows = [
        1_000, 6_000, 60_000, 5 * 60_000, 30 * 60_000,
        60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000, 7 * 24 * 60 * 60_000
      ];
      for (const windowMs of windows) {
        const info = deriveDataSourceInfo(windowMs);
        expect(info.sampleTime).toBeGreaterThanOrEqual(MIN_SAMPLE_TIME_MS);
        expect(info.maxDataPoints).toBeGreaterThanOrEqual(1);
        expect(info.smoothingPeriod).toBe(expectedSmoothing(info.maxDataPoints));
      }
    });

    it('never returns zero-sized buffers or cadence for an empty window', () => {
      const info = deriveDataSourceInfo(0);
      expect(info.sampleTime).toBeGreaterThanOrEqual(1);
      expect(info.maxDataPoints).toBeGreaterThanOrEqual(1);
      expect(info.smoothingPeriod).toBeGreaterThanOrEqual(1);
    });
  });
});
