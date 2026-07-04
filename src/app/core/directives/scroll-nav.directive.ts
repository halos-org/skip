import { DestroyRef, Directive, ElementRef, inject, input, output } from '@angular/core';

/** Accumulated horizontal wheel delta (px) that triggers a page change. */
export const SCROLL_NAV_HORIZONTAL_THRESHOLD = 40;
/** Vertical wheel delta (px) that triggers a toolbar reveal/hide. */
export const SCROLL_NAV_VERTICAL_THRESHOLD = 30;
/** After a page change, ignore further page-nav until inertia settles. */
export const SCROLL_NAV_COOLDOWN_MS = 500;

const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 400;

export type PageNavDirection = 'next' | 'prev';
export type ChromeIntent = 'reveal' | 'hide';

/**
 * Shell-level `wheel` interpreter for the navigation model.
 *
 * Trackpad/mouse-wheel input is classified by dominant axis:
 * - **Horizontal** → page navigation (and `preventDefault`, so a two-finger
 *   horizontal swipe does not trigger the browser's back/forward history).
 * - **Vertical** → toolbar reveal (scroll up) / hide (scroll down).
 *
 * It yields to a genuinely scrollable element under the pointer (so widget
 * content still scrolls), and applies a cooldown so inertial scrolling does not
 * flip several pages from one gesture. Touch swipes are handled separately by
 * `GestureDirective` at the shell; this directive only covers `wheel`, which
 * `GestureDirective` never sees.
 *
 * Attached at the shell (not the grid) so reveal works in edit mode, where the
 * grid's gesture recogniser disables swipes.
 */
@Directive({ selector: '[kipScrollNav]' })
export class ScrollNavDirective {
  /** When false (edit mode), horizontal wheel does not navigate pages. */
  public readonly navEnabled = input(true);
  /** When true, wheel input is ignored entirely (e.g. during a drag). */
  public readonly suspended = input(false);

  public readonly pageNav = output<PageNavDirection>();
  public readonly chromeIntent = output<ChromeIntent>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private lastNavAt = Number.NEGATIVE_INFINITY;

  constructor() {
    const el = this.host.nativeElement;
    // Non-passive: Angular event bindings/@HostListener cannot set
    // passive:false, and we must be able to preventDefault the horizontal case.
    el.addEventListener('wheel', this.onWheel, { passive: false });
    this.destroyRef.onDestroy(() => el.removeEventListener('wheel', this.onWheel));
  }

  /** Overridable clock so cooldown timing is deterministic in tests. */
  protected now(): number {
    return performance.now();
  }

  private onWheel = (ev: WheelEvent): void => {
    if (this.suspended()) return;

    const dx = this.toPixels(ev.deltaX, ev.deltaMode);
    const dy = this.toPixels(ev.deltaY, ev.deltaMode);
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < 1 && absY < 1) return;

    if (absX >= absY) {
      // Let a horizontally-scrollable widget under the pointer scroll instead.
      if (this.scrollableUnderPointer(ev.target, 'x', dx)) return;
      // Suppress the browser's history swipe for ANY horizontal-dominant wheel
      // (even in edit mode or while cooling down), so inertia never navigates
      // the browser back/forward.
      ev.preventDefault();
      if (!this.navEnabled()) return;
      if (absX < SCROLL_NAV_HORIZONTAL_THRESHOLD) return;
      const t = this.now();
      if (t - this.lastNavAt < SCROLL_NAV_COOLDOWN_MS) return;
      this.lastNavAt = t;
      this.pageNav.emit(dx > 0 ? 'next' : 'prev');
    } else {
      if (absY < SCROLL_NAV_VERTICAL_THRESHOLD) return;
      if (this.scrollableUnderPointer(ev.target, 'y', dy)) return;
      this.chromeIntent.emit(dy < 0 ? 'reveal' : 'hide');
    }
  };

  private toPixels(delta: number, mode: number): number {
    if (mode === 1) return delta * LINE_HEIGHT_PX;
    if (mode === 2) return delta * PAGE_HEIGHT_PX;
    return delta;
  }

  /**
   * True when an ancestor of `target` can still scroll in the wheel direction,
   * so the wheel should scroll that element rather than drive navigation.
   */
  private scrollableUnderPointer(target: EventTarget | null, axis: 'x' | 'y', delta: number): boolean {
    let el = target instanceof Element ? target : null;
    const host = this.host.nativeElement;
    while (el && el !== host) {
      if (el instanceof HTMLElement && this.canScroll(el, axis, delta)) return true;
      el = el.parentElement;
    }
    return false;
  }

  private canScroll(el: HTMLElement, axis: 'x' | 'y', delta: number): boolean {
    const style = getComputedStyle(el);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') return false;
    const size = axis === 'x' ? el.clientWidth : el.clientHeight;
    const scrollSize = axis === 'x' ? el.scrollWidth : el.scrollHeight;
    if (scrollSize <= size) return false;
    const pos = axis === 'x' ? el.scrollLeft : el.scrollTop;
    const maxPos = scrollSize - size;
    // Room to scroll further in the direction of the wheel delta?
    return delta > 0 ? pos < maxPos - 1 : pos > 1;
  }
}
