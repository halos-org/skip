import type { TimeScaleFormat } from '../services/dataset-stream.service';

/** Points a window aims for at its derived cadence, once above the sample-time floor. */
export const TARGET_POINTS_PER_WINDOW = 500;
/** Floor sampling interval; very small windows sample no faster than this. */
export const MIN_SAMPLE_TIME_MS = 100;
/** SMA window as a fraction of the buffer size. */
export const SMOOTHING_PERIOD_FACTOR = 0.25;

/** Sampling cadence + buffer size derived from a display window. */
export interface IChartDataSourceInfo {
  /** Path value sampling interval in ms. */
  sampleTime: number;
  /** Rolling buffer capacity (points kept for the window). */
  maxDataPoints: number;
  /** Number of trailing points averaged for the SMA. */
  smoothingPeriod: number;
}

/**
 * Window length in ms for a time-scale format + period. `Last *` presets ignore `period`.
 * Shared by the client-side recorder (`DatasetStreamService`) and the History-API chart path so
 * both derive an identical window from the same widget config.
 */
export function resolveWindowMs(timeScaleFormat: TimeScaleFormat, period: number): number {
  switch (timeScaleFormat) {
    case 'Last Minute':
      return 60_000;
    case 'Last 5 Minutes':
      return 5 * 60_000;
    case 'Last 30 Minutes':
      return 30 * 60_000;
    case 'day':
      return Math.max(0, period) * 24 * 60 * 60_000;
    case 'hour':
      return Math.max(0, period) * 60 * 60_000;
    case 'minute':
      return Math.max(0, period) * 60_000;
    case 'second':
      return Math.max(0, period) * 1_000;
    default:
      return 0;
  }
}

/**
 * Derive the sampling cadence and buffer size for a window, targeting a consistent ~500 points per
 * window with a floor sampling interval for very small windows. The point count tracks the target
 * (never far above it), so no separate buffer cap is needed.
 */
export function deriveDataSourceInfo(windowMs: number): IChartDataSourceInfo {
  const sampleTime = windowMs > 0
    ? Math.max(MIN_SAMPLE_TIME_MS, Math.round(windowMs / TARGET_POINTS_PER_WINDOW))
    : 1000;
  const maxDataPoints = Math.max(1, Math.ceil(windowMs / sampleTime));
  const smoothingPeriod = Math.max(1, Math.floor(maxDataPoints * SMOOTHING_PERIOD_FACTOR));
  return {
    sampleTime: Math.max(1, sampleTime),
    maxDataPoints,
    smoothingPeriod
  };
}
