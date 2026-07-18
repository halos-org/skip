import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChromeIntent,
  PageNavDirection,
  SCROLL_NAV_COOLDOWN_MS,
  SCROLL_NAV_HORIZONTAL_THRESHOLD,
  SCROLL_NAV_VERTICAL_THRESHOLD,
  ScrollNavDirective,
} from './scroll-nav.directive';

@Component({
  standalone: true,
  imports: [ScrollNavDirective],
  template: `<div
    skipScrollNav
    [navEnabled]="navEnabled"
    [suspended]="suspended"
    (pageNav)="pageNav.push($event)"
    (chromeIntent)="chromeIntent.push($event)"
  ><span class="child"></span></div>`,
})
class HostComponent {
  navEnabled = true;
  suspended = false;
  pageNav: PageNavDirection[] = [];
  chromeIntent: ChromeIntent[] = [];
}

function dispatchWheel(el: Element, init: WheelEventInit): WheelEvent {
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(ev);
  return ev;
}

describe('ScrollNavDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let hostEl: HTMLElement;

  const H = SCROLL_NAV_HORIZONTAL_THRESHOLD;
  const V = SCROLL_NAV_VERTICAL_THRESHOLD;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  afterEach(() => vi.restoreAllMocks());

  /** Instantiate the directive (and its wheel listener) once inputs are set. */
  function init(): void {
    fixture.detectChanges();
    hostEl = fixture.nativeElement.querySelector('[skipScrollNav]') as HTMLElement;
  }

  it('navigates next on a dominant rightward wheel and blocks browser history', () => {
    init();
    const ev = dispatchWheel(hostEl, { deltaX: H + 5, deltaY: 0 });
    expect(host.pageNav).toEqual(['next']);
    expect(host.chromeIntent).toEqual([]);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('navigates prev on a dominant leftward wheel', () => {
    init();
    dispatchWheel(hostEl, { deltaX: -(H + 5), deltaY: 0 });
    expect(host.pageNav).toEqual(['prev']);
  });

  it('reveals on scroll-up and hides on scroll-down', () => {
    init();
    dispatchWheel(hostEl, { deltaX: 0, deltaY: -(V + 5) });
    dispatchWheel(hostEl, { deltaX: 0, deltaY: V + 5 });
    expect(host.chromeIntent).toEqual(['reveal', 'hide']);
    expect(host.pageNav).toEqual([]);
  });

  it('ignores sub-threshold deltas', () => {
    init();
    dispatchWheel(hostEl, { deltaX: H - 5, deltaY: 0 });
    dispatchWheel(hostEl, { deltaX: 0, deltaY: V - 5 });
    expect(host.pageNav).toEqual([]);
    expect(host.chromeIntent).toEqual([]);
  });

  it('acts on the dominant axis only for a diagonal wheel', () => {
    init();
    dispatchWheel(hostEl, { deltaX: H + 20, deltaY: V + 1 });
    expect(host.pageNav).toEqual(['next']);
    expect(host.chromeIntent).toEqual([]);
  });

  it('does not navigate when navEnabled is false, but still blocks browser history', () => {
    host.navEnabled = false;
    init();
    const ev = dispatchWheel(hostEl, { deltaX: H + 5, deltaY: 0 });
    expect(host.pageNav).toEqual([]);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('ignores all wheel input while suspended', () => {
    host.suspended = true;
    init();
    const ev = dispatchWheel(hostEl, { deltaX: H + 5, deltaY: 0 });
    expect(host.pageNav).toEqual([]);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('applies a cooldown so inertial scroll flips only one page', () => {
    init();
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1000);
    dispatchWheel(hostEl, { deltaX: H + 5, deltaY: 0 });
    nowSpy.mockReturnValue(1000 + SCROLL_NAV_COOLDOWN_MS - 1);
    const ev = dispatchWheel(hostEl, { deltaX: H + 5, deltaY: 0 });
    expect(host.pageNav).toEqual(['next']);
    expect(ev.defaultPrevented).toBe(true);
    nowSpy.mockReturnValue(1000 + SCROLL_NAV_COOLDOWN_MS);
    dispatchWheel(hostEl, { deltaX: H + 5, deltaY: 0 });
    expect(host.pageNav).toEqual(['next', 'next']);
  });

  it('normalises line-mode deltas to pixels', () => {
    init();
    dispatchWheel(hostEl, { deltaX: 3, deltaY: 0, deltaMode: 1 });
    expect(host.pageNav).toEqual(['next']);
  });

  it('yields vertical wheel to a scrollable widget under the pointer', () => {
    init();
    const child = hostEl.querySelector('.child') as HTMLElement;
    child.style.overflowY = 'auto';
    Object.defineProperty(child, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(child, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(child, 'scrollTop', { value: 0, configurable: true });
    dispatchWheel(child, { deltaX: 0, deltaY: V + 5 });
    expect(host.chromeIntent).toEqual([]);
  });
});
