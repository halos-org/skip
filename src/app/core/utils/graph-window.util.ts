import type { TimeScaleFormat } from '../interfaces/graph-data.interfaces';

/** Points a window aims for at its derived cadence, once above the sample-time floor. */
export const TARGET_POINTS_PER_WINDOW = 500;
/** Floor sampling interval; very small windows sample no faster than this. */
export const MIN_SAMPLE_TIME_MS = 100;
/** SMA window as a fraction of the buffer size. */
export const SMOOTHING_PERIOD_FACTOR = 0.25;

/** Sampling cadence + buffer size derived from a display window. */
export interface IGraphDataSourceInfo {
  /** Path value sampling interval in ms. */
  sampleTime: number;
  /** Rolling buffer capacity (points kept for the window). */
  maxDataPoints: number;
  /** Number of trailing points averaged for the SMA. */
  smoothingPeriod: number;
}

/**
 * Window length in ms for a time-scale format + period. `Last *` presets ignore `period`.
 * Derives the graph's display window from the widget config.
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
/** Largest unit first, so the first unit the span reaches is the one it is reported in. */
const SMOOTHING_WINDOW_UNITS: readonly { ms: number; one: string; many: string }[] = [
  { ms: 24 * 60 * 60_000, one: 'day', many: 'days' },
  { ms: 60 * 60_000, one: 'h', many: 'h' },
  { ms: 60_000, one: 'min', many: 'min' },
  { ms: 1_000, one: 's', many: 's' }
];

/**
 * How much time the moving average spans, phrased for a settings hint ('2.5 min'). The span is the
 * smoothing period at the window's own sampling cadence, so it stays true to what the graph plots
 * rather than restating the 25 % factor. Empty for a window with no length.
 */
export function describeSmoothingWindow(timeScaleFormat: TimeScaleFormat, period: number): string {
  const windowMs = resolveWindowMs(timeScaleFormat, period);
  if (windowMs <= 0) return '';
  const info = deriveDataSourceInfo(windowMs);
  const spanMs = info.smoothingPeriod * info.sampleTime;
  for (const unit of SMOOTHING_WINDOW_UNITS) {
    if (spanMs < unit.ms) continue;
    const value = Math.round((spanMs / unit.ms) * 10) / 10;
    return `${value} ${value === 1 ? unit.one : unit.many}`;
  }
  return `${Math.round(spanMs)} ms`;
}

export function deriveDataSourceInfo(windowMs: number): IGraphDataSourceInfo {
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
