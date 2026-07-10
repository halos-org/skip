import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetHoekensAnchorAlarmComponent } from './widget-hoekens-anchor-alarm.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { DashboardService } from '../../core/services/dashboard.service';
import { ChromeVisibilityService } from '../../core/services/chrome-visibility.service';
import type { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

const INSTANCE_ID = 'test-hoekens-id';

function gestureFrom(gesture: string, source: MessageEventSource | null, origin: string): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { gesture, eventData: { instanceId: INSTANCE_ID } },
      origin,
      source
    })
  );
}

function mount(isStatic = true) {
  const options = signal<IWidgetSvcConfig | undefined>({});
  const dashboard = {
    isDashboardStatic: () => isStatic,
    navigateToNextDashboard: vi.fn(),
    navigateToPreviousDashboard: vi.fn()
  };
  const chrome = { reveal: vi.fn(), hide: vi.fn() };
  TestBed.configureTestingModule({
    imports: [WidgetHoekensAnchorAlarmComponent],
    providers: [
      { provide: WidgetRuntimeDirective, useValue: { options } },
      { provide: DashboardService, useValue: dashboard },
      { provide: ChromeVisibilityService, useValue: chrome }
    ]
  });
  const fixture = TestBed.createComponent(WidgetHoekensAnchorAlarmComponent);
  fixture.componentRef.setInput('id', INSTANCE_ID);
  fixture.componentRef.setInput('type', 'widget-hoekens-anchor-alarm');
  fixture.componentRef.setInput('theme', null);
  fixture.detectChanges();
  return { fixture, dashboard, chrome };
}

function iframeWindow(fixture: ComponentFixture<WidgetHoekensAnchorAlarmComponent>): Window {
  const iframe = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement | null;
  const win = iframe?.contentWindow ?? null;
  expect(win).toBeTruthy();
  return win as Window;
}

describe('WidgetHoekensAnchorAlarmComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('should create', () => {
    expect(mount().fixture.componentInstance).toBeTruthy();
  });

  it('hides the chrome on an upward gesture from its own iframe', () => {
    const { fixture, chrome } = mount();
    gestureFrom('swipeup', iframeWindow(fixture), window.location.origin);
    expect(chrome.hide).toHaveBeenCalledTimes(1);
  });

  it('reveals the chrome on a downward gesture from its own iframe', () => {
    const { fixture, chrome } = mount();
    gestureFrom('swipedown', iframeWindow(fixture), window.location.origin);
    expect(chrome.reveal).toHaveBeenCalledTimes(1);
  });

  it('navigates to the next page on a leftward gesture from its own iframe', () => {
    const { fixture, dashboard } = mount();
    gestureFrom('swipeleft', iframeWindow(fixture), window.location.origin);
    expect(dashboard.navigateToNextDashboard).toHaveBeenCalledTimes(1);
  });

  it('navigates to the previous page on a rightward gesture from its own iframe', () => {
    const { fixture, dashboard } = mount();
    gestureFrom('swiperight', iframeWindow(fixture), window.location.origin);
    expect(dashboard.navigateToPreviousDashboard).toHaveBeenCalledTimes(1);
  });

  it('does not page-navigate on a horizontal gesture while the dashboard is unlocked', () => {
    const { fixture, dashboard } = mount(false);
    gestureFrom('swipeleft', iframeWindow(fixture), window.location.origin);
    expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
  });

  it('ignores a gesture message from a foreign window source', () => {
    const { dashboard, chrome } = mount();
    gestureFrom('swipeup', window, window.location.origin);
    expect(chrome.hide).not.toHaveBeenCalled();
    expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
  });

  it('ignores a gesture message whose origin is not the app origin', () => {
    const { fixture, chrome } = mount();
    gestureFrom('swipeup', iframeWindow(fixture), 'https://evil.invalid');
    expect(chrome.hide).not.toHaveBeenCalled();
  });

  it('ignores a gesture whose instanceId does not match this widget', () => {
    const { fixture, chrome } = mount();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { gesture: 'swipeup', eventData: { instanceId: 'someone-else' } },
        origin: window.location.origin,
        source: iframeWindow(fixture)
      })
    );
    expect(chrome.hide).not.toHaveBeenCalled();
  });
});
