import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { SignalKDeltaService } from './signalk-delta.service';
import { AuthenticationService } from './authentication.service';
import { SignalKConnectionService } from './signalk-connection.service';
import { ConnectionStateMachine } from './connection-state-machine.service';
import { ISignalKDeltaMessage, ISignalKUpdateMessage, ISignalKDataValueUpdate, ISignalKMeta, ISkMetadata } from '../interfaces/signalk-interfaces';
import { IPathValueData, IMeta } from '../interfaces/app-interfaces';

class AuthStub {
  isLoggedIn$ = new BehaviorSubject<boolean>(false);
  refreshLoginStatus = vi.fn(async () => null);
}

class ConnStub {
  serverServiceEndpoint$ = new BehaviorSubject<{ operation: number; WsServiceUrl?: string; subscribeAll?: boolean }>({ operation: 0 });
  setServerInfo(): void { /* noop */ }
}

class CsmStub {
  state$ = new BehaviorSubject<string>('Disconnected');
  setWebSocketRetryCallback = vi.fn();
  isFullyConnected = vi.fn(() => false);
  isHTTPConnected = vi.fn(() => true);
  startWebSocketConnection = vi.fn();
  onWebSocketConnected = vi.fn();
  onWebSocketError = vi.fn();
  currentState = 'HTTPConnected';
}

interface DeltaInternals {
  buildWebSocketUrl(): string;
  processWebsocketMessage(message: ISignalKDeltaMessage): void;
  handleStreamFrame(frame: unknown): void;
}

function setup() {
  const auth = new AuthStub();
  const conn = new ConnStub();
  const csm = new CsmStub();
  TestBed.configureTestingModule({
    providers: [
      SignalKDeltaService,
      { provide: AuthenticationService, useValue: auth },
      { provide: SignalKConnectionService, useValue: conn },
      { provide: ConnectionStateMachine, useValue: csm },
    ]
  });
  const service = TestBed.inject(SignalKDeltaService);
  return { service, auth, conn, csm };
}

