import { DestroyRef, Injectable, Provider, inject } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialog } from '@angular/material/dialog';
import { MAT_BOTTOM_SHEET_DEFAULT_OPTIONS, MatBottomSheet } from '@angular/material/bottom-sheet';
import { Observable, fromEvent } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EmbedModeService } from './embed-mode.service';

/**
 * The app's overlay defaults, in one place because a provider for either token replaces it wholesale
 * rather than merging — a second `MAT_DIALOG_DEFAULT_OPTIONS` provider silently drops the backdrop
 * class and focus settings from the first.
 *
 * `closeOnNavigation` is off for both because Material implements it by disposing the overlay from
 * inside the CDK's own location listener, which runs before this service sees the pop: the overlay
 * was gone, and the guard entry it stood behind was then unwound into a second Back that changed the
 * page after all. Closing on navigation is this service's job instead — one overlay for a guarded
 * Back, all of them for a real route change.
 */
export const OVERLAY_DEFAULT_OPTIONS_PROVIDERS: Provider[] = [
  {
    provide: MAT_DIALOG_DEFAULT_OPTIONS,
    useValue: {
      hasBackdrop: true,
      disableClose: false,
      autoFocus: 'first-tabbable',
      delayFocusTrap: true,
      backdropClass: 'dialogBackdrop',
      closeOnNavigation: false
    }
  },
  { provide: MAT_BOTTOM_SHEET_DEFAULT_OPTIONS, useValue: { closeOnNavigation: false } }
];

/** One blocking overlay and the history entry standing in front of it. */
interface IGuardedOverlay {
  close: () => void;
}

/**
 * Makes browser Back close the topmost blocking overlay rather than leave the page under it.
 *
 * Every dialog and every registered bottom sheet gets a history entry pushed in front of it at the
 * URL the app is already on. Back then pops an entry whose URL is identical, so the router treats it
 * as a same-URL navigation and ignores it, and the pop is free to close one overlay instead. With
 * nothing of ours left on the stack, a pop is the page's own and navigates as before.
 *
 * An overlay dismissed by Esc, a button or the backdrop takes its entry with it, so a later Back is
 * never swallowed by an entry standing in front of nothing.
 */
@Injectable({
  providedIn: 'root'
})
export class RouterOverlayNavigationService {
  private readonly _router = inject(Router);
  private readonly _dialog = inject(MatDialog);
  private readonly _bottomSheet = inject(MatBottomSheet);
  private readonly _embed = inject(EmbedModeService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _stack: IGuardedOverlay[] = [];
  /** Set while a pop is closing an overlay: that entry is already gone from the history. */
  private _consumingPop = false;
  /** Set while unwinding our own entry, so the pop it causes is not read as a Back press. */
  private _unwinding = false;

  constructor() {
    this._router.events
      .pipe(
        filter((event): event is NavigationStart => event instanceof NavigationStart),
        takeUntilDestroyed(this._destroyRef)
      )
      .subscribe(event => {
        // A pop that this service is handling closes exactly one overlay; only a genuine route
        // change clears them all. The router raises NavigationStart for the guard's own pop before
        // the popstate listener runs, even though the URL is unchanged, so the trigger is what
        // separates a Back standing on a guard entry from a real navigation.
        if (this._stack.length > 0 && event.navigationTrigger === 'popstate') return;
        if (this._consumingPop) return;
        // Drop the entries before closing anything. The route the user asked for is already
        // committing, and an entry still on the stack when its overlay reports closed would unwind
        // into a history.back() that takes them off that route again.
        this._stack.length = 0;
        if (this._dialog.openDialogs.length > 0) {
          this._dialog.closeAll();
        }
        this._bottomSheet.dismiss();
      });

    if (this._embed.embed()) return;

    this._dialog.afterOpened
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(ref => this.guardOverlay(() => ref.close(), ref.afterClosed()));

    fromEvent(window, 'popstate')
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this.onPopState());
  }

  /**
   * Put a history entry in front of an overlay this service does not open itself — a bottom sheet,
   * whose service publishes no opened stream. `close` closes that overlay; `closed$` fires once it
   * has gone, however it went.
   */
  public guardOverlay(close: () => void, closed$: Observable<unknown>): void {
    if (this._embed.embed()) return;
    const entry: IGuardedOverlay = { close };
    this._stack.push(entry);
    // Same URL, so popping it is a same-URL navigation the router ignores.
    window.history.pushState(window.history.state, '', window.location.href);

    closed$
      .pipe(take(1), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this.release(entry));
  }

  private onPopState(): void {
    if (this._unwinding) {
      this._unwinding = false;
      return;
    }
    const entry = this._stack.pop();
    if (!entry) return;

    this._consumingPop = true;
    try {
      entry.close();
    } finally {
      this._consumingPop = false;
    }
  }

  /** An overlay closed on its own terms; take its history entry back down with it. */
  private release(entry: IGuardedOverlay): void {
    const index = this._stack.lastIndexOf(entry);
    if (index === -1) return; // A pop already removed it, which is what closed the overlay.
    this._stack.splice(index, 1);
    // Only the topmost entry is ours to pop. A lower one is left behind rather than popping past a
    // still-open overlay above it; the stale entry costs one dead Back press at most.
    if (index !== this._stack.length) return;
    this._unwinding = true;
    window.history.back();
  }
}
