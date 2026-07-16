import { Injectable, inject, DestroyRef } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { firstValueFrom, fromEvent, takeUntil, timeout } from 'rxjs';

/** A backfill request that hangs past this is treated as a transient failure, not left to spin forever. */
const HISTORY_VALUES_TIMEOUT_MS = 30_000;
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AggregateMethod, TimeRangeQueryParams } from '@signalk/server-api/history';
import { SignalKConnectionService } from './signalk-connection.service';

/**
 * A History `getValues` request failed for a *transient* reason (network error, timeout, or a 5xx
 * server error) — as opposed to the server having no history provider (see {@link HistoryApiClientService.getValues}).
 * Callers distinguish this from a `null` return so a passing blip does not read as a permanent absence.
 */
export class HistoryRequestError extends Error {
  constructor(public readonly status: number, public readonly reason?: unknown) {
    super(`History API request failed (status ${status})`);
    this.name = 'HistoryRequestError';
  }
}

/**
 * Represents a single series metadata from the History API response.
 */
interface IHistoryValueMetadata {
  path: string;
  method?: AggregateMethod | 'avg'; // keep 'avg' for compatibility with existing backends/tests
}

/**
 * Complete response from the History API /values endpoint.
 */
export interface IHistoryValuesResponse {
  context: string;
  range: {
    from: string;
    to: string;
  };
  values: IHistoryValueMetadata[];
  data: (string | number | null | number[])[][];
}

/**
 * Query parameters supported by the /history/values endpoint in this app.
 *
 * Extends server-api query params while preserving current app compatibility:
 * - allows string `resolution` passthrough (e.g. `PT1S`)
 * - requires `paths` for the HTTP endpoint variant used by KIP
 */
export type IHistoryValuesQueryParams = Partial<TimeRangeQueryParams> & {
  paths: string;
  context?: string;
  resolution?: number | string;
};

/**
 * Query parameters supported by history endpoints that only require a time range.
 */
type IHistoryTimeRangeQueryParams = Partial<TimeRangeQueryParams>;

@Injectable({
  providedIn: 'root'
})
export class HistoryApiClientService {
  private http = inject(HttpClient);
  private connection = inject(SignalKConnectionService);
  private destroyRef = inject(DestroyRef);

  private historyServiceUrl: string | null = null;

  constructor() {
    // Monitor endpoint changes; derive v2 history URL from the published v1 endpoint.
    this.connection.serverServiceEndpoint$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(endpoint => {
        const httpServiceUrl = endpoint?.httpServiceUrl || null;
        this.historyServiceUrl = httpServiceUrl ? httpServiceUrl.replace('/v1/', '/v2/') : null;
        if (!this.historyServiceUrl) {
          console.warn(`[HistoryApiClientService] History API endpoint not available; history service is disabled`);
        }
      });
  }

  /**
   * Gets paths that have historical data available for the specified time range.
   *
   * @param {IHistoryTimeRangeQueryParams} params - Optional time range parameters.
   *   - from: Start of the time range (ISO 8601), optional
   *   - to: End of the time range (ISO 8601), optional
   *   - duration: Duration of the time range (ISO 8601 or milliseconds), optional
   *
   * @returns {Promise<string[] | null>} Array of Signal K paths with historical data, or null if the request fails.
   *
   * @example
   *   const paths = await historyService.getPaths({
   *     from: new Date(Date.now() - 3600000).toISOString(),
   *     to: new Date().toISOString()
   *   });
   *   if (paths) {
   *     console.log('Available paths:', paths);
   *   }
   *
   * @memberof HistoryApiClientService
   */
  public async getPaths(params?: IHistoryTimeRangeQueryParams): Promise<string[] | null> {
    try {
      if (!this.historyServiceUrl) {
        console.warn('[HistoryApiClientService] No HTTP service URL available');
        return null;
      }

      const historyUrl = `${this.historyServiceUrl}history/paths`;
      let httpParams = new HttpParams();

      // Build query parameters (time range only, no paths needed)
      if (params?.from) {
        httpParams = httpParams.set('from', params.from);
      }
      if (params?.to) {
        httpParams = httpParams.set('to', params.to);
      }
      if (params?.duration) {
        httpParams = httpParams.set('duration', params.duration.toString());
      }

      const fullUrl = `${historyUrl}?${httpParams.toString()}`;
      console.log(`[HistoryApiClientService] GET ${fullUrl}`);

      const response = await firstValueFrom(
        this.http.get<string[]>(historyUrl, { params: httpParams })
      );

      console.log(`[HistoryApiClientService] Retrieved ${response?.length ?? 0} available paths`);
      return response;
    } catch (error) {
      console.error('[HistoryApiClientService] History API /paths request failed:', error);
      return null;
    }
  }

