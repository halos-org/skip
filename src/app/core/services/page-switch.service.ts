import { effect, inject, Injectable, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DashboardService } from './dashboard.service';
import { DataService, IPathUpdate } from './data.service';
import { uiEventService } from './uiEvent.service';
import { EmbedModeService } from './embed-mode.service';

/**
 * How long a genuine value *change* must hold before an auto-switch fires — debounces a
 * transient pass-through value during a real state transition. The value already present at
 * startup (a path's first known value) switches immediately, without this delay.
 */
export const PAGE_SWITCH_DWELL_MS = 2500;

/** Sentinel for "no value seen yet" so a path's first real value is recognised as its baseline. */
const UNSET = Symbol('page-switch-unset');

interface PathWatch {
  /** Last value seen on this path (UNSET until the first non-null emission). */
  value: unknown;
  release: () => void;
  sub: Subscription;
  dwellTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Watches each page's optional auto-show trigger and navigates to a page when its Signal K
 * value comes up.
 *
 * Two distinct behaviours:
 *  - **Startup / first-known value** (the value already true when the app opens): switch
 *    immediately and silently — no dwell, no cue. This is a one-time "boot into the right page".
 *  - **Runtime change** (the value transitions to a trigger while the app runs): switch only
 *    after the value holds for a short dwell, with a snackbar cue.
 *
 * Guarded throughout by isDashboardStatic / isDragging / an active page. Inert in embed mode.
 */
@Injectable({ providedIn: 'root' })
export class PageSwitchService {
  private readonly _dashboard = inject(DashboardService);
  private readonly _data = inject(DataService);
  private readonly _uiEvent = inject(uiEventService);
  private readonly _embed = inject(EmbedModeService);
  private readonly _snackBar = inject(MatSnackBar);

  private readonly _watches = new Map<string, PathWatch>();
  /** Becomes true the first time a page is active; the startup jump runs exactly once. */
  private _startupHandled = false;

  constructor() {
    // A chromeless embed panel is strictly read-only: never move its page.
    if (this._embed.embed()) return;

    // Keep one subscription per distinct configured trigger path, rebuilt as pages change.
    effect(() => {
      const desired = new Set<string>();
      for (const dashboard of this._dashboard.dashboards()) {
        if (dashboard.trigger?.path) desired.add(dashboard.trigger.path);
      }
      untracked(() => this.syncSubscriptions(desired));
    });

    // Startup jump: the first time a page becomes active, switch to the first page whose trigger
    // already matches its path's current value — immediately, without a cue. Runs once, so a later
    // manual navigation is never undone.
    effect(() => {
      const active = this._dashboard.activeDashboard();
      untracked(() => {
        if (this._startupHandled || active === null) return;
        this._startupHandled = true;
        this.evaluateCurrentValues();
      });
    });
  }

  private syncSubscriptions(desired: Set<string>): void {
    for (const [path, watch] of this._watches) {
      if (!desired.has(path)) {
        this.teardown(watch);
        this._watches.delete(path);
      }
    }
    for (const path of desired) {
      if (this._watches.has(path)) continue;
      const { data$, release } = this._data.acquirePath(path, 'default');
      const watch: PathWatch = { value: UNSET, release, sub: Subscription.EMPTY };
      this._watches.set(path, watch);
      // subscribe after registering the watch so the synchronous replay finds it.
      watch.sub = data$.subscribe(update => this.onUpdate(path, update));
    }
  }

  private teardown(watch: PathWatch): void {
    this.cancelDwell(watch);
    // release() alone only decrements the shared refcount; unsubscribe stops OUR handler.
    watch.sub.unsubscribe();
    watch.release();
  }

  private cancelDwell(watch: PathWatch): void {
    if (watch.dwellTimer) {
      clearTimeout(watch.dwellTimer);
      watch.dwellTimer = undefined;
    }
  }

  private onUpdate(path: string, update: IPathUpdate): void {
    const watch = this._watches.get(path);
    if (!watch) return;
    const value = update.data.value;

    if (value == null) {
      // A cleared value cancels any pending switch and resets the baseline, so a later
      // re-assertion of the same value is seen as a fresh change rather than deduped away.
      this.cancelDwell(watch);
      watch.value = UNSET;
      return;
    }
    if (Object.is(value, watch.value)) return; // dedupe replays / unchanged

    const firstValue = watch.value === UNSET;
    watch.value = value;

    // Before startup is handled, a path's first value is only a baseline: the startup effect
    // performs the one-time silent jump. A first value arriving AFTER startup is a genuine
    // (late) change and takes the normal dwell + cue path below, scoped to this path — never a
    // global re-evaluate, which could silently switch to an unrelated already-matching page.
    if (firstValue && !this._startupHandled) return;

    if (!this.hasMatchingPage(path, value)) {
      this.cancelDwell(watch);
      return;
    }

    this.cancelDwell(watch);
    watch.dwellTimer = setTimeout(() => this.onDwellElapsed(path, value), PAGE_SWITCH_DWELL_MS);
  }

  private onDwellElapsed(path: string, value: unknown): void {
    const watch = this._watches.get(path);
    if (!watch) return;
    watch.dwellTimer = undefined;
    if (!Object.is(watch.value, value)) return; // value moved on while the dwell was pending
    const idx = this.matchingPageIndex(path, value);
    if (idx < 0) return;
    this.switchTo(idx, true);
  }

  private evaluateCurrentValues(): void {
    const dashboards = this._dashboard.dashboards();
    const idx = dashboards.findIndex(dashboard => {
      if (!dashboard.trigger) return false;
      const watch = this._watches.get(dashboard.trigger.path);
      return watch !== undefined && this.valueMatches(watch.value, dashboard.trigger.value);
    });
    if (idx >= 0) this.switchTo(idx, false);
  }

  /**
   * Guarded navigation. `notify` shows the snackbar cue for runtime changes; the startup jump
   * passes false so opening the app lands on the right page silently.
   */
  private switchTo(idx: number, notify: boolean): void {
    // isPageTransitioning: navigateTo no-ops mid-transition, so switching then would show a
    // "Switched to …" cue for a navigation that never happened.
    if (!this._dashboard.isDashboardStatic() || this._uiEvent.isDragging() || this._dashboard.isPageTransitioning()) return;
    const active = this._dashboard.activeDashboard();
    if (active === null || active === idx) return;
    this._dashboard.navigateTo(idx);
    if (notify) {
      const name = this._dashboard.dashboards()[idx]?.name ?? 'page';
      this._snackBar.open(`Switched to ${name}`, undefined, { duration: 4000 });
    }
  }

  private hasMatchingPage(path: string, value: unknown): boolean {
    return this.matchingPageIndex(path, value) >= 0;
  }

  private matchingPageIndex(path: string, value: unknown): number {
    return this._dashboard.dashboards().findIndex(d =>
      d.trigger?.path === path && this.valueMatches(value, d.trigger.value));
  }

  private valueMatches(liveValue: unknown, triggerValue: string): boolean {
    return String(liveValue) === triggerValue;
  }
}
