import { describe, expect, it } from 'vitest';
import { resolveWindowMs, deriveDataSourceInfo } from './chart-window.util';

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
    it('targets ~120 points across a 60s window', () => {
      expect(deriveDataSourceInfo(60_000)).toEqual({ sampleTime: 500, maxDataPoints: 120, smoothingPeriod: 30 });
    });

    it('enforces the 100ms minimum sample interval for tiny windows', () => {
      // 6s / 120 = 50ms → floored to 100ms.
      expect(deriveDataSourceInfo(6_000).sampleTime).toBe(100);
    });

    it('never returns zero-sized buffers or cadence for an empty window', () => {
      const info = deriveDataSourceInfo(0);
      expect(info.sampleTime).toBeGreaterThanOrEqual(1);
      expect(info.maxDataPoints).toBeGreaterThanOrEqual(1);
      expect(info.smoothingPeriod).toBeGreaterThanOrEqual(1);
    });
  });
});
