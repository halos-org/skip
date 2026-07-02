import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetIframeComponent } from './widget-iframe.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { DashboardService } from '../../core/services/dashboard.service';
import type { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

const INSTANCE_ID = 'test-iframe-id';
const EMBED_URL = `${window.location.origin}/embed`;

function swipeDownFrom(source: MessageEventSource | null, origin: string): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { gesture: 'swipedown', eventData: { instanceId: INSTANCE_ID } },
      origin,
      source
    })
  );
}

function mount(url: string | null = EMBED_URL) {
  const options = signal<IWidgetSvcConfig | undefined>({ widgetUrl: url, allowInput: true });
  const dashboard = {
    isDashboardStatic: () => true,
    navigateToNextDashboard: vi.fn(),
    navigateToPreviousDashboard: vi.fn()
  };
  TestBed.configureTestingModule({
    imports: [WidgetIframeComponent],
    providers: [
      { provide: WidgetRuntimeDirective, useValue: { options } },
      { provide: DashboardService, useValue: dashboard }
    ]
  });
  const fixture = TestBed.createComponent(WidgetIframeComponent);
  fixture.componentRef.setInput('id', INSTANCE_ID);
  fixture.componentRef.setInput('type', 'widget-iframe');
  fixture.componentRef.setInput('theme', null);
  fixture.detectChanges();
  return { fixture, dashboard };
}

function iframeWindow(fixture: ComponentFixture<WidgetIframeComponent>): Window {
  const iframe = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement | null;
  const win = iframe?.contentWindow ?? null;
  expect(win).toBeTruthy();
  return win as Window;
}

describe('WidgetIframeComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('should create', () => {
    expect(mount().fixture.componentInstance).toBeTruthy();
  });

  it('sandboxes the iframe to the minimal capabilities it needs', () => {
    const iframe = mount().fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin allow-scripts allow-forms');
  });

  it('acts on a gesture message from its own iframe', () => {
    const { fixture, dashboard } = mount();
    swipeDownFrom(iframeWindow(fixture), window.location.origin);
    expect(dashboard.navigateToNextDashboard).toHaveBeenCalledTimes(1);
  });

  it('ignores a gesture message from a foreign window source', () => {
    const { dashboard } = mount();
    swipeDownFrom(window, window.location.origin);
    expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
  });

  it('ignores a gesture message whose origin is not the iframe origin', () => {
    const { fixture, dashboard } = mount();
    swipeDownFrom(iframeWindow(fixture), 'https://evil.invalid');
    expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
  });
});
