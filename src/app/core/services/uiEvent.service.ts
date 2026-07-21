import { Injectable, OnDestroy, signal } from '@angular/core';
import screenfull from 'screenfull';
import NoSleep from '@zakj/no-sleep';
import { isEmbeddedInIframe } from '../utils/iframe.util';

@Injectable({
  providedIn: 'root'
})
export class uiEventService implements OnDestroy {
  public isDragging = signal<boolean>(false);
  public fullscreenStatus = signal<boolean>(false);
  public fullscreenSupported = signal<boolean>(true);
  public noSleepStatus = signal<boolean>(false);
  public noSleepSupported = signal<boolean>(true);
  private noSleep: { enable: () => void; disable: () => void } | null = null;
  private hotkeyListeners = new Map<(key: string, event: KeyboardEvent) => void, EventListener>();
  private readonly fullscreenChangeHandler = () => {
    this.fullscreenStatus.set(screenfull.isFullscreen);
  };

  constructor() {
    // Skip side-effectful logic during unit tests to avoid reloads / timers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isTest = (window as any).__SKIP_TEST__;
    if (!isTest) {
      if (isEmbeddedInIframe()) {
        // Running inside a host iframe (app-dock, Freeboard, ...). The host owns fullscreen,
        // so hide Skip's control and defer to it (#1062).
        this.fullscreenSupported.set(false);
        console.log('[UI Event Service] Running inside an iframe; fullscreen control hidden, deferring to host.');
      } else if (screenfull.isEnabled) {
        screenfull.on('change', this.fullscreenChangeHandler);
      } else {
        this.fullscreenSupported.set(false);
        console.log('[UI Event Service] Fullscreen mode is not supported by device/browser.');
      }

      this.checkNoSleepSupport();
      // The screen wake lock is driven by the keepScreenAwake setting (applied from app.component),
      // never by install/PWA/standalone detection — so it holds in a plain browser tab too (#359).
    } else {
      // In tests mark features unsupported to short-circuit code paths gracefully
      this.fullscreenSupported.set(false);
      this.noSleepSupported.set(false);
    }
  }

  private checkNoSleepSupport(): void {
    try {
      if (!this.noSleep) {
        this.noSleep = new NoSleep();
      }
      if (!this.noSleep || typeof this.noSleep.enable !== 'function' || typeof this.noSleep.disable !== 'function') {
        throw new Error('[UI Event Service] NoSleep methods not available');
      }
    } catch (error) {
      this.noSleepSupported.set(false);
      console.warn(`[UI Event Service] NoSleep is not supported by this device/browser. Error: ${error}`);
      this.noSleep = null;
    }
  }

  /** Enable or disable the screen wake lock. Driven by the keepScreenAwake setting; no-ops when unsupported. */
  public setKeepAwake(enabled: boolean): void {
    if (!this.noSleepSupported() || enabled === this.noSleepStatus()) {
      return;
    }
    try {
      if (enabled) {
        if (!this.noSleep) this.checkNoSleepSupport();
        this.noSleep?.enable();
      } else {
        this.noSleep?.disable();
      }
      this.noSleepStatus.set(enabled);
      console.log('[UI Event Service] Screen wake lock active:', enabled);
    } catch (e) {
      console.warn('[UI Event Service] Failed to toggle screen wake lock:', e);
    }
  }

  public toggleFullScreen(): void {
    if (isEmbeddedInIframe()) {
      // The host iframe (e.g. app-dock) manages fullscreen; do nothing so we don't hijack it (#1062).
      return;
    }
    if (screenfull.isEnabled) {
      if (!this.fullscreenStatus()) {
        screenfull.request();
      } else if (screenfull.isFullscreen) {
        screenfull.exit();
      }
      this.fullscreenStatus.set(!this.fullscreenStatus());
    } else {
      this.fullscreenSupported.set(false);
      console.log('[UI Event Service] Fullscreen mode is not supported by this browser.');
    }
  }

  public addHotkeyListener(
    callback: (key: string, event: KeyboardEvent) => void,
    options?: { keys?: string[]; ctrlKey?: boolean; shiftKey?: boolean }
  ): void {
    const wrappedCallback: EventListener = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        const normalizedKey = event.key.toLowerCase(); // Normalize key to lowercase
        // Apply optional filters
        if (options) {
          if (options.keys && !options.keys.includes(normalizedKey)) {
            return; // Skip if the key is not in the allowed list
          }
          if (options.ctrlKey !== undefined && event.ctrlKey !== options.ctrlKey) {
            return; // Skip if ctrlKey does not match
          }
          if (options.shiftKey !== undefined && event.shiftKey !== options.shiftKey) {
            return; // Skip if shiftKey does not match
          }
        }

        callback(normalizedKey, event); // Pass normalized key and event to the callback
      } else {
        console.warn("[uiEvent Service] Non-keyboard event detected in addHotkeyListener:", event);
      }
    };

    this.hotkeyListeners.set(callback, wrappedCallback);
    document.addEventListener('keydown', wrappedCallback);
  }

  public removeHotkeyListener(callback: (key: string, event: KeyboardEvent) => void): void {
    const wrappedCallback = this.hotkeyListeners.get(callback);
    if (wrappedCallback) {
      document.removeEventListener('keydown', wrappedCallback);
      this.hotkeyListeners.delete(callback);
    }
  }

  ngOnDestroy(): void {
    // Cleanup screenfull listener (mainly for tests / HMR safety)
    if (screenfull.isEnabled) {
      try { screenfull.off('change', this.fullscreenChangeHandler); } catch { /* ignore */ }
    }
    // Disable NoSleep to release resources
    if (this.noSleep && this.noSleepStatus()) {
      try { this.noSleep.disable(); } catch { /* ignore */ }
    }
    this.noSleep = null;
    // Hotkeys
    for (const [, listener] of this.hotkeyListeners.entries()) {
      document.removeEventListener('keydown', listener);
    }
    this.hotkeyListeners.clear();
  }
}
