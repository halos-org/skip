import { Injectable, inject } from '@angular/core';
import { Observable, Subscription, distinctUntilChanged, filter, merge, shareReplay, take, timer, withLatestFrom } from 'rxjs';
import { DataService, IPathUpdate } from './data.service';
import { HistoryApiClientService, HistoryRequestError } from './history-api-client.service';
import { HistoryToChartMapperService } from './history-to-chart-mapper.service';
import { ConnectionState, ConnectionStateMachine } from './connection-state-machine.service';
import { resolveAngleDomain } from '../utils/angle-domain.util';
import { IDatasetServiceDatapoint } from '../interfaces/dataset.interfaces';
import { computeWindowStats, windowSma, ChartStatsDomain } from '../utils/chart-stats.util';

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

/**
 * How long the source may be silent before its trace should break, keyed to the observed update
 * interval (not the chart cadence) so a slow-but-alive source is not gapped. Shared by the live tail
 * and the reconnect gap so a reconnect breaks the trace on exactly the same silence the live tail would.
 */
function staleThresholdMs(intervalMs: number | null): number {
  return intervalMs === null ? BOOTSTRAP_STALE_MS : Math.max(MIN_STALE_MS, STALE_INTERVAL_FACTOR * intervalMs);
}

/** Emitted once to break the trace when the source goes silent, so a dropout reads as a gap. */
const GAP_POINT = { value: NaN, sma: NaN, lastAverage: NaN, lastMinimum: NaN, lastMaximum: NaN } as const;

/**
 * The re-backfill seam is a client-clock timestamp but the History API filters in server time, so
 * under server-behind-client skew the exact seam would drop real buckets. Bias `from` earlier by this
 * margin; the `> seam` de-dup drops the resulting overlap harmlessly, so over-fetching is free.
 */
const RECONNECT_FROM_SKEW_MARGIN_MS = 10_000;

/**
 * Cap on how long the live tail is held while a reconnect re-backfill fetch is in flight. Past this the
 * live tail resumes and the gap is drawn honestly, rather than letting a slow/overloaded history provider
 * (bounded only by the 30s History-API HTTP timeout) freeze the chart and drop healthy live deltas.
 */
const RECONNECT_HOLD_MS = 3_000;

/** Sentinel: the re-backfill hold cap elapsed before the fetch resolved. */
const HOLD_TIMEOUT = Symbol('reconnect-hold-timeout');

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

/** Per-stream mutable state shared between the live tail and the reconnect re-backfill (#85). */
interface IStreamCtx {
  /** Client-clock timestamp of the newest emitted point (backfill, live, or re-backfill) — the seam the
   * next re-backfill de-dups against. */
  lastEmittedTs: number | null;
  /** Whether the delta stream is connected; the live tail is gated while it is not. */
  connected: boolean;
  /** True while a reconnect re-backfill is fetching, so live emissions do not interleave the seam. */
  backfillInFlight: boolean;
  /** A reconnect arrived while a re-backfill was in flight; re-run once the current one finishes so the
   * newly-missed interval is not lost to the coalescing guard. */
  reconnectPending: boolean;
  /** The live tail's observed source update interval, so the reconnect gap uses the same cadence-aware
   * staleness threshold the live tail does (null until an interval has been observed). */
  sourceIntervalMs: number | null;
  /** Set on disconnect so the first sample after a reconnect re-seeds the cadence baseline instead of
   * learning the outage duration as a spurious (inflated) interval. */
  resetCadenceBaseline: boolean;
  /** Whether the constructor backfill completed (even if empty). When it did not, the first Connected is
   * treated as a reconnect so the window is still fetched without waiting for a later WS drop. */
  seeded: boolean;
  /** Set on teardown so an in-flight async re-backfill does not emit after disposal. */
  disposed: boolean;
  /** Wall-clock deadline shared by every run in one coalesced re-backfill chain, so back-to-back re-runs
   * cannot each earn a fresh {@link RECONNECT_HOLD_MS} and stack the live-tail hold to N× the cap. Null
   * between chains; armed by the first run and cleared when the chain ends. */
  holdDeadline: number | null;
}

/**
 * Trend-chart data path: History-API backfill for the initial window, then a thin SK delta-stream
 * live tail with a minimal rolling buffer and the shared stats util. When no history provider is
 * available the stream emits {@link HISTORY_UNAVAILABLE} and trend charts degrade to a clean empty
 * state.
 */
@Injectable({ providedIn: 'root' })
export class HistoryChartStreamService {
  private readonly history = inject(HistoryApiClientService);
  private readonly mapper = inject(HistoryToChartMapperService);
  private readonly data = inject(DataService);
  private readonly connection = inject(ConnectionStateMachine);

