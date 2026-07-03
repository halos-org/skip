import { Injectable, inject } from '@angular/core';
import { Observable, Subscription, filter, merge, shareReplay, take, timer, withLatestFrom } from 'rxjs';
import { DataService, IPathUpdate } from './data.service';
import { HistoryApiClientService, HistoryRequestError } from './history-api-client.service';
import { HistoryToChartMapperService } from './history-to-chart-mapper.service';
import { resolveAngleDomain } from '../utils/angle-domain.util';
import { SettingsService } from './settings.service';
import { IDatasetServiceDatapoint } from './dataset-stream.service';
import { computeWindowStats, ChartStatsDomain } from '../utils/chart-stats.util';

/** Emitted (instead of datapoints) when trend history cannot be served — no history provider. */
export interface IHistoryUnavailable {
  unavailable: true;
}
export const HISTORY_UNAVAILABLE: IHistoryUnavailable = { unavailable: true };

export function isHistoryUnavailable(v: unknown): v is IHistoryUnavailable {
  return !!v && typeof v === 'object' && (v as IHistoryUnavailable).unavailable === true;
}

/** A source value is treated as a dropout once it is older than this many observed update intervals. */
const STALE_INTERVAL_FACTOR = 3;
/** Never fabricate a gap before this much wall-clock silence, whatever the source cadence. */
const MIN_STALE_MS = 3_000;
/** Staleness threshold used before the source's update interval has been observed. */
const BOOTSTRAP_STALE_MS = 30_000;

/** Emitted once to break the trace when the source goes silent, so a dropout reads as a gap. */
const GAP_POINT = { value: NaN, sma: NaN, lastAverage: NaN, lastMinimum: NaN, lastMaximum: NaN } as const;

/** Inputs for one chart's History-API-backed data stream. */
export interface IHistoryChartStreamParams {
  path: string;
  source: string;
  /** Raw per-chart angle-range override; combined with the path's base unit to resolve the domain. */
  angleDomainOverride?: 'signed' | 'direction';
  windowMs: number;
  sampleTime: number;
  maxDataPoints: number;
  smoothingPeriod: number;
}

type StreamEmission = IDatasetServiceDatapoint[] | IDatasetServiceDatapoint | IHistoryUnavailable;

/**
 * #64 prototype data path: History-API backfill + a thin SK delta-stream live tail, offered as an
 * alternative to `DatasetStreamService` for `widget-data-chart`. History owns the initial window; the
 * live tail is the delta stream with a minimal rolling buffer and the shared stats util — no second
 * recording engine, no `ReplaySubject._buffer` handoff. When no history provider is available the
 * stream emits {@link HISTORY_UNAVAILABLE} (trend charts degrade to a clean empty state; there is no
 * recorder-style live-only fallback).
 */
@Injectable({ providedIn: 'root' })
export class HistoryChartStreamService {
  private readonly history = inject(HistoryApiClientService);
  private readonly mapper = inject(HistoryToChartMapperService);
  private readonly data = inject(DataService);
  private readonly settings = inject(SettingsService);

