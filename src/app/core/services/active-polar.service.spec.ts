import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Observable } from 'rxjs';
import { ACTIVE_POLAR_REQUEST_TIMEOUT_MS, ActivePolarService } from './active-polar.service';
import { DataService, IPathUpdate } from './data.service';
import { EndpointStatus, IEndpointStatus, SignalKConnectionService } from './signalk-connection.service';
import { ConnectionState, ConnectionStateMachine } from './connection-state-machine.service';
import { AuthenticationService, ILoginStatus } from './authentication.service';
import { Polar } from '../utils/polar-engine.util';
import hurmaPolar from '../utils/polar-engine.hurma-polar.fixture.json';

const ACTIVE_POLAR_PATH = 'self.polars.activePolar';
const PERFORMANCE_FACTOR_PATH = 'self.polars.performanceFactor';
const HURMA_HREF = '/resources/polars/hurma-measured-2024-2026';
const HURMA_URL = 'http://sk.test:3000/signalk/v2/api/resources/polars/hurma-measured-2024-2026';
const OTHER_HREF = '/resources/polars/knots-table';
const OTHER_URL = 'http://sk.test:3000/signalk/v2/api/resources/polars/knots-table';
const REST_URL = 'http://sk.test:3000/signalk/v1/api/vessels/self/polars/activePolar';
const MPS_PER_KNOT = 1852 / 3600;

const CONNECTED_ENDPOINT: IEndpointStatus = {
  state: EndpointStatus.Connected,
  message: 'Connected',
  serverDescription: 'Signal K',
  httpServiceUrl: 'http://sk.test:3000/signalk/v1/api/',
  WsServiceUrl: 'ws://sk.test:3000/signalk/v1/stream'
};

const EMPTY_UPDATE: IPathUpdate = { data: { value: null, timestamp: null }, state: 'normal' };

/** Knots and degrees; the fastest cell is 8 kn. */
const KNOTS_TABLE = {
  kind: 'polarTable',
  units: { tws: 'kn', twa: 'deg', boatSpeed: 'kn' },
  symmetry: { portStarboardSymmetric: true },
  axes: { tws: [6, 12], twa: [45, 90, 150] },
  values: { boatSpeedMatrix: [[5, 6, 5], [6, 8, 7]] }
};

/** The fastest speed in the fixture's SI matrix, read from the table rather than from the engine. */
const HURMA_PEAK = Math.max(...hurmaPolar.values.boatSpeedMatrix.flat());

class FakeDataService {
  public readonly streams = new Map<string, BehaviorSubject<IPathUpdate>>();
  public readonly calls: string[] = [];

  public subscribePath(path: string, source: string): Observable<IPathUpdate> {
    this.calls.push(`${path}|${source}`);
    return this.stream(path);
  }

  public emit(path: string, value: unknown, timestamp: Date | null = new Date()): void {
    this.stream(path).next({ data: { value, timestamp }, state: 'normal' });
  }

  private stream(path: string): BehaviorSubject<IPathUpdate> {
    let subject = this.streams.get(path);
    if (!subject) {
      subject = new BehaviorSubject<IPathUpdate>(EMPTY_UPDATE);
      this.streams.set(path, subject);
    }
    return subject;
  }
}

class FakeConnectionService {
  public readonly serverServiceEndpoint$ = new BehaviorSubject<IEndpointStatus>(CONNECTED_ENDPOINT);
  public readonly serverVersion$ = new BehaviorSubject<string | null>('2.31.0');
  public signalKURL = { url: 'http://sk.test:3000', new: false };
}

class FakeConnectionStateMachine {
  public readonly states = new BehaviorSubject<ConnectionState>(ConnectionState.Connected);
  public get state$(): Observable<ConnectionState> {
    return this.states.asObservable();
  }
}

class FakeAuthenticationService {
  public readonly status = new BehaviorSubject<ILoginStatus | null>({ status: 'notLoggedIn', readOnlyAccess: true });
  public readonly loginStatus$ = this.status.asObservable();
}

