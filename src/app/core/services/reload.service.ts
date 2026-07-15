import { Injectable, Injector, inject } from '@angular/core';
import { ToastService } from './toast.service';

/**
 * Reachability-gated app reload.
 *
 * Recovery flows (the bootstrap "Retry", a connection/profile change, a config reset) recover by
 * reloading the app — SettingsService.reloadApp() -> location.replace('./'). When the problem being
 * recovered from is that the Signal K server serving index.html is unreachable, that navigation
 * replaces the working (degraded) shell with the browser's "site can't be reached" page — strictly
 * worse than staying put. This service probes the server first: it reloads only when the server
 * answers, and otherwise keeps the shell alive and offers an unbounded, user-driven Retry.
 */
@Injectable({ providedIn: 'root' })
export class ReloadService {
  // ToastService injects SettingsService, which injects this service. Resolving the toast lazily —
  // only when a reload is actually declined — keeps that back-edge out of the construction graph so
  // the DI cycle never forms.
  private readonly injector = inject(Injector);

  // Same-origin app root, mirroring the target of reloadApp()'s location.replace('./').
  private readonly probeUrl = './';
  // Short enough that Retry never feels hung, long enough to tolerate a slow-but-alive server.
  private readonly probeTimeoutMs = 4000;

  /**
   * Reload the app only if the server is reachable; otherwise keep the shell and show a persistent
   * Retry toast that re-runs this same gated reload (so recovery never leaves the app).
   */
  public async reload(): Promise<void> {
    if (await this.isServerReachable()) {
      this.performReload();
    } else {
      this.showUnreachableToast();
    }
  }

  private async isServerReachable(): Promise<boolean> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.probeTimeoutMs);

    try {
      // cache: 'no-store' biases to a real network round-trip, mirroring the navigation reloadApp()
      // performs, so a stale cached copy can't report a down server as reachable.
      const response = await fetch(this.probeUrl, { method: 'GET', cache: 'no-store', signal: abortController.signal });
      // Skip is served through a reverse proxy (Traefik). When the Signal K backend is down but the
      // proxy is up, the proxy answers 502/503/504 — so "any completed response" would wrongly call
      // the server reachable and reload straight into the proxy's error page (the exact dead-end this
      // guards against; confirmed on the boat: SK stopped -> 502 through Traefik). Treat 5xx as
      // unreachable; a 2xx/3xx/4xx means Signal K itself answered, so the reload will render. A
      // network error, timeout, or DNS failure (the catch) is also unreachable.
      return response.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private performReload(): void {
    // Prevent hard navigation under the unit-test runner (it tears down the test page).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).__KIP_TEST__) {
      return;
    }
    location.replace('./');
  }

  private showUnreachableToast(): void {
    const ref = this.injector.get(ToastService).show(
      'Signal K server is still unreachable. Retry when the connection is restored.',
      0,
      true,
      'warn',
      'Retry'
    );
    ref.onAction().subscribe(() => { void this.reload(); });
  }
}
