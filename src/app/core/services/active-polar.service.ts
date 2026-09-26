import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, filter, map, skip, Subscription, take, timeout } from 'rxjs';
import { DataService, IPathUpdate } from './data.service';
import { SignalKConnectionService } from './signalk-connection.service';
import { ConnectionState, ConnectionStateMachine } from './connection-state-machine.service';
import { AuthenticationService, ILoginStatus } from './authentication.service';
import { resolveSignalKV2ApiBaseUrl } from '../utils/signalk-plugin-url.util';
import { Polar, toCanonicalPolarTable } from '../utils/polar-engine.util';

export type ActivePolarStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'no-active-polar' }
  /** `cause` is the HTTP status, or `'network'` when no response arrived. */
  | { kind: 'fetch-failed'; cause: number | 'network' }
  | { kind: 'invalid-table' };

const ACTIVE_POLAR_PATH = 'self.polars.activePolar';
/** The same value over v1 REST, relative to the v1 API root. */
const ACTIVE_POLAR_REST_PATH = 'vessels/self/polars/activePolar';
const PERFORMANCE_FACTOR_PATH = 'self.polars.performanceFactor';
const DEFAULT_PERFORMANCE_FACTOR = 1;
/**
 * The only href shape accepted: one path segment under the polars collection, with no query or
 * fragment. The segment may be raw or percent-encoded, so ids with spaces, `+` or non-ASCII letters
 * pass. {@link parsePolarId} decodes it and rejects a decoded id with a slash, a backslash, a lone dot
 * or any `..`, and {@link ActivePolarService} re-encodes it as a single segment, so an id can never
 * climb out of the polars collection or reach another host. Single dots are allowed because some
 * providers use dotted ids.
 */
