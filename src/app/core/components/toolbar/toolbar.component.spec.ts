import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppService } from '../../services/app-service';
import { ChromeVisibilityService, CHROME_HOVER_DWELL_MS } from '../../services/chrome-visibility.service';
import { DashboardService } from '../../services/dashboard.service';
import { DialogService } from '../../services/dialog.service';
import { NotificationsService } from '../../services/notifications.service';
import { SettingsService } from '../../services/settings.service';
import { uiEventService } from '../../services/uiEvent.service';
import { ToolbarComponent } from './toolbar.component';

const chrome = {
  revealed: signal(false),
  peeking: signal(false),
  reveal: vi.fn(),
  suppressHide: vi.fn(),
  allowHide: vi.fn(),
};
const dashboard = {
  dashboards: signal([{ id: 'a', name: 'Nav', icon: 'ic' }]),
  activeDashboard: signal(0),
  navigateTo: vi.fn(),
  setStaticDashboard: vi.fn(),
};
const uiEvent = {
  toggleFullScreen: vi.fn(),
  fullscreenSupported: signal(true),
  fullscreenStatus: signal(false),
};
const app = { isNightMode: signal(false), toggleDayNightMode: vi.fn(), toggleNightMode: vi.fn() };
const settings = { autoNightMode: signal(false) };
const dialog = { openNotifications: vi.fn() };
const router = { navigate: vi.fn() };
const alarmCount = signal(0);
const notifications = {
  observerNotificationsInfo: () =>
    of({ alarmCount: alarmCount(), isWarn: false, isAlarmEmergency: false }),
};

