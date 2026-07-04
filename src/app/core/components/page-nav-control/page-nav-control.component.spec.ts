import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard, DashboardService } from '../../services/dashboard.service';
import { PageNavControlComponent } from './page-nav-control.component';

describe('PageNavControlComponent', () => {
  let fixture: ComponentFixture<PageNavControlComponent>;
  const dashboards = signal<Dashboard[]>([]);
  const activeDashboard = signal<number | null>(null);
  const navigateTo = vi.fn<(index: number) => void>();

  beforeEach(() => {
    dashboards.set([
      { id: 'a', name: 'Nav', icon: 'ic-nav' },
      { id: 'b', name: 'Engine', icon: 'ic-engine' },
      { id: 'c' },
    ]);
    activeDashboard.set(1);
    navigateTo.mockClear();

    const stub = { dashboards, activeDashboard, navigateTo } as unknown as DashboardService;
    TestBed.configureTestingModule({
      imports: [PageNavControlComponent],
      providers: [{ provide: DashboardService, useValue: stub }],
    });
    fixture = TestBed.createComponent(PageNavControlComponent);
    fixture.detectChanges();
  });

  function tiles(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('tile-large-icon'));
  }

  // aria-current lives on the focusable inner control, not the tile host, so it
  // is announced when a screen-reader user focuses the page.
  function tileButton(index: number): HTMLElement {
    return tiles()[index].querySelector('[role="button"]') as HTMLElement;
  }

  it('renders one icon per page', () => {
    expect(tiles().length).toBe(3);
  });

  it('marks the active page with aria-current', () => {
    expect(fixture.nativeElement.querySelectorAll('[aria-current="page"]').length).toBe(1);
    expect(tileButton(1).getAttribute('aria-current')).toBe('page');
  });

  it('labels a page without a name using a Page N fallback', () => {
    expect(tiles()[2].getAttribute('aria-label')).toBe('Page 3');
  });

  it('navigates by index when a page icon is tapped', () => {
    tiles()[0].click();
    expect(navigateTo).toHaveBeenCalledWith(0);
    tiles()[2].click();
    expect(navigateTo).toHaveBeenCalledWith(2);
  });

  it('reflects the active index reactively', () => {
    activeDashboard.set(0);
    fixture.detectChanges();
    expect(tileButton(0).getAttribute('aria-current')).toBe('page');
    expect(tileButton(1).getAttribute('aria-current')).toBeNull();
  });
});
