import { Injectable, signal } from '@angular/core';

/**
 * Boot-latched read of the two ephemeral URL flags that put Skip into the Freeboard panel's
 * chromeless embed mode and (optionally) select a profile for this session only:
 *
 * - `embed` — present in the pre-hash query string (and not `false`/`0`) puts the app in the
 *   read-only, chrome-free embed render mode.
 * - `profile` — the trimmed `?profile=<name>` value, used ephemerally to load a named config slot
 *   without persisting the choice; `null` when absent or empty.
 *
 * Both are read ONCE from `window.location.search` at construction. The app routes with
 * `withHashLocation`, so in-app navigation only ever rewrites the hash fragment and never the
 * pre-hash query — the flags therefore survive every navigation for free, with no reliance on
 * ActivatedRoute/queryParams. The values never change after construction.
 */
@Injectable({ providedIn: 'root' })
export class EmbedModeService {
  private readonly _embed = signal(false);
  private readonly _profile = signal<string | null>(null);

  /** True when the chromeless embed render mode is active. */
  public readonly embed = this._embed.asReadonly();
  /** The URL-selected ephemeral profile name, or `null` when none was requested. */
  public readonly profile = this._profile.asReadonly();

  constructor() {
    const params = new URLSearchParams(window.location.search);

    // Presence-based: any `embed` param turns it on, except the explicit off values.
    const rawEmbed = params.get('embed');
    this._embed.set(params.has('embed') && rawEmbed !== 'false' && rawEmbed !== '0');

    const rawProfile = (params.get('profile') ?? '').trim();
    this._profile.set(rawProfile.length > 0 ? rawProfile : null);
  }
}