describe('ActivePolarService', () => {
  let service: ActivePolarService;
  let http: HttpTestingController;
  let data: FakeDataService;
  let connection: FakeConnectionService;
  let stateMachine: FakeConnectionStateMachine;
  let auth: FakeAuthenticationService;

  beforeEach(() => {
    data = new FakeDataService();
    connection = new FakeConnectionService();
    stateMachine = new FakeConnectionStateMachine();
    auth = new FakeAuthenticationService();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DataService, useValue: data },
        { provide: SignalKConnectionService, useValue: connection },
        { provide: ConnectionStateMachine, useValue: stateMachine },
        { provide: AuthenticationService, useValue: auth }
      ]
    });
    service = TestBed.inject(ActivePolarService);
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Starts the service and takes its one-shot REST read of the active polar. */
  function start(): TestRequest {
    service.ensureStarted();
    return http.expectOne(REST_URL);
  }

  function startWithHref(href: string): TestRequest {
    start();
    data.emit(ACTIVE_POLAR_PATH, { href });
    return http.expectOne(HURMA_URL);
  }

  function reconnect(): void {
    stateMachine.states.next(ConnectionState.WebSocketRetrying);
    stateMachine.states.next(ConnectionState.Connected);
  }

  describe('start', () => {
    it('is idle and subscribes to nothing until started', () => {
      expect(service.status()).toEqual({ kind: 'idle' });
      expect(data.calls).toEqual([]);
    });

    it('stays loading while the active polar path has only its bootstrap null', () => {
      start();
      expect(service.status()).toEqual({ kind: 'loading' });
      expect(service.message()).toBeNull();
      http.expectNone(() => true);
    });

    it('fetches once when the href is already cached at start', () => {
      data.emit(ACTIVE_POLAR_PATH, { href: HURMA_HREF });
      service.ensureStarted();
      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('shares one subscription and one fetch between consumers', () => {
      start();
      service.ensureStarted();
      service.refreshIfFailed();
      data.emit(ACTIVE_POLAR_PATH, { href: HURMA_HREF });
      http.expectOne(HURMA_URL).flush(hurmaPolar);

      expect(data.calls.filter(call => call.startsWith(ACTIVE_POLAR_PATH))).toEqual([`${ACTIVE_POLAR_PATH}|default`]);
      expect(service.status()).toEqual({ kind: 'ready' });
    });
  });

  describe('REST read of the active polar', () => {
    it('reports no active polar when the path answers 404 before any delta', () => {
      start().flush('', { status: 404, statusText: 'Not Found' });
      expect(service.status()).toEqual({ kind: 'no-active-polar' });
      expect(service.message()).toBe('The Signal K server has no active polar.');
    });

    it('fetches the table the REST value points at', () => {
      start().flush({ value: { href: HURMA_HREF }, $source: 'polar-provider', timestamp: '2026-09-23T10:00:00Z' });
      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('reports no active polar for a REST value of null', () => {
      start().flush({ value: null });
      expect(service.status()).toEqual({ kind: 'no-active-polar' });
    });

    it('ignores a REST answer that carries no value, and a later delta still settles it', () => {
      start().flush({});
      expect(service.status()).toEqual({ kind: 'loading' });
      data.emit(ACTIVE_POLAR_PATH, { href: HURMA_HREF });
      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('drops the REST read when a delta arrives first', () => {
      const rest = start();
      data.emit(ACTIVE_POLAR_PATH, { href: HURMA_HREF });
      expect(rest.cancelled).toBe(true);
      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('keeps loading on a REST failure other than 404, and a later delta still settles it', () => {
      start().flush('', { status: 500, statusText: 'Error' });
      expect(service.status()).toEqual({ kind: 'loading' });
      data.emit(ACTIVE_POLAR_PATH, { href: HURMA_HREF });
      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('skips the REST read when the value is already cached at start', () => {
      data.emit(ACTIVE_POLAR_PATH, { href: HURMA_HREF });
      service.ensureStarted();
      http.expectNone(REST_URL);
      http.expectOne(HURMA_URL).flush(hurmaPolar);
    });

    it.each([
      ['a 404', (rest: TestRequest) => rest.flush('', { status: 404, statusText: 'Not Found' })],
      ['a value', (rest: TestRequest) => {
        rest.flush({ value: { href: HURMA_HREF } });
        http.expectOne(HURMA_URL).flush(hurmaPolar);
      }]
    ])('reads over REST only once after %s, not on reconnects, endpoint re-discovery, session changes or dialog opens', (_label, answer) => {
      answer(start());
      reconnect();
      connection.serverServiceEndpoint$.next(CONNECTED_ENDPOINT);
      auth.status.next({ status: 'loggedIn', username: 'skipper', userLevel: 'admin' });
      http.match(HURMA_URL).forEach(request => request.flush(hurmaPolar));
      service.refreshIfFailed();
      http.expectNone(REST_URL);
    });

    it('reads over REST again on a reconnect after a failure other than 404', () => {
      start().flush('', { status: 500, statusText: 'Error' });
      reconnect();
      http.expectOne(REST_URL).flush('', { status: 404, statusText: 'Not Found' });
      expect(service.status()).toEqual({ kind: 'no-active-polar' });
      expect(service.message()).toBe('The Signal K server has no active polar.');
    });

    it('reads over REST again on a session change after a failure other than 404', () => {
      start().flush('', { status: 401, statusText: 'Unauthorized' });
      auth.status.next({ status: 'loggedIn', username: 'skipper', userLevel: 'readonly' });
      http.expectOne(REST_URL).flush({ value: { href: HURMA_HREF } });
      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('reads over REST again on refreshIfFailed after a failure other than 404', () => {
      start().error(new ProgressEvent('error'));
      service.refreshIfFailed();
      http.expectOne(REST_URL).flush('', { status: 404, statusText: 'Not Found' });
      expect(service.status()).toEqual({ kind: 'no-active-polar' });
    });

    it('does not start a second REST read while one is in flight', () => {
      const rest = start();
      reconnect();
      service.refreshIfFailed();
      http.expectNone(REST_URL);
      rest.flush('', { status: 404, statusText: 'Not Found' });
    });

    it('does not read over REST again once a delta has set the active polar', () => {
      start().flush('', { status: 500, statusText: 'Error' });
      data.emit(ACTIVE_POLAR_PATH, { href: HURMA_HREF });
      http.expectOne(HURMA_URL).flush(hurmaPolar);
      reconnect();
      service.refreshIfFailed();
      http.expectNone(REST_URL);
    });

    it('gives up on a REST read that never answers and reads again on a reconnect', () => {
      vi.useFakeTimers();
      const rest = start();
      vi.advanceTimersByTime(ACTIVE_POLAR_REQUEST_TIMEOUT_MS);
      expect(rest.cancelled).toBe(true);
      expect(service.status()).toEqual({ kind: 'loading' });

      reconnect();
      http.expectOne(REST_URL).flush('', { status: 404, statusText: 'Not Found' });
      expect(service.status()).toEqual({ kind: 'no-active-polar' });
    });

    it('waits for a v1 endpoint before reading over REST', () => {
      connection.serverServiceEndpoint$.next({ ...CONNECTED_ENDPOINT, state: EndpointStatus.Connecting, httpServiceUrl: null });
      service.ensureStarted();
      http.expectNone(REST_URL);
      connection.serverServiceEndpoint$.next(CONNECTED_ENDPOINT);
      http.expectOne(REST_URL).flush('', { status: 404, statusText: 'Not Found' });
      expect(service.status()).toEqual({ kind: 'no-active-polar' });
    });
  });

  describe('fetch', () => {
    it('fetches the v2 resource for the href and becomes ready with the table peak speed', () => {
      const request = startWithHref(HURMA_HREF);
      expect(request.request.method).toBe('GET');
      request.flush(hurmaPolar);

      expect(service.status()).toEqual({ kind: 'ready' });
      expect(service.peakSpeed()).toBeCloseTo(HURMA_PEAK, 9);
      expect(service.polar()?.speedAt({ tws: 5, twa: Math.PI / 2 }).value).toBeGreaterThan(0);
      expect(service.message()).toBeNull();
    });

    it('converts a table in knots and degrees and becomes ready', () => {
      start();
      data.emit(ACTIVE_POLAR_PATH, { href: OTHER_HREF });
      http.expectOne(OTHER_URL).flush(KNOTS_TABLE);

      expect(service.status()).toEqual({ kind: 'ready' });
      expect(service.peakSpeed()).toBeCloseTo(8 * MPS_PER_KNOT, 4);
    });

    it('uses only the second table when the href changes while the first fetch is pending', () => {
      const first = startWithHref(HURMA_HREF);
      data.emit(ACTIVE_POLAR_PATH, { href: OTHER_HREF });
      const second = http.expectOne(OTHER_URL);

      expect(first.cancelled).toBe(true);
      expect(service.status()).toEqual({ kind: 'loading' });
      second.flush(KNOTS_TABLE);
      expect(service.peakSpeed()).toBeCloseTo(8 * MPS_PER_KNOT, 4);
    });

    it('does not fetch again when the same href is delivered again', () => {
      startWithHref(HURMA_HREF).flush(hurmaPolar);
      data.emit(ACTIVE_POLAR_PATH, { href: HURMA_HREF });
      http.expectNone(HURMA_URL);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('fetches the new table when the active polar changes after a load', () => {
      startWithHref(HURMA_HREF).flush(hurmaPolar);
      data.emit(ACTIVE_POLAR_PATH, { href: OTHER_HREF });
      expect(service.polar()).toBeNull();
      http.expectOne(OTHER_URL).flush(KNOTS_TABLE);
      expect(service.peakSpeed()).toBeCloseTo(8 * MPS_PER_KNOT, 4);
    });

    it('waits for a server endpoint before fetching', () => {
      connection.serverServiceEndpoint$.next({ ...CONNECTED_ENDPOINT, state: EndpointStatus.Connecting, httpServiceUrl: null });
      connection.signalKURL = { url: '', new: false };
      service.ensureStarted();
      data.emit(ACTIVE_POLAR_PATH, { href: HURMA_HREF });
      http.expectNone(() => true);
      expect(service.status()).toEqual({ kind: 'loading' });

      connection.signalKURL = { url: 'http://sk.test:3000', new: false };
      connection.serverServiceEndpoint$.next(CONNECTED_ENDPOINT);
      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('fetches a dotted id, as some polar providers use', () => {
      start();
      data.emit(ACTIVE_POLAR_PATH, { href: '/resources/polars/j109.v2' });
      http.expectOne(`http://sk.test:3000/signalk/v2/api/resources/polars/${encodeURIComponent('j109.v2')}`).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('does not fetch again when endpoint discovery re-runs against the same server', () => {
      startWithHref(HURMA_HREF).flush(hurmaPolar);
      connection.serverServiceEndpoint$.next({ ...CONNECTED_ENDPOINT, state: EndpointStatus.Connecting, httpServiceUrl: null });
      connection.serverServiceEndpoint$.next(CONNECTED_ENDPOINT);
      http.expectNone(() => true);
      expect(service.status()).toEqual({ kind: 'ready' });
    });
  });

  describe('href validation', () => {
    it('reports no active polar for an explicit null href, without a request', () => {
      start();
      data.emit(ACTIVE_POLAR_PATH, null);
      http.expectNone(() => true);
      expect(service.status()).toEqual({ kind: 'no-active-polar' });
      expect(service.message()).toBe('The Signal K server has no active polar.');
    });

    it('clears a loaded polar when the active polar is unset', () => {
      startWithHref(HURMA_HREF).flush(hurmaPolar);
      data.emit(ACTIVE_POLAR_PATH, null);
      expect(service.status()).toEqual({ kind: 'no-active-polar' });
      expect(service.polar()).toBeNull();
      expect(service.peakSpeed()).toBeNull();
    });

    it.each([
      ['an href under another resource type', { href: '/resources/routes/abc' }],
      ['an absolute URL', { href: 'http://evil.test/resources/polars/abc' }],
      ['a protocol-relative URL', { href: '//evil.test/resources/polars/abc' }],
      ['a dot-dot segment', { href: '/resources/polars/../../skServer/users' }],
      ['an id with a dot-dot', { href: '/resources/polars/..' }],
      ['an id with a dot-dot inside', { href: '/resources/polars/a..b' }],
      ['an id that is a single dot', { href: '/resources/polars/.' }],
      ['an id with an encoded slash', { href: '/resources/polars/a%2Fb' }],
      ['an id with a query string', { href: '/resources/polars/abc?x=1' }],
      ['an id with an encoded dot-dot', { href: '/resources/polars/%2E%2E' }],
      ['an id with a backslash', { href: '/resources/polars/a\\b' }],
      ['an id with an encoded backslash', { href: '/resources/polars/a%5Cb' }],
      ['an id with a fragment', { href: '/resources/polars/abc#x' }],
      ['a trailing slash', { href: '/resources/polars/abc/' }],
      ['an empty id', { href: '/resources/polars/' }],
      ['a bare string instead of an object', HURMA_HREF],
      ['an object without href', { id: 'abc' }]
    ])('rejects %s without a request', (_label, value) => {
      start();
      data.emit(ACTIVE_POLAR_PATH, value);
      http.expectNone(() => true);
      expect(service.status()).toEqual({ kind: 'no-active-polar' });
    });

    it.each([
      ['spaces', '/resources/polars/My Polar', 'My%20Polar'],
      ['a plus sign', '/resources/polars/First 36.7+', 'First%2036.7%2B'],
      ['accented letters', '/resources/polars/Polar été', 'Polar%20%C3%A9t%C3%A9'],
      ['a percent-encoded id', '/resources/polars/Polaire%20%C3%89vasion', 'Polaire%20%C3%89vasion'],
      ['a percent sign that is not an escape', '/resources/polars/100%', '100%25'],
      ['valid escapes next to a stray percent sign', '/resources/polars/My%20Polar%', 'My%20Polar%25']
    ])('fetches an id with %s as one encoded segment', (_label, href, segment) => {
      start();
      data.emit(ACTIVE_POLAR_PATH, { href });
      http.expectOne(`http://sk.test:3000/signalk/v2/api/resources/polars/${segment}`).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('keeps its state when the path is reset to a value-less update', () => {
      startWithHref(HURMA_HREF).flush(hurmaPolar);
      data.emit(ACTIVE_POLAR_PATH, null, null);
      expect(service.status()).toEqual({ kind: 'ready' });
    });
  });

  describe('performance factor', () => {
    it('passes a positive factor through', () => {
      start();
      data.emit(PERFORMANCE_FACTOR_PATH, 0.9);
      expect(service.performanceFactor()).toBe(0.9);
    });

    it.each([
      ['missing', null],
      ['zero', 0],
      ['negative', -0.5],
      ['NaN', NaN],
      ['infinite', Infinity],
      ['not a number', '0.9']
    ])('uses 1 when the factor is %s', (_label, value) => {
      start();
      data.emit(PERFORMANCE_FACTOR_PATH, 0.9);
      data.emit(PERFORMANCE_FACTOR_PATH, value);
      expect(service.performanceFactor()).toBe(1);
    });
  });

  describe('failures', () => {
    it.each([
      [401, 'Sign in to read the active polar.'],
      [403, 'Sign in to read the active polar.'],
      [404, 'The active polar was not found on the Signal K server.'],
      [500, 'The active polar could not be loaded from the Signal K server.']
    ])('maps HTTP %i to fetch-failed with the status and no retry', (status, message) => {
      startWithHref(HURMA_HREF).flush('server says <b>no</b>', { status, statusText: 'Error' });

      expect(service.status()).toEqual({ kind: 'fetch-failed', cause: status });
      expect(service.message()).toBe(message);
      expect(service.polar()).toBeNull();
      http.expectNone(() => true);
    });

    it('maps a network error to fetch-failed with network cause and no retry', () => {
      startWithHref(HURMA_HREF).error(new ProgressEvent('error'));

      expect(service.status()).toEqual({ kind: 'fetch-failed', cause: 'network' });
      expect(service.message()).toBe('The Signal K server did not answer the request for the active polar.');
      http.expectNone(() => true);
    });

    it('maps a table the guard rejects to invalid-table with a fixed message', () => {
      startWithHref(HURMA_HREF).flush({ ...hurmaPolar, axes: { tws: [1, 2], twa: 'lots' } });

      expect(service.status()).toEqual({ kind: 'invalid-table' });
      expect(service.message()).toBe('The active polar table is not in a format Skip can read.');
      expect(service.polar()).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[ActivePolarService]'), expect.stringContaining('/axes/twa'));
    });

    it('maps a table with no positive speed to invalid-table', () => {
      startWithHref(HURMA_HREF).flush({ ...KNOTS_TABLE, values: { boatSpeedMatrix: [[0, 0, 0], [0, 0, 0]] } });
      expect(service.status()).toEqual({ kind: 'invalid-table' });
    });

    it('maps an unparseable body to invalid-table', () => {
      startWithHref(HURMA_HREF).flush('<html>not json</html>', { status: 200, statusText: 'OK' });
      expect(service.status()).toEqual({ kind: 'invalid-table' });
    });

    it('maps an unexpected throw while preparing the table to invalid-table', () => {
      vi.spyOn(Polar.prototype, 'peakSpeed').mockImplementation(() => { throw new RangeError('Maximum call stack size exceeded'); });
      startWithHref(HURMA_HREF).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'invalid-table' });
      expect(service.polar()).toBeNull();
    });

    it('maps a table request that never answers to fetch-failed with network cause', () => {
      vi.useFakeTimers();
      const request = startWithHref(HURMA_HREF);
      vi.advanceTimersByTime(ACTIVE_POLAR_REQUEST_TIMEOUT_MS - 1);
      expect(service.status()).toEqual({ kind: 'loading' });

      vi.advanceTimersByTime(1);
      expect(request.cancelled).toBe(true);
      expect(service.status()).toEqual({ kind: 'fetch-failed', cause: 'network' });
      expect(service.message()).toBe('The Signal K server did not answer the request for the active polar.');
    });
  });

  describe('retry', () => {
    it('fetches again on a session change after a 401 and becomes ready', () => {
      startWithHref(HURMA_HREF).flush('', { status: 401, statusText: 'Unauthorized' });
      auth.status.next({ status: 'loggedIn', username: 'skipper', userLevel: 'readonly' });

      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('fetches again on a server reconnect after a timed-out request', () => {
      vi.useFakeTimers();
      startWithHref(HURMA_HREF);
      vi.advanceTimersByTime(ACTIVE_POLAR_REQUEST_TIMEOUT_MS);
      reconnect();

      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('fetches again on a server reconnect after a network failure', () => {
      startWithHref(HURMA_HREF).error(new ProgressEvent('error'));
      reconnect();

      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('does not fetch again on a reconnect while ready', () => {
      startWithHref(HURMA_HREF).flush(hurmaPolar);
      reconnect();
      http.expectNone(() => true);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('does not fetch again on a reconnect after an invalid table', () => {
      startWithHref(HURMA_HREF).flush({ kind: 'nope' });
      reconnect();
      http.expectNone(() => true);
    });

    it('fetches again on a session change while ready, dropping the old table meanwhile', () => {
      startWithHref(HURMA_HREF).flush(hurmaPolar);
      auth.status.next({ status: 'loggedIn', username: 'skipper', userLevel: 'admin' });

      const request = http.expectOne(HURMA_URL);
      expect(service.status()).toEqual({ kind: 'loading' });
      expect(service.polar()).toBeNull();
      request.flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('does not treat a repeated login status for the same session as a session change', () => {
      startWithHref(HURMA_HREF).flush(hurmaPolar);
      auth.status.next({ status: 'notLoggedIn', readOnlyAccess: true });
      http.expectNone(() => true);
    });

    it('refreshIfFailed fetches again only after a failure', () => {
      startWithHref(HURMA_HREF).flush('', { status: 404, statusText: 'Not Found' });
      service.refreshIfFailed();
      http.expectOne(HURMA_URL).flush(hurmaPolar);

      service.refreshIfFailed();
      http.expectNone(() => true);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('refreshIfFailed fetches again after an invalid table', () => {
      startWithHref(HURMA_HREF).flush({ kind: 'nope' });
      expect(service.status()).toEqual({ kind: 'invalid-table' });
      service.refreshIfFailed();
      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });

    it('refreshIfFailed starts the service', () => {
      service.refreshIfFailed();
      http.expectOne(REST_URL);
      expect(service.status()).toEqual({ kind: 'loading' });
      data.emit(ACTIVE_POLAR_PATH, { href: HURMA_HREF });
      http.expectOne(HURMA_URL).flush(hurmaPolar);
      expect(service.status()).toEqual({ kind: 'ready' });
    });
  });
});
