import { IConfig } from '../interfaces/app-settings.interfaces';

/**
 * Structural check for a config that arrived from outside the app — an uploaded profile export, or
 * the shared slot an operator publishes by hand. Both reach code that dereferences `app`, `theme`
 * and iterates `dashboards`, so a body missing any of them boots an app that throws on first use.
 */
export function isValidConfigShape(c: unknown): c is IConfig {
  if (!c || typeof c !== 'object') {
    return false;
  }
  const cfg = c as Record<string, unknown>;
  return 'app' in cfg && 'theme' in cfg && Array.isArray(cfg['dashboards']);
}
