import { Injectable, signal } from '@angular/core';

/**
 * Timing for the auto-hiding navigation chrome. Values are intentionally
 * generous first-pass defaults; they are tuned on real hardware later.
 */
export const CHROME_BOOT_DWELL_MS = 4000;
export const CHROME_IDLE_HIDE_MS = 4000;
export const CHROME_PEEK_MS = 1300;

/**
 * Owns the ephemeral visibility state of the top navigation toolbar.
 *
 * The toolbar has no permanent chrome: it is shown on load, hides after a
 * dwell, and is thereafter revealed on demand. Two independent bits of state:
 *
 * - `revealed` — the full toolbar is shown. Set by {@link reveal}; auto-hides
 *   after an idle period unless hiding is suppressed.
 * - `peeking` — a transient edge-peek cue that advertises the toolbar's
 *   presence on any input, then retracts on its own.
 *
 * Hiding can be suppressed (ref-counted) while a popup/dialog is open or focus
 * is inside the toolbar, so it never disappears out from under the user.
 * State is never persisted.
 */
@Injectable({ providedIn: 'root' })
export class ChromeVisibilityService {
  private readonly _revealed = signal(true);
  private readonly _peeking = signal(false);

  /** True while the full toolbar is shown. */
  public readonly revealed = this._revealed.asReadonly();
  /** True during the transient edge-peek cue. */
  public readonly peeking = this._peeking.asReadonly();

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private peekTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressCount = 0;

  constructor() {
    // Shown on load so first-time users see the toolbar once, then it hides.
    this.scheduleHide(CHROME_BOOT_DWELL_MS);
  }

  /** Show the toolbar and (re)arm the idle-hide timer. */
  public reveal(): void {
    this._revealed.set(true);
    this.scheduleHide(CHROME_IDLE_HIDE_MS);
  }

  /** Hide the toolbar immediately, unless hiding is currently suppressed. */
  public hide(): void {
    if (this.suppressCount > 0) return;
    this.clearIdle();
    this._revealed.set(false);
  }

  /** Flash the edge-peek cue; it clears itself after {@link CHROME_PEEK_MS}. */
  public pulsePeek(): void {
    this._peeking.set(true);
    if (this.peekTimer) clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => {
      this._peeking.set(false);
      this.peekTimer = null;
    }, CHROME_PEEK_MS);
  }

  /**
   * Prevent auto-hide (e.g. while a dialog is open or focus is in the toolbar).
   * Ref-counted: pair every {@link suppressHide} with an {@link allowHide}.
   */
  public suppressHide(): void {
    this.suppressCount++;
    this.clearIdle();
  }

  /** Release one suppression; re-arms the idle-hide when the last one clears. */
  public allowHide(): void {
    if (this.suppressCount > 0) this.suppressCount--;
    if (this.suppressCount === 0 && this._revealed()) {
      this.scheduleHide(CHROME_IDLE_HIDE_MS);
    }
  }

  private scheduleHide(ms: number): void {
    this.clearIdle();
    if (this.suppressCount > 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this._revealed.set(false);
    }, ms);
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
