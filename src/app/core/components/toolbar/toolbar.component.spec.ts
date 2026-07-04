import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppService } from '../../services/app-service';
import { ChromeVisibilityService } from '../../services/chrome-visibility.service';
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
const app = { isNightMode: signal(false), toggleDayNightMode: vi.fn() };
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
      uiEvent.toggleFullScreen, app.toggleDayNightMode, dialog.openNotifications, router.navigate,
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

  it('opens Settings via the router', () => {
    init();
    byLabel('Settings')!.click();
    expect(router.navigate).toHaveBeenCalledWith(['/settings']);
  });

  it('toggles fullscreen and night mode', () => {
    init();
    byLabel('Enter fullscreen')!.click();
    expect(uiEvent.toggleFullScreen).toHaveBeenCalled();
    byLabel('Night mode')!.click();
    expect(app.isNightMode()).toBe(true);
    expect(app.toggleDayNightMode).toHaveBeenCalled();
  });

  it('enters edit mode and opens notifications', () => {
    init();
    byLabel('Edit dashboard')!.click();
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

  it('reflects revealed state as a class', () => {
    chrome.revealed.set(true);
    init();
    expect(el.querySelector('.toolbar-host')!.classList.contains('revealed')).toBe(true);
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