  /**
   * Backfill (History API, one-shot) then a live delta tail. Emits the backfill as a single array,
   * then live datapoints one at a time. Emits {@link HISTORY_UNAVAILABLE} and stops when there is no
   * history provider. A *transient* backfill failure (network/5xx/timeout)
   * does not disable the chart: it falls through to the live delta tail with no backfill seed.
   */
  public getBackfillThenLive(params: IHistoryChartStreamParams): Observable<StreamEmission> {
    return new Observable<StreamEmission>(subscriber => {
      const domain = resolveAngleDomain(params.path, this.data.getPathUnitType(params.path), params.angleDomainOverride);
      const ctx: IStreamCtx = { lastEmittedTs: null, connected: true, backfillInFlight: false, reconnectPending: false, sourceIntervalMs: null, resetCadenceBaseline: false, seeded: false, disposed: false, holdDeadline: null };
      const buffer: number[] = [];
      let liveSub: Subscription | null = null;
      let reconnectSub: Subscription | null = null;
      // Release for the live tail's shared path registration; set atomically with the acquire inside
      // startLive. Stays null if disposed before the backfill settles (startLive never runs).
      let releaseLive: (() => void) | null = null;

      // Track the delta stream's connection and re-backfill on reconnect (#85). A WS drop/reconnect
      // resumes the live tail but never re-fetches the interval that elapsed during the drop, leaving a
      // silent gap. Skip the FIRST Connected only while the seed is still contemporaneous — the stream
      // has stayed connected since the constructor backfill (no disconnect seen yet). If a disconnect
      // was seen first (mounted mid-outage, so the seed and this connect are minutes apart) or the
      // window was never seeded (transient backfill failure / cold boot), treat the first Connected as a
      // reconnect and fetch the elapsed interval. Every later reconnect is preceded by a disconnect.
      const beginLive = (offsetMs: number | null, newestBackfillTs: number | null) => {
        ctx.lastEmittedTs = newestBackfillTs;
        let sawDisconnected = false;
        reconnectSub = this.connection.state$.pipe(distinctUntilChanged()).subscribe(state => {
          ctx.connected = state === ConnectionState.Connected;
          if (!ctx.connected) {
            // Drop the cadence baseline so the outage is not learned as an interval on reconnect.
            ctx.resetCadenceBaseline = true;
            sawDisconnected = true;
            return;
          }
          if (!ctx.seeded || sawDisconnected) void this.reBackfill(params, domain, buffer, subscriber, ctx);
        });
        const live = this.startLive(params, domain, buffer, offsetMs, newestBackfillTs, subscriber, ctx);
        liveSub = live.sub;
        releaseLive = live.release;
      };

      this.fetchBackfill(params, domain)
        .then(result => {
          if (ctx.disposed) return;
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
          ctx.seeded = true;
          beginLive(offsetMs, newestBackfillTs);
        })
        .catch(err => {
          if (ctx.disposed) return;
          if (err instanceof HistoryRequestError) {
            // Transient backfill failure (network blip, 5xx, timeout): don't disable the chart. Ride
            // the live delta tail with no seed so live data still renders; the first Connected then
            // drives a re-backfill (ctx.seeded is false) so the window is filled without waiting for a
            // WS drop. Only a genuine no-provider (null result above) degrades to empty.
            // offsetMs is null (no backfill anchor) → startLive derives it from the first live sample.
            beginLive(null, null);
            return;
          }
          // An unexpected error (e.g. a mapper/logic bug), not a known request failure: degrade to
          // empty but log it so a real bug is not indistinguishable from a legitimate no-provider.
          console.error('[HistoryChartStreamService] Unexpected backfill error; degrading to history-unavailable:', err);
          subscriber.next(HISTORY_UNAVAILABLE);
          subscriber.complete();
        });

      return () => {
        ctx.disposed = true;
        liveSub?.unsubscribe();
        reconnectSub?.unsubscribe();
        // Release the shared path registration after the live subscriptions that used it are torn
        // down. Balanced two ways: when disposed before the backfill settled, startLive never ran, so
        // releaseLive is still null and this is a no-op; and the release closure is idempotent, so any
        // redundant call is harmless.
        releaseLive?.();
      };
    });
  }