const ACTIVE_POLAR_HREF = /^\/resources\/polars\/([^/?#\\]+)$/;
const PERCENT_ESCAPE_RUN = /(?:%[0-9A-Fa-f]{2})+/g;
/**
 * Bound on each request, so one that never answers counts as failed instead of leaving the status
 * at loading. The same bound as History API reads, the other GET served by a provider plugin.
 */
export const ACTIVE_POLAR_REQUEST_TIMEOUT_MS = 30_000;
const NO_HTTP_RESPONSE_STATUS = 0;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const LOG_PREFIX = '[ActivePolarService]';

const MESSAGES = {
  noActivePolar: 'The Signal K server has no active polar.',
  unauthorized: 'Sign in to read the active polar.',
  notFound: 'The active polar was not found on the Signal K server.',
  network: 'The Signal K server did not answer the request for the active polar.',
  httpError: 'The active polar could not be loaded from the Signal K server.',
  invalidTable: 'The active polar table is not in a format Skip can read.'
} as const;

/**
 * The server's active polar (`polars.activePolar`), fetched from the v2 Resources API and prepared
 * for interpolation, plus the performance factor. One instance serves every consumer, so several
 * widgets share one fetch. It does nothing until a consumer calls {@link ensureStarted}; from then
 * on it follows the active polar for the app lifetime.
 *
 * A server with no polar provider never sends `polars.activePolar`, so on start the service also reads
 * the path over v1 REST: a 404 there, before any delta, means there is no active polar. A REST read
 * that fails otherwise is repeated on a server reconnect, a session change or {@link refreshIfFailed},
 * for as long as no answer or delta has settled the path.
 *
 * After a load it fetches again only on an href change or a session change, so a table loaded under
 * one session never outlives it. After a failed fetch it retries the same href on a server reconnect
 * or {@link refreshIfFailed}; after an invalid table only on {@link refreshIfFailed}. Every request
 * gives up after {@link ACTIVE_POLAR_REQUEST_TIMEOUT_MS}, which counts as a failure.
 */
@Injectable({ providedIn: 'root' })
export class ActivePolarService {
  private readonly http = inject(HttpClient);
  private readonly data = inject(DataService);
  private readonly connection = inject(SignalKConnectionService);
  private readonly connectionState = inject(ConnectionStateMachine);
  private readonly auth = inject(AuthenticationService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _status = signal<ActivePolarStatus>({ kind: 'idle' });
  private readonly _polar = signal<Polar | null>(null);
  private readonly _peakSpeed = signal<number | null>(null);
  private readonly _performanceFactor = signal(DEFAULT_PERFORMANCE_FACTOR);

  public readonly status = this._status.asReadonly();
  /** The active polar, non-null only while {@link status} is ready. */
  public readonly polar = this._polar.asReadonly();
  /** Fastest table speed at any TWS at factor 1, m/s; non-null only while ready. */
  public readonly peakSpeed = this._peakSpeed.asReadonly();
  /** `polars.performanceFactor`, or 1 when missing, non-finite, or not positive. */
  public readonly performanceFactor = this._performanceFactor.asReadonly();
  /** A fixed user-facing explanation when the polar cannot be used; null while idle, loading or ready. */
  public readonly message = computed(() => statusMessage(this._status()));

  private started = false;
  private v1BaseUrl: string | null = null;
  private v2BaseUrl: string | null = null;
  /** Undefined until the path delivers its first value; null when there is no usable active polar. */
  private activeId: string | null | undefined = undefined;
  private requestedUrl: string | null = null;
  private request: Subscription | null = null;
  private restRead: Subscription | null = null;

  /** Starts following the active polar. Idempotent, so every consumer may call it. */
  public ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    this._status.set({ kind: 'loading' });

    // Subscribed before the endpoint, so a value already cached is known before the REST read below.
    this.data.subscribePath(ACTIVE_POLAR_PATH, 'default')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(update => this.onActivePolar(update));

    // Endpoint discovery re-runs on every reconnect; the fetch repeats only if the URL it yields
    // differs from the one already requested.
    this.connection.serverServiceEndpoint$
      .pipe(
        map(endpoint => resolveSignalKV2ApiBaseUrl(endpoint.httpServiceUrlV2, endpoint.httpServiceUrl, this.connection.signalKURL?.url)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(base => {
        this.v2BaseUrl = base;
        this.load(false);
      });

    this.connection.serverServiceEndpoint$
      .pipe(
        map(endpoint => endpoint.httpServiceUrl),
        filter((url): url is string => !!url),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(v1Url => {
        this.v1BaseUrl = v1Url.endsWith('/') ? v1Url : `${v1Url}/`;
        this.readActivePolarOverRest();
      });

    this.data.subscribePath(PERFORMANCE_FACTOR_PATH, 'default')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(update => this._performanceFactor.set(toPerformanceFactor(update.data.value)));

    this.connectionState.state$
      .pipe(
        map(state => state === ConnectionState.Connected),
        distinctUntilChanged(),
        skip(1),
        filter(connected => connected),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.readActivePolarOverRest();
        if (this._status().kind === 'fetch-failed') this.load(true);
      });

    this.auth.loginStatus$
      .pipe(map(sessionKey), distinctUntilChanged(), skip(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.readActivePolarOverRest();
        this.load(true);
      });
  }

  /**
   * Starts the service if needed and retries whatever last failed: the REST read of the active
   * polar, or the table after a failed fetch or an invalid table.
   */
  public refreshIfFailed(): void {
    this.ensureStarted();
    this.readActivePolarOverRest();
    const kind = this._status().kind;
    if (kind === 'fetch-failed' || kind === 'invalid-table') this.load(true);
  }

  private onActivePolar(update: IPathUpdate): void {
    const { value, timestamp } = update.data;
    // The replayed bootstrap and a local timeout reset carry no timestamp: no news from the server.
    if ((value === null || value === undefined) && timestamp === null) return;
    // The stream is the authority once it has spoken, so a REST answer still in flight is stale.
    this.cancelRestRead();
    this.applyActivePolarValue(value);
  }

  /**
   * Reads the path's current value, for a server that never sends it as a delta. Does nothing once
   * the path is settled, while a read is in flight, or before the v1 endpoint is known.
   */
  private readActivePolarOverRest(): void {
    if (this.activeId !== undefined || this.restRead !== null || this.v1BaseUrl === null) return;
    const url = `${this.v1BaseUrl}${ACTIVE_POLAR_REST_PATH}`;
    this.restRead = this.http.get<unknown>(url).pipe(timeout(ACTIVE_POLAR_REQUEST_TIMEOUT_MS)).subscribe({
      next: body => {
        this.restRead = null;
        if (this.activeId !== undefined) return;
        // A v1 leaf answers `{ value, $source, timestamp }`; anything else says nothing about the polar.
        if (typeof body !== 'object' || body === null || !('value' in body)) return;
        this.applyActivePolarValue((body as { value: unknown }).value);
      },
      error: (error: unknown) => {
        this.restRead = null;
        if (this.activeId !== undefined) return;
        if (error instanceof HttpErrorResponse && error.status === HTTP_NOT_FOUND) {
          this.applyActivePolarValue(null);
          return;
        }
        // Anything else says nothing about the polar; a later delta or a retry still settles it.
        console.debug(`${LOG_PREFIX} REST read of activePolar failed:`, error instanceof HttpErrorResponse ? error.status : error);
      }
    });
  }

  private applyActivePolarValue(value: unknown): void {
    if (value === null || value === undefined) {
      this.activeId = null;
    } else {
      this.activeId = parsePolarId(value);
      if (this.activeId === null) console.warn(`${LOG_PREFIX} Ignoring unsupported activePolar value:`, value);
    }
    this.load(false);
  }

  private cancelRestRead(): void {
    this.restRead?.unsubscribe();
    this.restRead = null;
  }

  /** Fetches the active polar when its URL changed, or always when `force` is set. */
  private load(force: boolean): void {
    if (this.activeId === undefined) return;
    if (this.activeId === null) {
      this.cancelRequest();
      this.clearPolar({ kind: 'no-active-polar' });
      return;
    }
    if (this.v2BaseUrl === null) return;

    const url = `${this.v2BaseUrl}/resources/polars/${encodeURIComponent(this.activeId)}`;
    if (!force && url === this.requestedUrl) return;

    // Unsubscribing cancels a pending request, so a response for a superseded URL never arrives.
    this.cancelRequest();
    this.requestedUrl = url;
    this.clearPolar({ kind: 'loading' });
    this.request = this.http.get<unknown>(url).pipe(timeout(ACTIVE_POLAR_REQUEST_TIMEOUT_MS)).subscribe({
      next: body => this.applyTable(body),
      error: (error: unknown) => this.applyError(error)
    });
  }

  private applyTable(body: unknown): void {
    let prepared: PreparedPolar;
    try {
      prepared = preparePolar(body);
    } catch (error: unknown) {
      // A table the guard passes can still overflow the engine, e.g. a matrix too large to spread.
      prepared = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (!prepared.ok) {
      console.warn(`${LOG_PREFIX} Active polar table rejected:`, prepared.reason);
      this.clearPolar({ kind: 'invalid-table' });
      return;
    }
    this._polar.set(prepared.polar);
    this._peakSpeed.set(prepared.peak);
    this._status.set({ kind: 'ready' });
  }

  private applyError(error: unknown): void {
    // A TimeoutError is not an HttpErrorResponse, so a request that never answered lands here too.
    if (!(error instanceof HttpErrorResponse)) {
      console.warn(`${LOG_PREFIX} Active polar fetch failed:`, error);
      this.clearPolar({ kind: 'fetch-failed', cause: 'network' });
      return;
    }
    // HttpClient reports a 2xx body that is not JSON as an error with the success status.
    if (error.status >= 200 && error.status < 300) {
      console.warn(`${LOG_PREFIX} Active polar table rejected:`, 'response is not JSON');
      this.clearPolar({ kind: 'invalid-table' });
      return;
    }
    console.warn(`${LOG_PREFIX} Active polar fetch failed with status ${error.status}`);
    this.clearPolar({
      kind: 'fetch-failed',
      cause: error.status === NO_HTTP_RESPONSE_STATUS ? 'network' : error.status
    });
  }

  private clearPolar(status: ActivePolarStatus): void {
    this._polar.set(null);
    this._peakSpeed.set(null);
    this._status.set(status);
  }

  private cancelRequest(): void {
    this.request?.unsubscribe();
    this.request = null;
    this.requestedUrl = null;
  }
}

type PreparedPolar = { ok: true; polar: Polar; peak: number } | { ok: false; reason: string };

function preparePolar(body: unknown): PreparedPolar {
  const result = toCanonicalPolarTable(body);
  if (!result.ok) return result;
  const polar = new Polar(result.table);
  const peak = polar.peakSpeed();
  if (peak === null || !(peak > 0)) return { ok: false, reason: 'no positive boat speed' };
  return { ok: true, polar, peak };
}

function parsePolarId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const href = (value as { href?: unknown }).href;
  if (typeof href !== 'string') return null;
  const segment = ACTIVE_POLAR_HREF.exec(href)?.[1];
  if (segment === undefined) return null;
  const id = decodeSegment(segment);
  if (id === '.' || id.includes('..') || id.includes('/') || id.includes('\\')) return null;
  return id;
}

/**
 * Decodes each run of escapes on its own, so a stray `%` or a run that is not UTF-8 stays literal
 * without keeping the valid escapes around it encoded.
 */
function decodeSegment(segment: string): string {
  return segment.replace(PERCENT_ESCAPE_RUN, run => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

function toPerformanceFactor(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_PERFORMANCE_FACTOR;
}

/** The identity a table fetch is authorized under; a change means the session changed. */
function sessionKey(status: ILoginStatus | null): string {
  return JSON.stringify([status?.status ?? null, status?.username ?? null, status?.userLevel ?? null]);
}

function statusMessage(status: ActivePolarStatus): string | null {
  switch (status.kind) {
    case 'no-active-polar':
      return MESSAGES.noActivePolar;
    case 'invalid-table':
      return MESSAGES.invalidTable;
    case 'fetch-failed':
      if (status.cause === 'network') return MESSAGES.network;
      if (status.cause === HTTP_UNAUTHORIZED || status.cause === HTTP_FORBIDDEN) return MESSAGES.unauthorized;
      if (status.cause === HTTP_NOT_FOUND) return MESSAGES.notFound;
      return MESSAGES.httpError;
    default:
      return null;
  }
}
