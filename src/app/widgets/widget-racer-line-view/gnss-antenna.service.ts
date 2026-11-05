import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap, timeout, timer } from 'rxjs';
import { SignalKConnectionService } from '../../core/services/signalk-connection.service';
import { resolveSignalKV2ApiBaseUrl } from '../../core/utils/signalk-plugin-url.util';
import { canonicalSourceMap, IGnssConfig } from './bow-position.util';

/** How often the configuration is read again: `status.active` changes when the heading drops out. */
export const GNSS_POLL_INTERVAL_MS = 30_000;
const GNSS_REQUEST_TIMEOUT_MS = 10_000;

/**
 * The server's GNSS antenna configuration (`GET /signalk/v2/api/vessels/self/sensors/gnss`,
 * 2.31+), the N2K source map needed to match a position's `$source` against it, and the server
 * version - the inputs `positionOffsets()` takes from the server rather than the delta stream.
 *
 * One instance serves every consumer. It does nothing until {@link ensureStarted}; from then on it
 * polls every {@link GNSS_POLL_INTERVAL_MS}. The API is absent before 2.31 and may need a session
 * on a secured server, so any failure reads as "no configuration" and the caller falls through to
 * `sensors.gps`.
 */
@Injectable({ providedIn: 'root' })
export class GnssAntennaService {
  private readonly http = inject(HttpClient);
  private readonly connection = inject(SignalKConnectionService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _config = signal<IGnssConfig | null>(null);
  private readonly _sourceMap = signal<Map<string, string>>(new Map());

  /** The GNSS configuration, or null when the server has none or it could not be read. */
  public readonly config = this._config.asReadonly();
  /** N2K address source to CAN name source; empty when unknown. */
  public readonly sourceMap = this._sourceMap.asReadonly();
  public readonly serverVersion = toSignal(this.connection.serverVersion$, { initialValue: null });

  private started = false;

  /** Starts polling. Idempotent, so every consumer may call it. */
  public ensureStarted(): void {
    if (this.started) return;
    this.started = true;

    this.connection.serverServiceEndpoint$.pipe(
      map(endpoint => ({
        v2: resolveSignalKV2ApiBaseUrl(endpoint.httpServiceUrlV2, endpoint.httpServiceUrl, this.connection.signalKURL?.url),
        v1: endpoint.httpServiceUrl ? endpoint.httpServiceUrl.replace(/\/?$/, '/') : null
      })),
      switchMap(urls => urls.v2 ? timer(0, GNSS_POLL_INTERVAL_MS).pipe(
        switchMap(() => this.read(`${urls.v2}/vessels/self/sensors/gnss`)),
        switchMap(body => {
          const config = body as IGnssConfig | null;
          // The map is only needed to match a configured antenna.
          const hasSensors = Array.isArray(config?.sensors) && config.sensors.length > 0;
          const sources$ = hasSensors && urls.v1 ? this.read(`${urls.v1}sources`) : of(null);
          return sources$.pipe(map(sources => ({ config, sources })));
        })
      ) : of({ config: null, sources: null })),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(({ config, sources }) => {
      // Published together, so a configuration is never matched against another poll's map.
      // A map that could not be read is dropped rather than kept: after an N2K address is
      // reassigned, a stale one would match the position to the wrong antenna.
      this._config.set(config);
      this._sourceMap.set(sources ? canonicalSourceMap(sources) : new Map());
    });
  }

  /** `canonical` for `positionOffsets()`: the CAN name form of a source, or the source itself. */
  public canonical(ref: string): string {
    return this._sourceMap().get(ref) ?? ref;
  }

  private read(url: string) {
    return this.http.get<unknown>(url).pipe(
      timeout(GNSS_REQUEST_TIMEOUT_MS),
      map(body => body && typeof body === 'object' ? body : null),
      catchError(() => of(null))
    );
  }
}
