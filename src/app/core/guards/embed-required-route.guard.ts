import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { EmbedModeService } from '../services/embed-mode.service';

/**
 * Restricts a route to embed mode, redirecting to the dashboard otherwise. The single-widget host is
 * only ever reached as a plotter-extension widget iframe (always `?embed=1`); requiring embed makes
 * its read-only guarantee structural — under embed the dashboard is force-locked, so a directly
 * crafted non-embed URL cannot reach the widget's edit/options surface. The inverse of
 * `embedBlockedGuard`.
 */
export const embedRequiredGuard: CanActivateFn = (): boolean | UrlTree => {
  const embedMode = inject(EmbedModeService);
  const router = inject(Router);
  return embedMode.embed() ? true : router.parseUrl('/page/0');
};