  /**
   * Backfill (History API, one-shot) then a live delta tail. Emits the backfill as a single array,
   * then live datapoints one at a time. Emits {@link HISTORY_UNAVAILABLE} and stops when there is no
   * history provider (or history is disabled). A *transient* backfill failure (network/5xx/timeout)
   * does not disable the chart: it falls through to the live delta tail with no backfill seed.
   */
  public getBackfillThenLive(params: IHistoryChartStreamParams): Observable<StreamEmission> {
    return new Observable<StreamEmission>(subscriber => {
      const domain = resolveAngleDomain(params.path, this.data.getPathUnitType(params.path), params.angleDomainOverride);
      let disposed = false;
      let liveSub: Subscription | null = null;
      const buffer: number[] = [];

      // No history provider / history disabled: degrade gracefully. The delta stream could still feed
      // a live-only chart, but the decision on #64 is not to maintain that path — surface the empty
      // state instead.
      if (this.settings.getWidgetHistoryDisabled()) {
        subscriber.next(HISTORY_UNAVAILABLE);
        subscriber.complete();
        return () => { /* nothing to tear down */ };
      }

      this.fetchBackfill(params, domain)
        .then(result => {
          if (disposed) return;
          if (result === null) {
            subscriber.next(HISTORY_UNAVAILABLE);
            subscriber.complete();
            return;
          }
          const { points, offsetMs } = result;
          subscriber.next(points);
          for (const p of points) {
            if (Number.isFinite(p.data.value)) buffer.push(p.data.value);
          }
          this.trim(buffer, params.maxDataPoints);
          const newestBackfillTs = points.length ? points[points.length - 1].timestamp : null;
          liveSub = this.startLive(params, domain, buffer, offsetMs, newestBackfillTs, subscriber);
        })
        .catch(err => {
          if (disposed) return;
          if (err instanceof HistoryRequestError) {
            // Transient backfill failure (network blip, 5xx, timeout): don't disable the chart. Ride
            // the live delta tail with no seed so live data still renders; a reconnect re-backfill
            // (#85) fills the gap. Only a genuine no-provider (null result above) degrades to empty.
            // offsetMs is null (no backfill anchor) → startLive derives it from the first live sample.
            liveSub = this.startLive(params, domain, buffer, null, null, subscriber);
            return;
          }
          // An unexpected error (e.g. a mapper/logic bug), not a known request failure: degrade to
          // empty but log it so a real bug is not indistinguishable from a legitimate no-provider.
          console.error('[HistoryChartStreamService] Unexpected backfill error; degrading to history-unavailable:', err);
          subscriber.next(HISTORY_UNAVAILABLE);
          subscriber.complete();
        });

      return () => {
        disposed = true;
        liveSub?.unsubscribe();
      };
    });
  }