describe('SignalKDeltaService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('should be created', () => {
    expect(setup().service).toBeTruthy();
  });

  describe('WebSocket URL', () => {
    it('never appends an auth token (the same-origin session cookie authenticates the upgrade)', () => {
      const { service, conn } = setup();
      conn.serverServiceEndpoint$.next({ operation: 2, WsServiceUrl: 'wss://host/signalk/v1/stream', subscribeAll: false });

      const url = (service as unknown as DeltaInternals).buildWebSocketUrl();
      expect(url).not.toContain('token=');
      expect(url.startsWith('wss://host/signalk/v1/stream')).toBe(true);
    });
  });

  describe('session-driven (re)connect', () => {
    it('a login transition triggers a WS (re)connect via the isFullyConnected guard', () => {
      const { auth, csm } = setup();
      csm.startWebSocketConnection.mockClear();

      auth.isLoggedIn$.next(true);

      expect(csm.startWebSocketConnection).toHaveBeenCalled();
    });

    it('does not start a WS connect when already fully connected (no double-connect)', () => {
      const { auth, csm } = setup();
      csm.isFullyConnected.mockReturnValue(true);
      csm.startWebSocketConnection.mockClear();

      auth.isLoggedIn$.next(true);

      expect(csm.startWebSocketConnection).not.toHaveBeenCalled();
    });

    it('does not start a second WS connect while one is already in flight (WebSocketConnecting)', () => {
      const { auth, csm } = setup();
      // Bootstrap already opened the socket: not yet Connected, but a connect is in flight.
      csm.isFullyConnected.mockReturnValue(false);
      csm.currentState = 'WebSocketConnecting';
      csm.startWebSocketConnection.mockClear();

      auth.isLoggedIn$.next(true);

      expect(csm.startWebSocketConnection).not.toHaveBeenCalled();
    });
  });

  describe('loginStatus re-probe on WS open', () => {
    it('re-probes loginStatus when the WebSocket opens so a reconnected session self-heals', () => {
      const { service, auth } = setup();
      auth.refreshLoginStatus.mockClear();

      service.socketWSOpenEvent$.next({} as Event);

      expect(auth.refreshLoginStatus).toHaveBeenCalled();
    });
  });

  describe('loginStatus re-check on WS drop', () => {
    it('re-checks loginStatus on a non-clean close', () => {
      const { service, auth } = setup();
      auth.refreshLoginStatus.mockClear();

      service.socketWSCloseEvent$.next({ wasClean: false } as CloseEvent);

      expect(auth.refreshLoginStatus).toHaveBeenCalled();
    });

    it('does not re-check loginStatus on a clean close', () => {
      const { service, auth } = setup();
      auth.refreshLoginStatus.mockClear();

      service.socketWSCloseEvent$.next({ wasClean: true } as CloseEvent);

      expect(auth.refreshLoginStatus).not.toHaveBeenCalled();
    });
  });

  describe('delta parsing & flattening (characterization)', () => {
    const TS = '2024-01-01T00:00:00Z';
    const CTX = 'vessels.self';

    function parse(service: SignalKDeltaService, message: ISignalKDeltaMessage): void {
      (service as unknown as DeltaInternals).processWebsocketMessage(message);
    }

    function collectData(service: SignalKDeltaService): IPathValueData[] {
      const out: IPathValueData[] = [];
      service.subscribeDataPathsUpdates().subscribe(v => out.push(v));
      return out;
    }

    function update(values: ISignalKDataValueUpdate[], extra: Partial<ISignalKUpdateMessage> = {}): ISignalKUpdateMessage {
      return { $source: 'src.1', timestamp: TS, values, ...extra };
    }

    function skMeta(path: string, value: object): ISignalKMeta {
      return { path, value: value as ISkMetadata };
    }

    it('emits a scalar value once, propagating context, source and timestamp', () => {
      const { service } = setup();
      const out = collectData(service);
      parse(service, { context: CTX, updates: [update([{ path: 'navigation.speedOverGround', value: 3.2 }])] });
      expect(out).toEqual([
        { context: CTX, path: 'navigation.speedOverGround', source: 'src.1', timestamp: TS, value: 3.2 },
      ]);
    });

    it('passes a null value through untouched (typeof null === object is guarded)', () => {
      const { service } = setup();
      const out = collectData(service);
      parse(service, { context: CTX, updates: [update([{ path: 'navigation.speedOverGround', value: null }])] });
      expect(out).toEqual([
        { context: CTX, path: 'navigation.speedOverGround', source: 'src.1', timestamp: TS, value: null },
      ]);
    });

    it('recursively flattens a nested object into synthetic dotted child paths', () => {
      // Pins current behaviour (finding SK-02 / #21): KIP fabricates child paths absent from the SK spec.
      const { service } = setup();
      const out = collectData(service);
      parse(service, { context: CTX, updates: [update([{ path: 'navigation.position', value: { latitude: 48.1, longitude: -4.5 } }], { $source: 'gps.1' })] });
      expect(out.map(v => [v.path, v.value])).toEqual([
        ['navigation.position.latitude', 48.1],
        ['navigation.position.longitude', -4.5],
      ]);
      expect(out.every(v => v.source === 'gps.1' && v.timestamp === TS)).toBe(true);
    });

    it('leaves paths in DO_NOT_FLATTEN_PATHS (displays.*) as a single whole-object value', () => {
      const { service } = setup();
      const out = collectData(service);
      const value = { layout: { rows: 2 }, name: 'main' };
      parse(service, { context: CTX, updates: [update([{ path: 'displays.chart.config', value }])] });
      expect(out).toEqual([
        { context: CTX, path: 'displays.chart.config', source: 'src.1', timestamp: TS, value },
      ]);
    });

    it('falls back to a single-level split when nesting exceeds the depth limit', () => {
      // Deeper than maxDepth (3): canFlattenCompletely fails, so only the top level is split and the nested value is kept whole.
      const { service } = setup();
      const out = collectData(service);
      parse(service, { context: CTX, updates: [update([{ path: 'foo.bar', value: { a: { b: { c: { d: 1 } } } } }])] });
      expect(out).toEqual([
        { context: CTX, path: 'foo.bar.a', source: 'src.1', timestamp: TS, value: { b: { c: { d: 1 } } } },
      ]);
    });

    it('falls back to a single-level split when an object exceeds the size limit', () => {
      // More than maxObjectSize (20) keys: canFlattenCompletely fails, so the object is split one level deep.
      const { service } = setup();
      const out = collectData(service);
      const wide: Record<string, number> = {};
      for (let i = 0; i < 21; i++) { wide[`k${i}`] = i; }
      parse(service, { context: CTX, updates: [update([{ path: 'wide.obj', value: wide }])] });
      expect(out).toHaveLength(21);
      expect(out[0]).toEqual({ context: CTX, path: 'wide.obj.k0', source: 'src.1', timestamp: TS, value: 0 });
    });

    it('routes notifications.* items to the notifications stream, not the data stream', () => {
      const { service } = setup();
      const data = collectData(service);
      const notes: ISignalKDataValueUpdate[] = [];
      service.subscribeNotificationsUpdates().subscribe(v => notes.push(v));
      const item = { path: 'notifications.mob', value: { state: 'alarm', message: 'MOB' } };
      parse(service, { context: CTX, updates: [update([item])] });
      expect(notes).toEqual([item]);
      expect(data).toEqual([]);
    });

    it('propagates a foreign (non-self) context unchanged (the self-filter is disabled)', () => {
      // Pins finding SK-06: foreign-vessel data is not filtered out of the self stream.
      const { service } = setup();
      const out = collectData(service);
      const foreign = 'vessels.urn:mrn:imo:mmsi:123456789';
      parse(service, { context: foreign, updates: [update([{ path: 'navigation.speedOverGround', value: 5 }])] });
      expect(out[0].context).toBe(foreign);
    });

    it('expands metadata carrying a properties map into per-property emissions', () => {
      const { service } = setup();
      const out: IMeta[] = [];
      service.subscribeMetadataUpdates().subscribe(v => out.push(v));
      const latMeta = { units: 'rad', description: 'Latitude' };
      const lonMeta = { units: 'rad', description: 'Longitude' };
      const meta = [skMeta('navigation.position', { description: 'Position', properties: { latitude: latMeta, longitude: lonMeta } })];
      parse(service, { context: CTX, updates: [update([], { meta })] });
      expect(out).toEqual([
        { context: CTX, path: 'navigation.position.latitude', meta: latMeta },
        { context: CTX, path: 'navigation.position.longitude', meta: lonMeta },
      ]);
    });

    it('emits metadata without a properties map as a single path meta', () => {
      const { service } = setup();
      const out: IMeta[] = [];
      service.subscribeMetadataUpdates().subscribe(v => out.push(v));
      const sogMeta = { units: 'm/s', description: 'Speed over ground' };
      const meta = [skMeta('navigation.speedOverGround', sogMeta)];
      parse(service, { context: CTX, updates: [update([], { meta })] });
      expect(out).toEqual([
        { context: CTX, path: 'navigation.speedOverGround', meta: sogMeta },
      ]);
    });

    it('routes a requestId message to the requests stream', () => {
      const { service } = setup();
      const data = collectData(service);
      const reqs: ISignalKDeltaMessage[] = [];
      service.subscribeRequestUpdates().subscribe(v => reqs.push(v));
      const msg: ISignalKDeltaMessage = { requestId: 'req-1', state: 'COMPLETED', statusCode: 200 };
      parse(service, msg);
      expect(reqs).toEqual([msg]);
      expect(data).toEqual([]);
    });

    it('routes a hello/self message to the self stream and forwards server info', () => {
      const { service, conn } = setup();
      const setServerInfo = vi.spyOn(conn, 'setServerInfo');
      const selves: string[] = [];
      service.subscribeSelfUpdates().subscribe(v => selves.push(v));
      parse(service, { self: 'vessels.urn:mrn:signalk:uuid:self', name: 'sk', version: '2.0.0', roles: ['main', 'master'] });
      expect(selves).toEqual(['vessels.urn:mrn:signalk:uuid:self']);
      expect(setServerInfo).toHaveBeenCalledWith('sk', '2.0.0', ['main', 'master']);
    });

    it('drops an empty object value entirely — no emissions (latent data loss)', () => {
      // canFlattenCompletely({}) is true, flattenObjectValue({}) returns [], so nothing is emitted.
      const { service } = setup();
      const out = collectData(service);
      parse(service, { context: CTX, updates: [update([{ path: 'some.path', value: {} }])] });
      expect(out).toEqual([]);
    });

    it('flattens an array value into indexed child paths', () => {
      const { service } = setup();
      const out = collectData(service);
      parse(service, { context: CTX, updates: [update([{ path: 'foo.list', value: [10, 20] }])] });
      expect(out.map(v => [v.path, v.value])).toEqual([
        ['foo.list.0', 10],
        ['foo.list.1', 20],
      ]);
    });

    it('fully flattens nesting whose values sit at depth 2 (inside the depth limit)', () => {
      const { service } = setup();
      const out = collectData(service);
      parse(service, { context: CTX, updates: [update([{ path: 'x', value: { a: { b: 1 } } }])] });
      expect(out.map(v => [v.path, v.value])).toEqual([['x.a.b', 1]]);
    });

    it('falls back to single-level split once a value sits at depth 3 (the exact cutoff)', () => {
      // The depth guard fires at currentDepth >= maxDepth (3) before the scalar check, so a value at depth 3 fails.
      const { service } = setup();
      const out = collectData(service);
      parse(service, { context: CTX, updates: [update([{ path: 'x', value: { a: { b: { c: 1 } } } }])] });
      expect(out).toEqual([
        { context: CTX, path: 'x.a', source: 'src.1', timestamp: TS, value: { b: { c: 1 } } },
      ]);
    });

    it('skips flattening for any path CONTAINING "displays." (substring, not prefix)', () => {
      // DO_NOT_FLATTEN_PATHS is matched with .includes(), so the guard triggers mid-path too.
      const { service } = setup();
      const out = collectData(service);
      const value = { a: 1, b: 2 };
      parse(service, { context: CTX, updates: [update([{ path: 'foo.displays.bar', value }])] });
      expect(out).toEqual([
        { context: CTX, path: 'foo.displays.bar', source: 'src.1', timestamp: TS, value },
      ]);
    });

    it('processes updates and ignores requestId when a message carries both (updates win)', () => {
      const { service } = setup();
      const out = collectData(service);
      const reqs: ISignalKDeltaMessage[] = [];
      service.subscribeRequestUpdates().subscribe(v => reqs.push(v));
      parse(service, { requestId: 'req-1', updates: [update([{ path: 'navigation.speedOverGround', value: 1 }])] });
      expect(out).toHaveLength(1);
      expect(reqs).toEqual([]);
    });

    it('treats an errorMessage as a no-op (no emissions on any stream)', () => {
      const { service } = setup();
      const out = collectData(service);
      const reqs: ISignalKDeltaMessage[] = [];
      service.subscribeRequestUpdates().subscribe(v => reqs.push(v));
      parse(service, { errorMessage: 'stream error' });
      expect(out).toEqual([]);
      expect(reqs).toEqual([]);
    });

    it('associates each update\'s own $source and timestamp with its values', () => {
      const { service } = setup();
      const out = collectData(service);
      parse(service, { context: CTX, updates: [
        { $source: 'gps.1', timestamp: '2024-01-01T00:00:00Z', values: [{ path: 'navigation.speedOverGround', value: 1 }] },
        { $source: 'wind.2', timestamp: '2024-01-02T00:00:00Z', values: [{ path: 'environment.wind.speedApparent', value: 2 }] },
      ] });
      expect(out).toEqual([
        { context: CTX, path: 'navigation.speedOverGround', source: 'gps.1', timestamp: '2024-01-01T00:00:00Z', value: 1 },
        { context: CTX, path: 'environment.wind.speedApparent', source: 'wind.2', timestamp: '2024-01-02T00:00:00Z', value: 2 },
      ]);
    });

    describe('malformed frames', () => {
      function handleFrame(service: SignalKDeltaService, frame: unknown): void {
        (service as unknown as DeltaInternals).handleStreamFrame(frame);
      }

      function collectAll(service: SignalKDeltaService) {
        const data = collectData(service);
        const metas: IMeta[] = [];
        const reqs: ISignalKDeltaMessage[] = [];
        const notes: ISignalKDataValueUpdate[] = [];
        const selves: string[] = [];
        service.subscribeMetadataUpdates().subscribe(v => metas.push(v));
        service.subscribeRequestUpdates().subscribe(v => reqs.push(v));
        service.subscribeNotificationsUpdates().subscribe(v => notes.push(v));
        service.subscribeSelfUpdates().subscribe(v => selves.push(v));
        return { data, metas, reqs, notes, selves };
      }

      it('drops and logs a junk frame without discriminator fields at the boundary', () => {
        const { service } = setup();
        const streams = collectAll(service);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(() => handleFrame(service, { foo: 'bar', baz: 42 })).not.toThrow();
        expect(warn).toHaveBeenCalled();
        expect(streams).toEqual({ data: [], metas: [], reqs: [], notes: [], selves: [] });
        warn.mockRestore();
      });

      it('drops non-object frames (string, number, null, array) without throwing', () => {
        const { service } = setup();
        const streams = collectAll(service);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        for (const frame of ['junk', 42, null, undefined, [1, 2]]) {
          expect(() => handleFrame(service, frame)).not.toThrow();
        }
        expect(streams).toEqual({ data: [], metas: [], reqs: [], notes: [], selves: [] });
        warn.mockRestore();
      });

      it('passes a valid update frame through the boundary guard unchanged', () => {
        const { service } = setup();
        const out = collectData(service);
        handleFrame(service, { context: CTX, updates: [update([{ path: 'navigation.speedOverGround', value: 3.2 }])] });
        expect(out).toEqual([
          { context: CTX, path: 'navigation.speedOverGround', source: 'src.1', timestamp: TS, value: 3.2 },
        ]);
      });

      it('passes a valid hello/self frame through the boundary guard unchanged', () => {
        const { service } = setup();
        const selves: string[] = [];
        service.subscribeSelfUpdates().subscribe(v => selves.push(v));
        handleFrame(service, { self: 'vessels.urn:mrn:signalk:uuid:self', name: 'sk', version: '2.0.0' });
        expect(selves).toEqual(['vessels.urn:mrn:signalk:uuid:self']);
      });

      it('passes a valid request-response frame through the boundary guard unchanged', () => {
        const { service } = setup();
        const reqs: ISignalKDeltaMessage[] = [];
        service.subscribeRequestUpdates().subscribe(v => reqs.push(v));
        const msg: ISignalKDeltaMessage = { requestId: 'req-1', state: 'COMPLETED', statusCode: 200 };
        handleFrame(service, msg);
        expect(reqs).toEqual([msg]);
      });

      it('accepts an errorMessage frame at the boundary instead of dropping it', () => {
        const { service } = setup();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        handleFrame(service, { errorMessage: 'stream error' });
        expect(warn).toHaveBeenCalledWith('[Delta Service] Service received stream error message: stream error');
        expect(warn).not.toHaveBeenCalledWith('[Delta Service] Dropping malformed stream frame:', expect.anything());
        warn.mockRestore();
      });

      it('drops a value item with a null path and keeps processing the rest of the update', () => {
        const { service } = setup();
        const out = collectData(service);
        const badItem = { path: null, value: 1 } as unknown as ISignalKDataValueUpdate;
        expect(() => parse(service, { context: CTX, updates: [update([badItem, { path: 'navigation.speedOverGround', value: 2 }])] })).not.toThrow();
        expect(out).toEqual([
          { context: CTX, path: 'navigation.speedOverGround', source: 'src.1', timestamp: TS, value: 2 },
        ]);
      });

      it('drops a value item with a missing path without throwing', () => {
        const { service } = setup();
        const out = collectData(service);
        const badItem = { value: 1 } as unknown as ISignalKDataValueUpdate;
        expect(() => parse(service, { context: CTX, updates: [update([badItem])] })).not.toThrow();
        expect(out).toEqual([]);
      });

      it('ignores a null update entry and non-array values without throwing', () => {
        const { service } = setup();
        const out = collectData(service);
        const badUpdates = [
          null as unknown as ISignalKUpdateMessage,
          { $source: 'src.1', timestamp: TS, values: 'junk' as unknown as ISignalKDataValueUpdate[] },
        ];
        expect(() => parse(service, { context: CTX, updates: badUpdates })).not.toThrow();
        expect(out).toEqual([]);
      });

      it('drops a meta item whose value is missing without throwing', () => {
        const { service } = setup();
        const metas: IMeta[] = [];
        service.subscribeMetadataUpdates().subscribe(v => metas.push(v));
        const meta = [{ path: 'navigation.position' } as unknown as ISignalKMeta];
        expect(() => parse(service, { context: CTX, updates: [update([], { meta })] })).not.toThrow();
        expect(metas).toEqual([]);
      });

      it('falls back to a single meta emission when properties is null', () => {
        const { service } = setup();
        const metas: IMeta[] = [];
        service.subscribeMetadataUpdates().subscribe(v => metas.push(v));
        const value = { units: 'm/s', description: 'Speed over ground', properties: null };
        parse(service, { context: CTX, updates: [update([], { meta: [skMeta('navigation.speedOverGround', value)] })] });
        expect(metas).toEqual([
          { context: CTX, path: 'navigation.speedOverGround', meta: value },
        ]);
      });
    });
  });
});
