import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { ReloadService } from './reload.service';
import { ToastService } from './toast.service';

// Exposes the private raw-reload seam so a spec can assert the reload branch was taken without the
// hard navigation actually running (it is a no-op under __KIP_TEST__ regardless), plus the target
// computation so its query-preservation can be asserted directly.
interface ReloadServiceInternals {
  performReload(): void;
  reloadTarget(): string;
}

// Drain the microtask queue so the async probe-and-branch chain settles.
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

describe('ReloadService', () => {
  let service: ReloadService;
  let toastShow: ReturnType<typeof vi.fn>;
  let action$: Subject<void>;

  beforeEach(() => {
    action$ = new Subject<void>();
    toastShow = vi.fn().mockReturnValue({ onAction: () => action$ });
    TestBed.configureTestingModule({
      providers: [{ provide: ToastService, useValue: { show: toastShow } }]
    });
    service = TestBed.inject(ReloadService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function spyReload() {
    return vi
      .spyOn(service as unknown as ReloadServiceInternals, 'performReload')
      .mockImplementation(() => undefined);
  }

  it('reloads when the probe resolves with a 2xx response', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue({ status: 200 } as Response);
    const reloadSpy = spyReload();

    await service.reload();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('treats a 4xx response as reachable and reloads (Signal K itself answered)', async () => {
    // Reachability is "Signal K answered", not "the request succeeded": a 401/404 from SK still
    // means the reload will render, so it takes the reload branch. Only 5xx (proxy/backend-down)
    // and network errors are unreachable.
    vi.spyOn(window, 'fetch').mockResolvedValue({ status: 401 } as Response);
    const reloadSpy = spyReload();

    await service.reload();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('treats a 502 (proxy up, Signal K backend down) as UNREACHABLE — no reload, shows Retry toast', async () => {
    // Skip is served through Traefik: with SK stopped the proxy answers 502 (confirmed on the boat).
    // "Any completed response = reachable" would reload straight into the 502 page — the exact
    // dead-end this guards against.
    vi.spyOn(window, 'fetch').mockResolvedValue({ status: 502 } as Response);
    const reloadSpy = spyReload();

    await service.reload();

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledTimes(1);
    expect(toastShow).toHaveBeenCalledWith(expect.any(String), 0, true, 'warn', 'Retry');
  });

  it('does not reload on a network error; shows a persistent warn Retry toast', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const reloadSpy = spyReload();

    await service.reload();

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledTimes(1);
    expect(toastShow).toHaveBeenCalledWith(expect.any(String), 0, true, 'warn', 'Retry');
  });

  it('does not reload when the probe aborts (timeout)', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const reloadSpy = spyReload();

    await service.reload();

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledTimes(1);
  });

  it('reloadTarget preserves the pre-hash query so ?embed/?profile survive a Retry-reload (#216 E6)', () => {
    const original = window.location.search;
    try {
      window.location.search = '?embed=1&profile=day';
      expect((service as unknown as ReloadServiceInternals).reloadTarget()).toBe('./?embed=1&profile=day');
    } finally {
      window.location.search = original;
    }
  });

  it('reloadTarget is the bare app root when there is no query string', () => {
    const original = window.location.search;
    try {
      window.location.search = '';
      expect((service as unknown as ReloadServiceInternals).reloadTarget()).toBe('./');
    } finally {
      window.location.search = original;
    }
  });

  it('re-runs the gated reload when the Retry toast action fires (unbounded, user-driven retry)', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('offline'));
    const reloadSpy = spyReload();

    await service.reload();
    expect(toastShow).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();

    // Server is back; the user taps Retry on the persistent toast — the same gated reload re-runs
    // and now takes the reload branch.
    fetchSpy.mockResolvedValue({ status: 200 } as Response);
    action$.next();
    await flush();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
