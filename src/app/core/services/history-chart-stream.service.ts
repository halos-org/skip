import { Injectable, inject } from '@angular/core';
import { Observable, Subscription, filter, merge, take, timer, withLatestFrom } from 'rxjs';
import { DataService } from './data.service';
import { HistoryApiClientService } from './history-api-client.service';
import { HistoryToChartMapperService, THistoryChartAngleDomain } from './history-to-chart-mapper.service';
import { SettingsService } from './settings.service';
import { IDatasetServiceDatapoint } from './dataset-stream.service';
import { computeWindowStats, ChartStatsDomain } from '../utils/chart-stats.util';
import { createChartPerfProbe, IChartPerfProbe } from '../utils/chart-perf.util';

/** Emitted (instead of datapoints) when trend history cannot be served — no history provider. */
export interface IHistoryUnavailable {
  unavailable: true;
}
export const HISTORY_UNAVAILABLE: IHistoryUnavailable = { unavailable: true };

export function isHistoryUnavailable(v: unknown): v is IHistoryUnavailable {
  return !!v && typeof v === 'object' && (v as IHistoryUnavailable).unavailable === true;
}

/** Inputs for one chart's History-API-backed data stream. */
export interface IHistoryChartStreamParams {
  path: string;
  source: string;
  /** Base unit — `'rad'` selects circular aggregation. */
  unit: string;
  domain: ChartStatsDomain;
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
   * history provider (or history is disabled) — no live-only fallback.
   */
  public getBackfillThenLive(params: IHistoryChartStreamParams): Observable<StreamEmission> {
    return new Observable<StreamEmission>(subscriber => {
      const perf = createChartPerfProbe('history');
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

      this.fetchBackfill(params, perf)
        .then(batch => {
          if (disposed) return;
          if (batch === null) {
            subscriber.next(HISTORY_UNAVAILABLE);
            subscriber.complete();
            return;
          }
          subscriber.next(batch);
          for (const p of batch) {
            if (Number.isFinite(p.data.value)) buffer.push(p.data.value);
          }
          this.trim(buffer, params.maxDataPoints);
          liveSub = this.startLive(params, buffer, perf, subscriber);
        })
        .catch(() => {
          if (!disposed) {
            subscriber.next(HISTORY_UNAVAILABLE);
            subscriber.complete();
          }
        });

      return () => {
        disposed = true;
        liveSub?.unsubscribe();
      };
    });
  }

  private startLive(
    params: IHistoryChartStreamParams,
    buffer: number[],
    perf: IChartPerfProbe,
    subscriber: { next: (v: StreamEmission) => void }
  ): Subscription {
    const path$ = this.data.subscribePath(params.path, params.source).pipe(
      filter(u => u?.data?.value !== null && u?.data?.value !== undefined)
    );
    // Zero-order hold: resample the latest value at the derived cadence, emitting immediately on the
    // first value so the live tail starts without waiting a full sample interval.
    const sampled$ = timer(params.sampleTime, params.sampleTime).pipe(
      withLatestFrom(path$, (tick, u) => u)
    );
    return merge(path$.pipe(take(1)), sampled$).subscribe(u => {
      const value = Number(u.data.value);
      if (!Number.isFinite(value)) return;
      buffer.push(value);
      this.trim(buffer, params.maxDataPoints);
      const stats = computeWindowStats(buffer, params.smoothingPeriod, params.domain);
      const timestamp = u.data.timestamp instanceof Date ? u.data.timestamp.getTime() : Date.now();
      perf.recordLive(timestamp);
      subscriber.next({ timestamp, data: { ...stats } });
    });
  }

  private async fetchBackfill(params: IHistoryChartStreamParams, perf: IChartPerfProbe): Promise<IDatasetServiceDatapoint[] | null> {
    const normalizedPath = params.path.replace(/^(vessels\.)?self\./, '');
    const paths = [
      `${normalizedPath}:sma:${params.smoothingPeriod}`,
      `${normalizedPath}:avg`,
      `${normalizedPath}:min`,
      `${normalizedPath}:max`
    ].join(',');
    const resolutionSeconds = Math.max(1, Math.round(params.sampleTime / 1000));

    perf.startBackfill();
    const response = await this.history.getValues({
      paths,
      from: new Date(Date.now() - params.windowMs).toISOString(),
      resolution: resolutionSeconds
    });
    if (!response) {
      return null;
    }
    const mapped = this.mapper.mapValuesToChartDatapoints(response, {
      unit: params.unit,
      domain: params.domain as THistoryChartAngleDomain
    });
    if (perf.enabled) {
      perf.endBackfill(mapped.length, JSON.stringify(response).length);
    }
    return mapped
      .filter(m => m.data.value !== null && m.data.value !== undefined)
      .map(m => ({
        timestamp: m.timestamp,
        data: {
          value: m.data.value as number,
          sma: m.data.sma ?? undefined,
          lastAverage: m.data.lastAverage ?? undefined,
          lastMinimum: m.data.lastMinimum ?? undefined,
          lastMaximum: m.data.lastMaximum ?? undefined
        }
      }));
  }

  private trim(buffer: number[], maxDataPoints: number): void {
    if (buffer.length > maxDataPoints) {
      buffer.splice(0, buffer.length - maxDataPoints);
    }
  }
}