  private startLive(
    params: IHistoryChartStreamParams,
    domain: ChartStatsDomain,
    buffer: number[],
    offsetMs: number | null,
    newestBackfillTs: number | null,
    subscriber: { next: (v: StreamEmission) => void },
    ctx: IStreamCtx
  ): { sub: Subscription; release: () => void } {
    // One shared upstream so the freshness tracker, the immediate first value and the resampler all
    // draw from a single path registration; its release is returned so getBackfillThenLive's teardown
    // frees it once the live subscriptions below are gone.
    const handle = this.data.acquirePath(params.path, params.source);
    const path$ = handle.data$.pipe(
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
    const staleAfterMs = (): number => staleThresholdMs(intervalMs);

    const sub = new Subscription();
    // Learn the source interval from the spacing of consecutive delta timestamps.
    sub.add(path$.subscribe(u => {
      const ts = sourceTsOf(u);
      if (!Number.isFinite(ts)) return;
      if (ctx.resetCadenceBaseline) {
        // First sample after a disconnect: re-seed the baseline (do not measure the outage as an
        // interval, which would inflate the cadence and suppress the reconnect gap).
        ctx.resetCadenceBaseline = false;
        prevSourceTs = ts;
        return;
      }
      if (prevSourceTs !== null) {
        const gap = ts - prevSourceTs;
        if (gap > 0) intervalMs = intervalMs === null ? gap : 0.3 * gap + 0.7 * intervalMs;
      }
      prevSourceTs = ts;
      // Publish the learned cadence so the reconnect gap uses the same staleness threshold.
      ctx.sourceIntervalMs = intervalMs;
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
      // While the stream is disconnected (all sources silent) or a reconnect re-backfill is filling the
      // seam, hold the live tail: otherwise the sampled$ replay of the last stale value would fire a gap
      // marker mid-drop that the later re-backfill batch cannot order cleanly against.
      if (!ctx.connected || ctx.backfillInFlight) return;
      // Stamp with the client clock so points sit on the chart's realtime axis;
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
      ctx.lastEmittedTs = now;
      const stats = computeWindowStats(buffer, params.smoothingPeriod, domain);
      subscriber.next({ timestamp: now, data: { ...stats } });
    }));
    return { sub, release: handle.release };
  }

  private async fetchBackfill(params: IHistoryChartStreamParams, domain: ChartStatsDomain, fromMs: number = Date.now() - params.windowMs, signal?: AbortSignal): Promise<{ points: IDatasetServiceDatapoint[]; offsetMs: number } | null> {
    const normalizedPath = params.path.replace(/^(vessels\.)?self\./, '');
    // Only the raw per-bucket value is fetched; the SMA overlay is derived client-side below so it
    // uses the same circular-aware smoothing as the live tail (#162).
    const paths = `${normalizedPath}:last`;
    const resolutionSeconds = Math.max(1, Math.round(params.sampleTime / 1000));

    const response = await this.history.getValues({
      paths,
      from: new Date(fromMs).toISOString(),
      resolution: resolutionSeconds
    }, signal);
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
    const mappedPoints = mapped.filter(m => m.data.value !== null && m.data.value !== undefined);
    // Derive the SMA overlay client-side from the :last samples with the same shared trailing-window
    // smoothing the live tail uses (circular for angle domains), so the line is angle-correct at the
    // 0/360° wrap and continuous across the backfill→live seam.
    const values = mappedPoints.map(m => m.data.value as number);
    const smoothingPeriod = Math.max(1, params.smoothingPeriod);
    const points = mappedPoints.map((m, i) => ({
      timestamp: m.timestamp + offsetMs,
      data: {
        value: m.data.value as number,
        sma: windowSma(values.slice(Math.max(0, i - smoothingPeriod + 1), i + 1), domain),
        lastAverage: m.data.lastAverage ?? undefined,
        lastMinimum: m.data.lastMinimum ?? undefined,
        lastMaximum: m.data.lastMaximum ?? undefined
      }
    }));
    return { points, offsetMs };
  }

  /**
   * Re-fetch the interval missed during a WS drop and emit it as a batch so the live tail's gap is
   * filled (#85). Covers only [max(seam - skew margin, now - windowMs), now] and drops points at or
   * before the seam, so the batch appends cleanly and in order against the buffered/live points. The
   * live tail is held only until the fetch resolves or the coalesced chain's shared {@link RECONNECT_HOLD_MS}
   * budget elapses (whichever comes first), so a slow provider cannot freeze the chart even under sustained
   * WS flapping; when the budget wins, the abandoned fetch's HTTP request is aborted so stale GETs do not
   * stack on the struggling provider. If the re-backfill delivers nothing (empty, error, or hold-timeout),
   * {@link emitReconnectGap} breaks the trace so the live tail does not interpolate.
   */
  private async reBackfill(
    params: IHistoryChartStreamParams,
    domain: ChartStatsDomain,
    buffer: number[],
    subscriber: { next: (v: StreamEmission) => void },
    ctx: IStreamCtx
  ): Promise<void> {
    // A reconnect that arrives while a re-backfill is in flight is coalesced: mark it pending so the
    // in-flight run re-runs from the (advanced) seam afterwards, rather than dropping the newly-missed
    // interval silently.
    if (ctx.backfillInFlight || ctx.disposed) {
      if (ctx.backfillInFlight && !ctx.disposed) ctx.reconnectPending = true;
      return;
    }
    ctx.backfillInFlight = true;
    ctx.reconnectPending = false;
    // Arm the coalesced chain's shared hold budget on its first run; every coalesced re-run then races the
    // REMAINING budget, so a storm of re-runs holds the live tail for one RECONNECT_HOLD_MS total rather
    // than a fresh cap each.
    if (ctx.holdDeadline === null) ctx.holdDeadline = Date.now() + RECONNECT_HOLD_MS;
    const seam = ctx.lastEmittedTs;
    let delivered = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    try {
      const earliest = Date.now() - params.windowMs;
      const fromMs = seam !== null ? Math.max(seam - RECONNECT_FROM_SKEW_MARGIN_MS, earliest) : earliest;
      const fetchPromise = this.fetchBackfill(params, domain, fromMs, controller.signal);
      // If the hold budget wins the race we abandon this fetch; swallow its late rejection so it does not
      // surface as an unhandled rejection.
      fetchPromise.catch(() => undefined);
      const remainingHoldMs = Math.max(0, ctx.holdDeadline - Date.now());
      const outcome = await Promise.race([
        fetchPromise,
        new Promise<typeof HOLD_TIMEOUT>(resolve => { holdTimer = setTimeout(() => resolve(HOLD_TIMEOUT), remainingHoldMs); })
      ]);
      if (outcome === HOLD_TIMEOUT || ctx.disposed) {
        // The chain's hold budget elapsed (or the stream was torn down): abort the abandoned fetch so its
        // HTTP GET is cancelled now rather than left to self-terminate at the 30s timeout and stack.
        controller.abort();
      }
      if (ctx.disposed) return;
      // outcome === HOLD_TIMEOUT: the provider is too slow — stop holding the live tail and fall through
      // to the honest gap below rather than freeze the chart for up to the 30s HTTP timeout.
      if (outcome !== HOLD_TIMEOUT) {
        const fresh = outcome === null ? [] : (seam !== null ? outcome.points.filter(p => p.timestamp > seam) : outcome.points);
        if (fresh.length > 0) {
          for (const p of fresh) {
            if (Number.isFinite(p.data.value)) buffer.push(p.data.value);
          }
          this.trim(buffer, params.maxDataPoints);
          ctx.lastEmittedTs = fresh[fresh.length - 1].timestamp;
          subscriber.next(fresh);
          delivered = true;
        }
      }
    } catch (err) {
      if (ctx.disposed) return;
      // A transient error/timeout is expected when the history provider is down or slow; only an
      // unexpected error is worth surfacing. Either path falls through to the honest-gap decision below.
      if (!(err instanceof HistoryRequestError)) {
        console.error('[HistoryChartStreamService] Unexpected re-backfill error:', err);
      }
    } finally {
      if (holdTimer !== null) clearTimeout(holdTimer);
      ctx.backfillInFlight = false;
      if (!ctx.disposed) {
        const budgetSpent = ctx.holdDeadline !== null && Date.now() >= ctx.holdDeadline;
        if (ctx.reconnectPending && ctx.connected && !budgetSpent) {
          // A reconnect landed mid-fetch and the shared budget is not yet spent; run it now from the
          // current seam under the same deadline and defer the gap decision to it.
          void this.reBackfill(params, domain, buffer, subscriber, ctx);
        } else {
          // The chain ends here (delivered, budget spent, or nothing pending): re-arm a fresh budget on the
          // next reconnect, and break the trace honestly if this run drew nothing.
          ctx.holdDeadline = null;
          if (!delivered) this.emitReconnectGap(subscriber, ctx);
        }
      }
    }
  }

  /**
   * Break the trace at the seam when a reconnect re-backfill could not fill the gap — but only if the
   * outage exceeds what the source's own update cadence would explain, so a drop shorter than the live
   * tail's own staleness threshold (a slow source that simply had no new sample) draws no marker.
   */
  private emitReconnectGap(subscriber: { next: (v: StreamEmission) => void }, ctx: IStreamCtx): void {
    if (ctx.lastEmittedTs !== null && Date.now() - ctx.lastEmittedTs > staleThresholdMs(ctx.sourceIntervalMs)) {
      const now = Date.now();
      subscriber.next({ timestamp: now, data: { ...GAP_POINT } });
      // Advance the seam to the gap so a later re-backfill de-dups (> seam) any backdated points a
      // lagging provider ingests after the fact, keeping emissions monotonic rather than drawing behind
      // the break.
      ctx.lastEmittedTs = now;
    }
  }

  private trim(buffer: number[], maxDataPoints: number): void {
    if (buffer.length > maxDataPoints) {
      buffer.splice(0, buffer.length - maxDataPoints);
    }
  }
}