  private startLive(
    params: IHistoryChartStreamParams,
    domain: ChartStatsDomain,
    buffer: number[],
    offsetMs: number | null,
    newestBackfillTs: number | null,
    subscriber: { next: (v: StreamEmission) => void }
  ): Subscription {
    // One shared upstream so the freshness tracker, the immediate first value and the resampler all
    // draw from a single path subscription.
    const path$ = this.data.subscribePath(params.path, params.source).pipe(
      filter(u => u?.data?.value !== null && u?.data?.value !== undefined),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Server→client clock offset. Backfill supplies it (from range.to); in the transient-failure
    // fallback there is no backfill, so `offsetMs` is null and we anchor on the first live sample —
    // otherwise the staleness check below would measure clock skew, not age, and gap a healthy source.
    let resolvedOffsetMs = offsetMs;
    // A value's source timestamp shifted into the client clock; NaN when the delta carries no timestamp.
    const sourceTsOf = (u: IPathUpdate): number => {
      const t = u?.data?.timestamp instanceof Date ? u.data.timestamp.getTime() : NaN;
      if (!Number.isFinite(t)) return NaN;
      if (resolvedOffsetMs === null) resolvedOffsetMs = Date.now() - t;
      return t + resolvedOffsetMs;
    };

    let prevSourceTs: number | null = null;
    let intervalMs: number | null = null;
    let gapMarked = false;
    // Staleness is keyed to the SOURCE's observed update interval, not the chart's render cadence, so a
    // slow-but-alive sensor holds while a genuinely dead one (or a stale value replayed on subscribe)
    // gaps. Until an interval is observed, only a long silence counts as a dropout.
    const staleAfterMs = (): number =>
      intervalMs === null ? BOOTSTRAP_STALE_MS : Math.max(MIN_STALE_MS, STALE_INTERVAL_FACTOR * intervalMs);

    const sub = new Subscription();
    // Learn the source interval from the spacing of consecutive delta timestamps.
    sub.add(path$.subscribe(u => {
      const ts = sourceTsOf(u);
      if (!Number.isFinite(ts)) return;
      if (prevSourceTs !== null) {
        const gap = ts - prevSourceTs;
        if (gap > 0) intervalMs = intervalMs === null ? gap : 0.3 * gap + 0.7 * intervalMs;
      }
      prevSourceTs = ts;
    }));

    // Backfill ended well before now (a dropout captured in history): break the trace at the seam so it
    // doesn't draw as a straight connecting line into the resumed live data.
    if (newestBackfillTs !== null && Date.now() - newestBackfillTs > BOOTSTRAP_STALE_MS) {
      subscriber.next({ timestamp: Date.now(), data: { ...GAP_POINT } });
      gapMarked = true;
    }

    // Zero-order hold: emit immediately on the first value, then resample the latest value at cadence.
    const sampled$ = timer(params.sampleTime, params.sampleTime).pipe(
      withLatestFrom(path$, (tick, u) => u)
    );
    sub.add(merge(path$.pipe(take(1)), sampled$).subscribe(u => {
      const value = Number(u.data.value);
      if (!Number.isFinite(value)) return;
      // Stamp with the client clock (like the recorder) so points sit on the chart's realtime axis;
      // server timestamps would drift the whole series under clock skew.
      const now = Date.now();
      const sourceTs = sourceTsOf(u);
      const dataAge = Number.isFinite(sourceTs) ? now - sourceTs : 0;
      if (dataAge > staleAfterMs()) {
        // The latest value is too old (dead source, or a stale cached value replayed on subscribe):
        // break the trace once, then stop advancing until fresh data resumes.
        if (!gapMarked) {
          gapMarked = true;
          subscriber.next({ timestamp: now, data: { ...GAP_POINT } });
        }
        return;
      }
      gapMarked = false;
      buffer.push(value);
      this.trim(buffer, params.maxDataPoints);
      const stats = computeWindowStats(buffer, params.smoothingPeriod, domain);
      subscriber.next({ timestamp: now, data: { ...stats } });
    }));
    return sub;
  }

  private async fetchBackfill(params: IHistoryChartStreamParams, domain: ChartStatsDomain): Promise<{ points: IDatasetServiceDatapoint[]; offsetMs: number } | null> {
    const normalizedPath = params.path.replace(/^(vessels\.)?self\./, '');
    const paths = [
      `${normalizedPath}:sma:${params.smoothingPeriod}`,
      `${normalizedPath}:avg`,
      `${normalizedPath}:min`,
      `${normalizedPath}:max`
    ].join(',');
    const resolutionSeconds = Math.max(1, Math.round(params.sampleTime / 1000));

    const response = await this.history.getValues({
      paths,
      from: new Date(Date.now() - params.windowMs).toISOString(),
      resolution: resolutionSeconds
    });
    if (!response) {
      return null;
    }
    const mapped = this.mapper.mapValuesToChartDatapoints(response, {
      domain
    });
    // History timestamps are server time; shift them into the client clock so backfill lines up with
    // the client-stamped live tail and the client-driven realtime axis (survives clock skew). Prefer
    // range.to (the server's "now"); fall back to the newest sample so a missing range still de-skews.
    const serverTo = Date.parse(response.range?.to ?? '');
    const newestServerTs = mapped.length ? mapped[mapped.length - 1].timestamp : NaN;
    const anchorTs = Number.isFinite(serverTo) ? serverTo : newestServerTs;
    const offsetMs = Number.isFinite(anchorTs) ? Date.now() - anchorTs : 0;
    const points = mapped
      .filter(m => m.data.value !== null && m.data.value !== undefined)
      .map(m => ({
        timestamp: m.timestamp + offsetMs,
        data: {
          value: m.data.value as number,
          sma: m.data.sma ?? undefined,
          lastAverage: m.data.lastAverage ?? undefined,
          lastMinimum: m.data.lastMinimum ?? undefined,
          lastMaximum: m.data.lastMaximum ?? undefined
        }
      }));
    return { points, offsetMs };
  }

  private trim(buffer: number[], maxDataPoints: number): void {
    if (buffer.length > maxDataPoints) {
      buffer.splice(0, buffer.length - maxDataPoints);
    }
  }
}