  /**
   * Gets contexts that have historical data available for the specified time range.
   *
   * @param {IHistoryTimeRangeQueryParams} params - Optional time range parameters.
   *   - from: Start of the time range (ISO 8601), optional
   *   - to: End of the time range (ISO 8601), optional
   *   - duration: Duration of the time range (ISO 8601 or milliseconds), optional
   *
   * @returns {Promise<string[] | null>} Array of Signal K contexts with historical data, or null if the request fails.
   *
   * @example
   *   const contexts = await historyService.getContexts({ duration: 'PT1H' });
   *   if (contexts) {
   *     console.log('Available contexts:', contexts);
   *   }
   *
   * @memberof HistoryApiClientService
   */
  public async getContexts(params?: IHistoryTimeRangeQueryParams): Promise<string[] | null> {
    try {
      if (!this.historyServiceUrl) {
        console.warn('[HistoryApiClientService] No HTTP service URL available');
        return null;
      }

      const historyUrl = `${this.historyServiceUrl}history/contexts`;
      let httpParams = new HttpParams();

      // Build query parameters (time range only)
      if (params?.from) {
        httpParams = httpParams.set('from', params.from);
      }
      if (params?.to) {
        httpParams = httpParams.set('to', params.to);
      }
      if (params?.duration) {
        httpParams = httpParams.set('duration', params.duration.toString());
      }

      const fullUrl = `${historyUrl}?${httpParams.toString()}`;
      console.log(`[HistoryApiClientService] GET ${fullUrl}`);

      const response = await firstValueFrom(
        this.http.get<string[]>(historyUrl, { params: httpParams })
      );

      console.log(`[HistoryApiClientService] Retrieved ${response?.length ?? 0} available contexts`);
      return response;
    } catch (error) {
      console.error('[HistoryApiClientService] History API /contexts request failed:', error);
      return null;
    }
  }

  /**
   * Fetches historical data from the Signal K History API.
   *
   * The History API must be available on the Signal K server. History data
   * is populated by installed plugins such as signalk-to-influxdb2 or
   * signalk-parquet. If no history is available or the API is not installed,
   * the request will fail.
   *
   * @param {IHistoryValuesQueryParams} params - Query parameters for the history request.
   *   - paths (required): comma-separated Signal K paths with optional aggregation suffixes
   *     (e.g., 'navigation.speedOverGround:sma:5,navigation.speedThroughWater:avg')
   *   - from, to, duration: define the time range
   *   - resolution: optional downsampling window
   *   - context: optional Signal K context (defaults to 'vessels.self')
   * @param {AbortSignal} [signal] - Aborts the in-flight request, cancelling the underlying HTTP GET so
   *   a caller that has abandoned the fetch (e.g. a reconnect re-backfill past its hold cap) does not
   *   leave it running until the 30s timeout.
   *
   * @returns {Promise<IHistoryValuesResponse | null>} The history response, or `null` when the server
   *   has no history provider (no service URL, or a 404/501 response).
   * @throws {HistoryRequestError} on a transient failure (network error, timeout, or 5xx) — distinct
   *   from the no-provider `null` so callers can retry or fall back to live data.
   *
   * @example
   *   const response = await historyService.getValues({
   *     paths: 'navigation.speedThroughWater:avg,navigation.speedThroughWater:min',
   *     from: new Date(Date.now() - 3600000).toISOString(),
   *     to: new Date().toISOString(),
   *     resolution: 1
   *   });
   *   if (response) {
   *     for (const [timestamp, ...values] of response.data) {
   *       console.log(timestamp, values);
   *     }
   *   }
   *
   * @memberof HistoryApiClientService
   */
  public async getValues(params: IHistoryValuesQueryParams, signal?: AbortSignal): Promise<IHistoryValuesResponse | null> {
    try {
      if (!this.historyServiceUrl) {
        console.warn('[HistoryApiClientService] No HTTP service URL available');
        return null;
      }

      const historyUrl = `${this.historyServiceUrl}history/values`;
      let httpParams = new HttpParams();

      // Build query parameters
      httpParams = httpParams.set('paths', params.paths);
      if (params.context) {
        httpParams = httpParams.set('context', params.context);
      }
      if (params.from) {
        httpParams = httpParams.set('from', params.from);
      }
      if (params.to) {
        httpParams = httpParams.set('to', params.to);
      }
      if (params.duration) {
        httpParams = httpParams.set('duration', params.duration.toString());
      }
      if (params.resolution !== undefined && params.resolution !== null) {
        httpParams = httpParams.set('resolution', params.resolution.toString());
      }

      const fullUrl = `${historyUrl}?${httpParams.toString()}`;
      console.log(`[HistoryApiClientService] GET ${fullUrl}`);

      const request$ = this.http.get<IHistoryValuesResponse>(historyUrl, { params: httpParams }).pipe(
        timeout(HISTORY_VALUES_TIMEOUT_MS)
      );
      const response = await firstValueFrom(
        // An abort unsubscribes the request, which cancels the underlying HTTP GET instead of leaving it
        // to run until the timeout.
        signal ? request$.pipe(takeUntil(fromEvent(signal, 'abort'))) : request$
      );

      console.log(`[HistoryApiClientService] History fetch successful, received ${response.data?.length ?? 0} data points`);
      return response;
    } catch (error) {
      if (signal?.aborted) {
        // Cancelled by the caller, not a server/network failure: surface a benign request error the
        // caller already discards, without logging it as a failure.
        throw new HistoryRequestError(0, error);
      }
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      // 404 / 501: the server has no history provider (plugin/API missing) — a stable "unavailable",
      // reported as null so trend charts degrade to a clean empty state.
      if (status === 404 || status === 501) {
        console.warn(`[HistoryApiClientService] History API not available (status ${status}); no provider`);
        return null;
      }
      // Any other failure — network error, timeout (status 0), 5xx, or an unexpected 4xx — is surfaced
      // as a request error rather than null, so the caller can fall back to live data instead of
      // claiming history is permanently absent. Only the 404/501 above mean "no provider".
      console.error('[HistoryApiClientService] History API request failed:', error);
      throw new HistoryRequestError(status, error);
    }
  }

}
