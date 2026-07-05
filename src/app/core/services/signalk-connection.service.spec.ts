import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalKConnectionService } from './signalk-connection.service';
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
      processEndpointResponse: (r: unknown, p?: boolean, s?: boolean) => { operation: number; httpServiceUrl: string | null };
    }).processEndpointResponse(new HttpResponse({ body, status: 200 }), proxyEnabled);

  const wellFormedBody = {
    server: { id: 'signalk-server', version: '2.0.0' },
    endpoints: { v1: { 'signalk-http': 'http://host:3000/signalk/v1/api/', 'signalk-ws': 'ws://host:3000/signalk/v1/stream' } }
  };

  describe('processEndpointResponse', () => {
    it('returns a connected (operation 2) endpoint for a well-formed v1 response', () => {
      const status = parseEndpoint(wellFormedBody);
      expect(status.operation).toBe(2);
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
});
