import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EndpointStatus, SignalKConnectionService } from './signalk-connection.service';
import { ConnectionStateMachine } from './connection-state-machine.service';

describe('SignalKConnectionService', () => {
  let service: SignalKConnectionService;

  const mockStateMachine = { setHTTPRetryCallback: vi.fn() };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SignalKConnectionService,
        { provide: ConnectionStateMachine, useValue: mockStateMachine },
        { provide: HttpClient, useValue: {} }
      ]
    });
    service = TestBed.inject(SignalKConnectionService);
  });

  // processEndpointResponse is private; exercise it directly to pin the endpoint-parsing
  // contract, including the fail-loud behavior for a malformed discovery response.
  const parseEndpoint = (body: unknown, proxyEnabled = false) =>
    (service as unknown as {
      processEndpointResponse: (r: unknown, p?: boolean, s?: boolean) => { state: EndpointStatus; httpServiceUrl: string | null };
    }).processEndpointResponse(new HttpResponse({ body, status: 200 }), proxyEnabled);

  const wellFormedBody = {
    server: { id: 'signalk-server', version: '2.0.0' },
    endpoints: { v1: { 'signalk-http': 'http://host:3000/signalk/v1/api/', 'signalk-ws': 'ws://host:3000/signalk/v1/stream' } }
  };

  describe('processEndpointResponse', () => {
    it('returns a connected endpoint for a well-formed v1 response', () => {
      const status = parseEndpoint(wellFormedBody);
      expect(status.state).toBe(EndpointStatus.Connected);
      expect(status.httpServiceUrl).toBe('http://host:3000/signalk/v1/api/');
    });

    it('throws when the response has no body', () => {
      expect(() => parseEndpoint(null)).toThrow();
    });

    it('throws when the v1 WebSocket URL is absent (fail-loud, no partial connect)', () => {
      const noWs = {
        server: { id: 'signalk-server', version: '2.0.0' },
        endpoints: { v1: { 'signalk-http': 'http://host:3000/signalk/v1/api/' } }
      };
      expect(() => parseEndpoint(noWs)).toThrow();
    });
  });

  describe('setSubscribeAll', () => {
    it('re-emits the current endpoint with the new scope', () => {
      const seen: (boolean | undefined)[] = [];
      const sub = service.serverServiceEndpoint$.subscribe(e => seen.push(e.subscribeAll));

      service.setSubscribeAll(true);

      expect(seen).toEqual([undefined, true]);
      expect(service.serverServiceEndpoint$.getValue().state).toBe(EndpointStatus.Disconnected);
      sub.unsubscribe();
    });

    it('does not re-emit when the scope already matches', () => {
      service.setSubscribeAll(true);
      const seen: boolean[] = [];
      const sub = service.serverServiceEndpoint$.subscribe(e => seen.push(!!e.subscribeAll));

      service.setSubscribeAll(true);

      expect(seen).toEqual([true]); // the BehaviorSubject's current value only
      sub.unsubscribe();
    });

    // An HTTP retry rebuilds the endpoint from currentSubscribeAll, so a scope set here has to
    // survive it — otherwise a retry silently reverts to the pre-auth scope.
    it('is the scope an HTTP retry rebuilds from', () => {
      service.setSubscribeAll(true);
      expect((service as unknown as { currentSubscribeAll?: boolean }).currentSubscribeAll).toBe(true);
    });
  });
});
