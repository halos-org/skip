import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MAT_BOTTOM_SHEET_DEFAULT_OPTIONS, MatBottomSheet } from '@angular/material/bottom-sheet';
import { Router, NavigationStart } from '@angular/router';
import { EmbedModeService } from './embed-mode.service';
import { OVERLAY_DEFAULT_OPTIONS_PROVIDERS, RouterOverlayNavigationService } from './router-overlay-navigation.service';

interface DialogStub { afterClosed: () => Subject<unknown>; close: () => void }

describe('RouterOverlayNavigationService', () => {
  const routerEvents = new Subject<unknown>();
  const dialogOpened = new Subject<MatDialogRef<unknown>>();
  let openDialogs: DialogStub[];
  let dialogMock: { afterOpened: Subject<MatDialogRef<unknown>>; openDialogs: DialogStub[]; closeAll: () => void };
  let bottomSheetMock: { dismiss: ReturnType<typeof vi.fn<() => void>> };
  let embed: boolean;

  const openDialog = (): { closed: Subject<unknown>; close: ReturnType<typeof vi.fn> } => {
    const closed = new Subject<unknown>();
    const close = vi.fn(() => closed.next(undefined));
    const stub: DialogStub = { afterClosed: () => closed, close };
    openDialogs.push(stub);
    dialogOpened.next(stub as unknown as MatDialogRef<unknown>);
    return { closed, close };
  };

  const pop = (): void => { window.dispatchEvent(new PopStateEvent('popstate')); };

  const create = (): RouterOverlayNavigationService => TestBed.inject(RouterOverlayNavigationService);

  beforeEach(() => {
    openDialogs = [];
    embed = false;
    dialogMock = { afterOpened: dialogOpened, openDialogs, closeAll: vi.fn() };
    bottomSheetMock = { dismiss: vi.fn() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatBottomSheet, useValue: bottomSheetMock },
        { provide: Router, useValue: { events: routerEvents } },
        { provide: EmbedModeService, useValue: { embed: () => embed } }
      ]
    });
    vi.restoreAllMocks();
  });

  it('closes the open dialog on Back instead of letting the route change (#393)', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    create();
    const dialog = openDialog();
    expect(pushSpy).toHaveBeenCalledTimes(1);

    pop();

    expect(dialog.close).toHaveBeenCalledTimes(1);
  });

  it('closes one overlay per Back, topmost first (#393)', () => {
    create();
    const first = openDialog();
    const second = openDialog();

    pop();
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(first.close).not.toHaveBeenCalled();

    pop();
    expect(first.close).toHaveBeenCalledTimes(1);
  });

  it('lets Back navigate once no overlay is left (#393)', () => {
    create();
    const dialog = openDialog();
    pop();
    expect(dialog.close).toHaveBeenCalled();

    // Nothing of ours is left on the stack, so this pop belongs to the router.
    const backSpy = vi.spyOn(window.history, 'back');
    pop();
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('drops its history entry when the dialog closes by other means (#393)', () => {
    // Esc, Cancel or the backdrop close the dialog without a pop. The guard entry has to go with
    // it, or the next Back is swallowed closing an overlay that is no longer on screen.
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    create();
    const dialog = openDialog();

    openDialogs.pop();
    dialog.closed.next(undefined);

    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('does not push its own history entry back when Back is what closed the dialog (#393)', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    create();
    openDialog();

    pop();

    expect(backSpy).not.toHaveBeenCalled();
  });

  it('leaves the session history alone in embed mode (#393)', () => {
    // Skip runs in an iframe inside the Freeboard panel, where its history entries land in the
    // host page's session history and would make the host's Back button close Skip's dialogs.
    embed = true;
    const pushSpy = vi.spyOn(window.history, 'pushState');
    create();
    const dialog = openDialog();

    expect(pushSpy).not.toHaveBeenCalled();
    pop();
    expect(dialog.close).not.toHaveBeenCalled();
  });

  it('still clears overlays when a real navigation starts', () => {
    create();
    openDialog();

    routerEvents.next(new NavigationStart(1, '/page/2', 'imperative'));

    expect(dialogMock.closeAll).toHaveBeenCalledTimes(1);
    expect(bottomSheetMock.dismiss).toHaveBeenCalled();
  });

  it('leaves the guard pop to the popstate handler rather than clearing every overlay (#393)', () => {
    // The router raises NavigationStart for the guard entry's own pop — same URL, but it still
    // fires, and it arrives first. Clearing there closed every overlay and unwound the guard entry
    // with a second history.back(), which navigated the page after all.
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    create();
    openDialog();

    routerEvents.next(new NavigationStart(1, '/page/1', 'popstate'));

    expect(dialogMock.closeAll).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('takes closeOnNavigation off both overlay types (#393)', () => {
    // Material disposes the overlay from its own location listener, which runs before this service
    // sees the pop: the overlay vanishes, and the guard entry standing behind it unwinds into a
    // second Back that changes the page. Dropping this provider silently restores that.
    const values = OVERLAY_DEFAULT_OPTIONS_PROVIDERS.map(p => p as { provide: unknown; useValue: Record<string, unknown> });
    expect(values.map(p => p.provide)).toEqual([MAT_DIALOG_DEFAULT_OPTIONS, MAT_BOTTOM_SHEET_DEFAULT_OPTIONS]);
    expect(values.every(p => p.useValue['closeOnNavigation'] === false)).toBe(true);
  });

  it('keeps the app-wide dialog styling in the same provider', () => {
    // A second provider for the token replaces the first rather than merging with it, so these
    // options have to travel with closeOnNavigation or dialogs silently lose their backdrop.
    const dialogOptions = (OVERLAY_DEFAULT_OPTIONS_PROVIDERS[0] as { useValue: Record<string, unknown> }).useValue;
    expect(dialogOptions).toMatchObject({
      hasBackdrop: true,
      disableClose: false,
      autoFocus: 'first-tabbable',
      delayFocusTrap: true,
      backdropClass: 'dialogBackdrop'
    });
  });

  it('does not unwind guard entries into the route a real navigation is entering (#393)', () => {
    // closeAll() makes every open overlay report closed. An entry still on the stack would then
    // release into a history.back() that takes the user off the page they just asked for.
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    create();
    const dialog = openDialog();

    routerEvents.next(new NavigationStart(1, '/page/2', 'imperative'));
    openDialogs.pop();
    dialog.closed.next(undefined);

    expect(backSpy).not.toHaveBeenCalled();
  });

  it('dismisses a guarded bottom sheet on Back (#393)', () => {
    const service = create();
    const dismissed = new Subject<unknown>();
    service.guardOverlay(() => bottomSheetMock.dismiss(), dismissed);

    pop();

    expect(bottomSheetMock.dismiss).toHaveBeenCalledTimes(1);
  });
});
