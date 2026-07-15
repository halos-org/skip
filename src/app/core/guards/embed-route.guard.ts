import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { EmbedModeService } from '../services/embed-mode.service';

/**
 * Blocks the editor/settings routes while in embed mode, redirecting to the dashboard. Embed mode is
 * strictly read-only, so its route surface must not reach any configuration screen. Defense in depth
 * behind the read-only gates (a locked dashboard, unmounted toolbar), and it also closes the
 * setActiveProfile-persistence hazard those screens expose.
 */
export const embedBlockedGuard: CanActivateFn = (): boolean | UrlTree => {
  const embedMode = inject(EmbedModeService);
  const router = inject(Router);
  return embedMode.embed() ? router.parseUrl('/page/0') : true;
};