describe('ToolbarComponent', () => {
  let fixture: ComponentFixture<ToolbarComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    for (const spy of [
      chrome.reveal, chrome.suppressHide, chrome.allowHide,
      dashboard.navigateTo, dashboard.setStaticDashboard,
      uiEvent.toggleFullScreen, app.toggleDayNightMode, app.toggleNightMode, dialog.openNotifications, router.navigate,
    ]) spy.mockClear();
    chrome.revealed.set(false);
    chrome.peeking.set(false);
    uiEvent.fullscreenSupported.set(true);
    uiEvent.fullscreenStatus.set(false);
    app.isNightMode.set(false);
    settings.autoNightMode.set(false);
    alarmCount.set(0);

    TestBed.configureTestingModule({
      imports: [ToolbarComponent],
      providers: [
        { provide: ChromeVisibilityService, useValue: chrome },
        { provide: DashboardService, useValue: dashboard },
        { provide: uiEventService, useValue: uiEvent },
        { provide: AppService, useValue: app },
        { provide: SettingsService, useValue: settings },
        { provide: DialogService, useValue: dialog },
        { provide: NotificationsService, useValue: notifications },
        { provide: Router, useValue: router },
      ],
    });
  });

  function init(): void {
    fixture = TestBed.createComponent(ToolbarComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const byLabel = (label: string) => el.querySelector<HTMLElement>(`[aria-label="${label}"]`);

  it('opens the actions view via the router', () => {
    init();
    byLabel('Settings')!.click();
    expect(router.navigate).toHaveBeenCalledWith(['/actions']);
  });

  it('toggles fullscreen and night mode', () => {
    init();
    byLabel('Enter fullscreen')!.click();
    expect(uiEvent.toggleFullScreen).toHaveBeenCalled();
    byLabel('Night mode')!.click();
    expect(app.toggleNightMode).toHaveBeenCalled();
  });

  it('enters edit mode and opens notifications', () => {
    init();
    byLabel('Edit page')!.click();
    expect(dashboard.setStaticDashboard).toHaveBeenCalledWith(false);
    byLabel('Notifications')!.click();
    expect(dialog.openNotifications).toHaveBeenCalled();
  });

  it('reveals on peek-strip click and suppresses/resumes hide on hover', () => {
    init();
    byLabel('Show navigation toolbar')!.click();
    expect(chrome.reveal).toHaveBeenCalled();
    const bar = el.querySelector<HTMLElement>('.toolbar')!;
    bar.dispatchEvent(new MouseEvent('mouseenter'));
    expect(chrome.suppressHide).toHaveBeenCalled();
    bar.dispatchEvent(new MouseEvent('mouseleave'));
    expect(chrome.allowHide).toHaveBeenCalled();
  });

  it('releases a held hide-suppression when destroyed mid-hover', () => {
    init();
    el.querySelector<HTMLElement>('.toolbar')!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(chrome.suppressHide).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(chrome.allowHide).toHaveBeenCalledTimes(1);
  });

  it('reflects revealed state as a class', () => {
    chrome.revealed.set(true);
    init();
    expect(el.querySelector('.toolbar-host')!.classList.contains('revealed')).toBe(true);
  });

  describe('hover-reveal (peek-band dwell)', () => {
    // Drive the component's document-pointermove handler directly: dispatching on `document` would also
    // fire the leaked listeners of prior test fixtures, breaking isolation.
    interface HoverApi { onDocumentPointerMove: (e: PointerEvent) => void }
    const move = (clientY: number, pointerType = 'mouse') => ({ clientY, pointerType }) as PointerEvent;

    it('reveals the toolbar after the cursor dwells in the top peek band', () => {
      vi.useFakeTimers();
      try {
        init();
        const api = fixture.componentInstance as unknown as HoverApi;
        api.onDocumentPointerMove(move(4)); // within the 8px band
        expect(chrome.reveal).not.toHaveBeenCalled(); // not until the dwell elapses
        vi.advanceTimersByTime(CHROME_HOVER_DWELL_MS);
        expect(chrome.reveal).toHaveBeenCalledTimes(1);
      } finally { vi.useRealTimers(); }
    });

    it('cancels the dwell when the cursor leaves the band before it elapses', () => {
      vi.useFakeTimers();
      try {
        init();
        const api = fixture.componentInstance as unknown as HoverApi;
        api.onDocumentPointerMove(move(4));
        vi.advanceTimersByTime(CHROME_HOVER_DWELL_MS - 50);
        api.onDocumentPointerMove(move(200)); // leaves the band
        vi.advanceTimersByTime(200);
        expect(chrome.reveal).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it('ignores a touch pointer (tap-to-reveal stays the touch path)', () => {
      vi.useFakeTimers();
      try {
        init();
        const api = fixture.componentInstance as unknown as HoverApi;
        api.onDocumentPointerMove(move(4, 'touch'));
        vi.advanceTimersByTime(CHROME_HOVER_DWELL_MS);
        expect(chrome.reveal).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it('does not arm a dwell while the toolbar is already revealed', () => {
      vi.useFakeTimers();
      try {
        chrome.revealed.set(true);
        init();
        const api = fixture.componentInstance as unknown as HoverApi;
        api.onDocumentPointerMove(move(4));
        vi.advanceTimersByTime(CHROME_HOVER_DWELL_MS);
        expect(chrome.reveal).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it('stops a pending dwell on destroy', () => {
      vi.useFakeTimers();
      try {
        init();
        const api = fixture.componentInstance as unknown as HoverApi;
        api.onDocumentPointerMove(move(4));
        fixture.destroy();
        vi.advanceTimersByTime(CHROME_HOVER_DWELL_MS);
        expect(chrome.reveal).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it('binds the passive document listener on construct and removes the same handler on destroy', () => {
      const add = vi.spyOn(document, 'addEventListener');
      init();
      const registered = add.mock.calls.find((c) => c[0] === 'pointermove');
      expect(registered).toBeTruthy();
      expect(registered![2]).toEqual({ passive: true });

      const remove = vi.spyOn(document, 'removeEventListener');
      fixture.destroy();
      expect(remove).toHaveBeenCalledWith('pointermove', registered![1]);

      add.mockRestore();
      remove.mockRestore();
    });

    it('keeps the original dwell running across small in-zone moves (dwell measures time in the band)', () => {
      vi.useFakeTimers();
      try {
        init();
        const api = fixture.componentInstance as unknown as HoverApi;
        api.onDocumentPointerMove(move(4)); // enter → arm the dwell
        vi.advanceTimersByTime(CHROME_HOVER_DWELL_MS - 50);
        api.onDocumentPointerMove(move(3)); // a small move still inside the band must NOT reset the dwell
        vi.advanceTimersByTime(50); // now CHROME_HOVER_DWELL_MS after the original entry
        expect(chrome.reveal).toHaveBeenCalledTimes(1);
      } finally { vi.useRealTimers(); }
    });

    it('arms a fresh dwell after leaving and re-entering the band', () => {
      vi.useFakeTimers();
      try {
        init();
        const api = fixture.componentInstance as unknown as HoverApi;
        api.onDocumentPointerMove(move(4));
        api.onDocumentPointerMove(move(200)); // leave → cancels
        vi.advanceTimersByTime(CHROME_HOVER_DWELL_MS);
        expect(chrome.reveal).not.toHaveBeenCalled();

        api.onDocumentPointerMove(move(4)); // re-enter → fresh dwell
        vi.advanceTimersByTime(CHROME_HOVER_DWELL_MS);
        expect(chrome.reveal).toHaveBeenCalledTimes(1);
      } finally { vi.useRealTimers(); }
    });
  });

  it('hides the night toggle in auto-night mode and fullscreen when unsupported', () => {
    settings.autoNightMode.set(true);
    uiEvent.fullscreenSupported.set(false);
    init();
    expect(byLabel('Night mode')).toBeNull();
    expect(byLabel('Enter fullscreen')).toBeNull();
  });

  it('surfaces the active alarm count for the badge', () => {
    alarmCount.set(3);
    init();
    const count = (fixture.componentInstance as unknown as { alarmCount: () => number }).alarmCount();
    expect(count).toBe(3);
  });
});
