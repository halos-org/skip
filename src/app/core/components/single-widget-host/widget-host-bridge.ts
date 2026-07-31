import { Injectable, OnDestroy, Signal, signal } from '@angular/core';
import type { ExtensionClient } from 'signalk-plotterext-bus/extension';
import type { IWidgetSvcConfig } from '../../interfaces/widgets-interface';

const LONG_PRESS_MS = 1500;
const MOVE_SLOP_PX = 10;

// Per-instance state key holding the user's saved widget config overlay. Shared with the config
// panel (WidgetConfigPanelComponent), which writes the same key.
export const WIDGET_CONFIG_STATE_KEY = 'config';

/**
 * Detect a press-and-hold anywhere in the widget iframe and invoke `onLongPress`. Listeners are
 * capture-phase on `window` so an inner gesture handler (Skip's own widget host) cannot swallow the
 * gesture via `stopPropagation`. Returns a teardown that removes the listeners.
 */
export function installLongPress(onLongPress: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin: { x: number; y: number } | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    origin = null;
  };
  const down = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    cancel();
    origin = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => { timer = null; onLongPress(); }, LONG_PRESS_MS);
  };
  const move = (e: PointerEvent) => {
    if (!timer || !origin) return;
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    if (dx * dx + dy * dy > MOVE_SLOP_PX * MOVE_SLOP_PX) cancel();
  };

  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', cancel, true);
  window.addEventListener('pointercancel', cancel, true);
  return () => {
    cancel();
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', cancel, true);
    window.removeEventListener('pointercancel', cancel, true);
  };
}

/**
 * Bridges a single-widget host iframe to the Freeboard-SK plotter-extension host. A placed widget has
 * no host-side controls of its own, so two things ride the plotter-extension bus:
 *
 * - **Removal / settings menu.** A long-press relays `ui.openConfigPanel`, which opens the host
 *   dialog carrying the widget's settings panel and a Remove button. Pointer events inside the
 *   sandboxed iframe are invisible to the host, so the widget must detect and relay the gesture.
 * - **Per-instance config.** On connect it reads the user's saved config from host `state` and
 *   follows `state.changed` (written by the config panel), exposing it as the `config` signal for the
 *   host component to apply to the live tile.
 *
 * This is the only use of the bus — the widget's data still comes from Skip's own same-origin Signal K
 * session. Opened outside a host (a direct URL) the handshake times out and this is inert.
 */
@Injectable({ providedIn: 'root' })
export class WidgetHostBridge implements OnDestroy {
  private client: ExtensionClient | null = null;
  private removeListeners: (() => void) | null = null;
  private unsubscribeState: (() => Promise<void>) | null = null;
  private disposed = false;

  private readonly _config = signal<IWidgetSvcConfig | null>(null);
  /** The user's saved per-instance config overlay, or null when none. Updates live on save. */
  readonly config: Signal<IWidgetSvcConfig | null> = this._config.asReadonly();

  enable(): void {
    if (this.removeListeners) return;
    this.removeListeners = installLongPress(() => {
      void this.client?.call('ui.openConfigPanel').catch(() => { /* no host / already open */ });
    });
    void this.connect();
  }

  disable(): void {
    this.disposed = true;
    this.removeListeners?.();
    this.removeListeners = null;
    void this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.client?.close();
    this.client = null;
  }

  ngOnDestroy(): void {
    this.disable();
  }

  private async connect(): Promise<void> {
    try {
      const { connectExtension } = await import('signalk-plotterext-bus/extension');
      const client = await connectExtension({ onError: () => { /* transport noise */ } });
      if (this.disposed) { client.close(); return; }
      this.client = client;
      await this.loadConfig();
      // Follow config the panel saves; state.changed fires on every host state.set for this instance.
      this.unsubscribeState = await client.subscribe(['state.changed'], () => { void this.loadConfig(); });
    } catch {
      // No host answered (direct-URL open) or the handshake timed out: nothing to relay or load.
    }
  }

  private async loadConfig(): Promise<void> {
    if (!this.client) return;
    try {
      const values = await this.client.state.get([WIDGET_CONFIG_STATE_KEY]);
      const cfg = values[WIDGET_CONFIG_STATE_KEY];
      this._config.set(cfg && typeof cfg === 'object' ? (cfg as IWidgetSvcConfig) : null);
    } catch {
      // Host has no state capability, or the read failed: keep whatever config we last applied.
    }
  }
}
