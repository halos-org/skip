/** How radian angles are wrapped for display; `scalar` is plain numeric. */
export type ChartStatsDomain = 'scalar' | 'direction' | 'signed';

/** Per-point statistics over a rolling window (newest value last). */
export interface IChartPointStats {
  value: number;
  sma: number;
  lastAverage: number;
  lastMinimum: number;
  lastMaximum: number;
}

/** Wrap a radian angle to [0, 2π). */
export function normalizeDirectionRad(a: number): number {
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/** Wrap a radian angle to (-π, π]. */
export function normalizeSignedRad(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Circular mean of radian angles (atan2 of the mean sin/cos). */
export function circularMeanRad(anglesRad: number[]): number {
  if (anglesRad.length === 0) return 0;
  const sumSin = anglesRad.reduce((s, a) => s + Math.sin(a), 0);
  const sumCos = anglesRad.reduce((s, a) => s + Math.cos(a), 0);
  return Math.atan2(sumSin / anglesRad.length, sumCos / anglesRad.length);
}

/** Smallest arc containing all radian angles, returned as {min, max} in radians. */
export function circularMinMaxRad(anglesRad: number[]): { min: number; max: number } {
  if (anglesRad.length === 0) return { min: 0, max: 0 };
  const deg = anglesRad.map(a => ((a * 180 / Math.PI) + 360) % 360).sort((a, b) => a - b);
  let maxGap = 0;
  let minIdx = 0;
  for (let i = 0; i < deg.length; i++) {
    const next = (i + 1) % deg.length;
    const gap = (deg[next] - deg[i] + 360) % 360;
    if (gap > maxGap) {
      maxGap = gap;
      minIdx = next;
    }
  }
  const min = deg[minIdx] * Math.PI / 180;
  const max = deg[(minIdx - 1 + deg.length) % deg.length] * Math.PI / 180;
  return { min, max };
}

/**
 * SMA over a trailing window (newest last): arithmetic mean for `scalar`, circular mean wrapped to
 * the domain for `direction`/`signed`. Shared by the live tail and the History backfill so both
 * smooth identically. The window must already be sliced to the smoothing period.
 */
export function windowSma(window: number[], domain: ChartStatsDomain): number {
  if (domain === 'scalar') {
    return window.reduce((s, v) => s + v, 0) / window.length;
  }
  const wrap = domain === 'signed' ? normalizeSignedRad : normalizeDirectionRad;
  return wrap(circularMeanRad(window));
}

/**
 * Compute value + SMA + window average/min/max over a numeric buffer (newest last). Scalar uses
 * arithmetic aggregates; `direction`/`signed` use circular math and wrap the outputs to their domain.
 * Shared by the History-API chart live tail; mirrors the recorder's per-point statistics.
 */
export function computeWindowStats(buffer: number[], smoothingPeriod: number, domain: ChartStatsDomain): IChartPointStats {
  const value = buffer[buffer.length - 1];
  const smaWindow = buffer.slice(Math.max(0, buffer.length - Math.max(1, smoothingPeriod)));

  if (domain === 'scalar') {
    const avg = buffer.reduce((s, v) => s + v, 0) / buffer.length;
    return { value, sma: windowSma(smaWindow, domain), lastAverage: avg, lastMinimum: Math.min(...buffer), lastMaximum: Math.max(...buffer) };
  }

  const wrap = domain === 'signed' ? normalizeSignedRad : normalizeDirectionRad;
  const { min, max } = circularMinMaxRad(buffer);
  return {
    value: wrap(value),
    sma: windowSma(smaWindow, domain),
    lastAverage: wrap(circularMeanRad(buffer)),
    lastMinimum: wrap(min),
    lastMaximum: wrap(max)
  };
}
