import { CHART_PERF_FLAG_KEY } from '../constants/config-storage.const';

/**
 * Opt-in chart performance instrumentation for the #64 History-API prototype. Enabled by setting
 * `localStorage['skip.chartPerf'] = '1'`; a no-op probe is returned otherwise, so there is zero cost
 * in normal use. Captures backfill cost (round-trip, points, response size, request count) and
 * live-tail behaviour (update cadence and value freshness) so the recorder-vs-History comparison can
 * be quantified instead of eyeballed.
 */
export function isChartPerfEnabled(): boolean {
  try {
    return localStorage.getItem(CHART_PERF_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** Point-in-time metrics for the on-widget overlay / console. */
export interface IChartPerfSnapshot {
  engine: string;
  backfillMs: number | null;
  backfillPoints: number | null;
  backfillKb: number | null;
  historyRequests: number;
  liveHz: number | null;
  liveJitterMs: number | null;
  liveFreshnessMs: number | null;
  liveCount: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

export interface IChartPerfProbe {
  startBackfill(): void;
  endBackfill(points: number, responseBytes: number): void;
  recordLive(valueTimestampMs: number): void;
  snapshot(): IChartPerfSnapshot;
  readonly enabled: boolean;
}

class NoopProbe implements IChartPerfProbe {
  public readonly enabled = false;
  startBackfill(): void { /* noop */ }
  endBackfill(): void { /* noop */ }
  recordLive(): void { /* noop */ }
  snapshot(): IChartPerfSnapshot {
    return { engine: '', backfillMs: null, backfillPoints: null, backfillKb: null, historyRequests: 0, liveHz: null, liveJitterMs: null, liveFreshnessMs: null, liveCount: 0 };
  }
}

class ActiveProbe implements IChartPerfProbe {
  public readonly enabled = true;
  private readonly label: string;
  private backfillStart: number | null = null;
  private backfillMs: number | null = null;
  private backfillPoints: number | null = null;
  private backfillKb: number | null = null;
  private historyRequests = 0;
  private lastLiveAt: number | null = null;
  private readonly intervals: number[] = [];
  private freshnessMs: number | null = null;
  private liveCount = 0;

  constructor(label: string) {
    this.label = label;
  }

  startBackfill(): void {
    this.backfillStart = performance.now();
    this.historyRequests++;
  }

  endBackfill(points: number, responseBytes: number): void {
    if (this.backfillStart !== null) {
      this.backfillMs = Math.round(performance.now() - this.backfillStart);
    }
    this.backfillPoints = points;
    this.backfillKb = Math.round(responseBytes / 102.4) / 10; // KB, 1 decimal
    console.info(`[ChartPerf ${this.label}] backfill: ${this.backfillMs}ms, ${points} pts, ${this.backfillKb}KB, req#${this.historyRequests}`);
  }

  recordLive(valueTimestampMs: number): void {
    const now = performance.now();
    if (this.lastLiveAt !== null) {
      this.intervals.push(now - this.lastLiveAt);
      if (this.intervals.length > 200) this.intervals.shift();
    }
    this.lastLiveAt = now;
    this.freshnessMs = Math.max(0, Math.round(Date.now() - valueTimestampMs));
    this.liveCount++;
    if (this.liveCount % 20 === 0) {
      const s = this.snapshot();
      console.info(`[ChartPerf ${this.label}] live: ${s.liveHz}Hz, jitter p95 ${s.liveJitterMs}ms, freshness ${s.liveFreshnessMs}ms, n=${s.liveCount}`);
    }
  }

  snapshot(): IChartPerfSnapshot {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const medianInterval = percentile(sorted, 50);
    return {
      engine: this.label,
      backfillMs: this.backfillMs,
      backfillPoints: this.backfillPoints,
      backfillKb: this.backfillKb,
      historyRequests: this.historyRequests,
      liveHz: medianInterval > 0 ? Math.round((1000 / medianInterval) * 10) / 10 : null,
      liveJitterMs: sorted.length ? Math.round(percentile(sorted, 95)) : null,
      liveFreshnessMs: this.freshnessMs,
      liveCount: this.liveCount
    };
  }
}

export function createChartPerfProbe(label: string): IChartPerfProbe {
  return isChartPerfEnabled() ? new ActiveProbe(label) : new NoopProbe();
}
