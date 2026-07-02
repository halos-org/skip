import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStateMachine } from './connection-state-machine.service';

describe('ConnectionStateMachine', () => {
  let service: ConnectionStateMachine;

  beforeEach(() => {
    service = new ConnectionStateMachine();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should calculate HTTP retry window from retry intervals', () => {
    const retryWindowMs = service.getHttpRetryWindowMs();

    expect(retryWindowMs).toBe(10000);
  });

  it('should add grace period to HTTP retry window', () => {
    const retryWindowMs = service.getHttpRetryWindowMs(2000);

    expect(retryWindowMs).toBe(12000);
  });

  it('escalates WebSocket retry backoff through the configured intervals and then holds', () => {
    vi.useFakeTimers();
    try {
      const retry = vi.fn();
      service.setWebSocketRetryCallback(retry);
      service.enableWebSocketMode();
      service.startHTTPDiscovery();
      service.onHTTPDiscoverySuccess();

      // Delays follow retryIntervals (2s, 3s, 5s) and clamp to the longest once exhausted,
      // proving the backoff escalates rather than repeating a fixed interval.
      const expectedDelays = [2000, 3000, 5000, 5000];

      expectedDelays.forEach((delay, attempt) => {
        service.onWebSocketError('socket dropped');

        vi.advanceTimersByTime(delay - 1);
        expect(retry).toHaveBeenCalledTimes(attempt);

        vi.advanceTimersByTime(1);
        expect(retry).toHaveBeenCalledTimes(attempt + 1);
      });
    } finally {
      service.ngOnDestroy();
      vi.useRealTimers();
    }
  });
});
