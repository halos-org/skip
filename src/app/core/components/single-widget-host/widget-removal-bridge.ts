import { Injectable, OnDestroy } from '@angular/core';
import type { ExtensionClient } from 'signalk-plotterext-bus/extension';

const LONG_PRESS_MS = 1500;
const MOVE_SLOP_PX = 10;

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
 * Makes a plotter-extension widget removable. A Freeboard-SK host offers no host-side remove for a
 * placed widget: removal is a long-press on the tile that opens the host's remove dialog — but
 * pointer events inside the sandboxed iframe are invisible to the host, so the widget must relay the
 * gesture over the plotter-extension bus (`ui.openConfigPanel`, which with no `configPanel` declared
 * opens the host's remove-only dialog).
 *
 * This is the only use of the bus here: the widget's data still comes from Skip's own same-origin
 * Signal K session, not the host relay. When the widget is opened outside a host (a direct URL), the
 * handshake times out and the long-press is a harmless no-op.
 */
@Injectable({ providedIn: 'root' })
export class WidgetRemovalBridge implements OnDestroy {
  private client: ExtensionClient | null = null;
  private removeListeners: (() => void) | null = null;
  private disposed = false;

  enable(): void {
    if (this.removeListeners) return;
    this.removeListeners = installLongPress(() => {
      void this.client?.call('ui.openConfigPanel').catch(() => { /* no host / dialog already open */ });
    });
    void this.connect();
  }

  disable(): void {
    this.disposed = true;
    this.removeListeners?.();
    this.removeListeners = null;
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
    } catch {
      // No host answered the handshake (direct-URL open) or it timed out: the long-press listener
      // stays installed but has no client to call, so it is an inert no-op.
    }
  }
}
