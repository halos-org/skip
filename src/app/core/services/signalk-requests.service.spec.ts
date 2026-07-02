import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ISignalKDeltaMessage } from '../interfaces/signalk-interfaces';
import { SignalkRequestsService, skRequest } from './signalk-requests.service';
import { SignalKDeltaService } from './signalk-delta.service';
import { ToastService } from './toast.service';

describe('SignalkRequestsService', () => {
  let service: SignalkRequestsService;
  let requestUpdates$: Subject<ISignalKDeltaMessage>;
  let publishDelta: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestUpdates$ = new Subject<ISignalKDeltaMessage>();
    publishDelta = vi.fn();
    toastShow = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        SignalkRequestsService,
        {
          provide: SignalKDeltaService,
          useValue: {
            subscribeRequestUpdates: () => requestUpdates$.asObservable(),
            publishDelta,
          },
        },
        { provide: ToastService, useValue: { show: toastShow } },
      ],
    });

    service = TestBed.inject(SignalkRequestsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('publishes a PUT delta against vessels.self and returns the generated requestId', () => {
    const requestId = service.putRequest('self.navigation.lights', true, 'widget-1');

    expect(requestId).toBeTruthy();
    expect(publishDelta).toHaveBeenCalledTimes(1);
    // The leading 'self.' is stripped because the SK context already scopes the path.
    expect(publishDelta).toHaveBeenCalledWith({
      context: 'vessels.self',
      requestId,
      put: { path: 'navigation.lights', value: true },
    });
  });

  it('rejects a PUT request with an undefined value without publishing', () => {
    const requestId = service.putRequest('navigation.lights', undefined, 'widget-1');

    expect(requestId).toBeNull();
    expect(publishDelta).not.toHaveBeenCalled();
  });

  it('rejects a PUT request with an empty path without publishing', () => {
    const requestId = service.putRequest('', true, 'widget-1');

    expect(requestId).toBeNull();
    expect(publishDelta).not.toHaveBeenCalled();
  });

  it('routes a response to the matching request by requestId and leaves others pending', () => {
    const received: skRequest[] = [];
    service.subscribeRequest().subscribe(r => received.push(r));

    const first = service.putRequest('navigation.lights', true, 'widget-1')!;
    const second = service.putRequest('navigation.anchorLight', false, 'widget-2')!;

    requestUpdates$.next({ requestId: second, state: 'COMPLETED', statusCode: 200 });

    expect(received).toHaveLength(1);
    expect(received[0].requestId).toBe(second);
    expect(received[0].widgetUUID).toBe('widget-2');

    // The unmatched first request stays pending and correlates on its own response.
    requestUpdates$.next({ requestId: first, state: 'COMPLETED', statusCode: 200 });

    expect(received).toHaveLength(2);
    expect(received[1].requestId).toBe(first);
    expect(received[1].widgetUUID).toBe('widget-1');
  });

  it.each<[number, string]>([
    [200, 'The request was successfully.'],
    [401, 'Login failed. Your User ID or Password is incorrect.'],
    [403, 'DENIED: Authorization with R/W or Admin permission level is required to send commands. Configure Sign In credential.'],
    [405, 'The server does not support the request.'],
  ])('dispatches a %i response with its status description and no error toast', (statusCode, description) => {
    const received: skRequest[] = [];
    service.subscribeRequest().subscribe(r => received.push(r));

    const requestId = service.putRequest('navigation.lights', true, 'widget-1')!;
    requestUpdates$.next({ requestId, state: 'COMPLETED', statusCode });

    expect(received).toHaveLength(1);
    expect(received[0].statusCode).toBe(statusCode);
    expect(received[0].statusCodeDescription).toBe(description);
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('surfaces a 400 response as an error toast and dispatches it', () => {
    const received: skRequest[] = [];
    service.subscribeRequest().subscribe(r => received.push(r));

    const requestId = service.putRequest('navigation.lights', true, 'widget-1')!;
    requestUpdates$.next({ requestId, state: 'COMPLETED', statusCode: 400, message: 'invalid path' });

    expect(toastShow).toHaveBeenCalledWith('invalid path', 0, false, 'error');
    expect(received).toHaveLength(1);
    expect(received[0].statusCode).toBe(400);
  });

  it('keeps a 202 accepted request pending until a final response arrives', () => {
    const received: skRequest[] = [];
    service.subscribeRequest().subscribe(r => received.push(r));

    const requestId = service.putRequest('navigation.lights', true, 'widget-1')!;

    // 202 is an interim acknowledgement: it must not dispatch nor drop the pending request.
    requestUpdates$.next({ requestId, state: 'PENDING', statusCode: 202 });
    expect(received).toHaveLength(0);

    requestUpdates$.next({ requestId, state: 'COMPLETED', statusCode: 200 });
    expect(received).toHaveLength(1);
    expect(received[0].statusCode).toBe(200);
  });

  it('warns via toast when a response carries an unknown requestId', () => {
    const received: skRequest[] = [];
    service.subscribeRequest().subscribe(r => received.push(r));

    requestUpdates$.next({ requestId: 'never-issued', state: 'COMPLETED', statusCode: 200 });

    expect(received).toHaveLength(0);
    expect(toastShow).toHaveBeenCalledTimes(1);
    expect(toastShow).toHaveBeenCalledWith(expect.stringContaining('unknown Request ID'), 0, false, 'warn');
  });
});
