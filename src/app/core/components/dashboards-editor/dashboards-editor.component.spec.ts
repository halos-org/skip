import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { DashboardsEditorComponent } from './dashboards-editor.component';
import { ActionMenuComponent } from '../action-menu/action-menu.component';
import { Dashboard, DashboardService } from '../../services/dashboard.service';
import { DialogService } from '../../services/dialog.service';
import { uiEventService } from '../../services/uiEvent.service';

const pages: Dashboard[] = [
  { id: 'a', name: 'Sailing', icon: 'dashboard-sailing', configuration: [] },
  { id: 'b', name: 'Engine', icon: 'dashboard-engine', configuration: [] }
];

describe('DashboardsEditorComponent', () => {
  let component: DashboardsEditorComponent;
  let fixture: ComponentFixture<DashboardsEditorComponent>;
  let dashboard: {
    dashboards: ReturnType<typeof signal<Dashboard[]>>;
    activeDashboard: ReturnType<typeof signal<number | null>>;
    delete: ReturnType<typeof vi.fn>;
    duplicate: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
  };
  let dialog: {
    openDashboardPageEditorDialog: ReturnType<typeof vi.fn>;
    openConfirmationDialog: ReturnType<typeof vi.fn>;
  };
  let confirm$: Subject<boolean>;
  /** Result the (mocked) page-editor dialog emits on close; null = cancelled. */
  let editorResult: { name: string; icon: string } | null;
  let open: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    editorResult = null;
    dashboard = {
      dashboards: signal<Dashboard[]>([...pages]),
      activeDashboard: signal<number | null>(0),
      delete: vi.fn(),
      duplicate: vi.fn(),
      update: vi.fn(),
      add: vi.fn()
    };
    confirm$ = new Subject<boolean>();
    dialog = {
      openDashboardPageEditorDialog: vi.fn(() => ({ afterClosed: () => of(editorResult) })),
      openConfirmationDialog: vi.fn(() => confirm$)
    };
    // Isolate the editor's routing logic from the real menu overlay (and stop
    // CDK overlays leaking across tests).
    open = vi.spyOn(ActionMenuComponent.prototype, 'open').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [DashboardsEditorComponent],
      providers: [
        { provide: DashboardService, useValue: dashboard },
        { provide: DialogService, useValue: dialog },
        { provide: uiEventService, useValue: { isDragging: signal(false) } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardsEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  const call = (name: string, ...args: unknown[]) =>
    (component as unknown as Record<string, (...a: unknown[]) => void>)[name](...args);
  // The row body binds a native (click), so onTileTap receives a real MouseEvent.
  const clickAt = (pt: { x: number; y: number }) => ({ clientX: pt.x, clientY: pt.y });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('offers exactly the edit, duplicate and delete actions', () => {
    const ids = (component as unknown as { pageActions: { id: string }[] }).pageActions.map(a => a.id);
    expect(ids).toEqual(['edit', 'duplicate', 'delete']);
  });

  it('opens the action menu at the tap point on a single tap', () => {
    call('onTileTap', 1, clickAt({ x: 42, y: 24 }));
    expect(open).toHaveBeenCalledWith(42, 24);
  });

  it('opens the action menu at the tile centre on keyboard activation', () => {
    const preventDefault = vi.fn();
    call('onTileKey', 0, {
      preventDefault,
      target: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }) }
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(60, 40);
  });

  it('routes the edit action to the page editor dialog and applies the result', () => {
    editorResult = { name: 'Sailing (renamed)', icon: 'dashboard-map' };
    call('onTileTap', 0, clickAt({ x: 0, y: 0 }));
    call('onPageAction', 'edit');
    expect(dialog.openDashboardPageEditorDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Page Options', name: 'Sailing' })
    );
    expect(dashboard.update).toHaveBeenCalledWith(0, 'Sailing (renamed)', 'dashboard-map');
  });

  it('routes the duplicate action and applies the result', () => {
    editorResult = { name: 'Engine copy', icon: 'dashboard-engine' };
    call('onTileTap', 1, clickAt({ x: 0, y: 0 }));
    call('onPageAction', 'duplicate');
    expect(dialog.openDashboardPageEditorDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Duplicate Page', name: 'Engine copy' })
    );
    expect(dashboard.duplicate).toHaveBeenCalledWith(1, 'Engine copy', 'dashboard-engine');
  });

  it('does not mutate when the editor dialog is cancelled', () => {
    editorResult = null;
    call('onTileTap', 0, clickAt({ x: 0, y: 0 }));
    call('onPageAction', 'edit');
    expect(dashboard.update).not.toHaveBeenCalled();
  });

  it('confirms before deleting and deletes only when confirmed', () => {
    call('onTileTap', 1, clickAt({ x: 0, y: 0 }));
    call('onPageAction', 'delete');
    expect(dialog.openConfirmationDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete Page', confirmBtnText: 'Delete' })
    );
    expect(dashboard.delete).not.toHaveBeenCalled();

    confirm$.next(true);
    expect(dashboard.delete).toHaveBeenCalledWith(1);
  });

  it('does not delete when the confirmation is cancelled', () => {
    call('onTileTap', 0, clickAt({ x: 0, y: 0 }));
    call('onPageAction', 'delete');
    confirm$.next(false);
    expect(dashboard.delete).not.toHaveBeenCalled();
  });

  it('ignores an action when no tile menu is open (stale index)', () => {
    call('onPageAction', 'delete');
    expect(dialog.openConfirmationDialog).not.toHaveBeenCalled();
    expect(dashboard.delete).not.toHaveBeenCalled();
  });

  it('renders a vertical list with one row per page plus the add control', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.page-list')).not.toBeNull();
    expect(el.querySelectorAll('.page-row').length).toBe(pages.length);
    // Each row reorders via its own drag handle, so vertical scrolling of the row
    // body is never captured as a drag.
    expect(el.querySelectorAll('.page-row .drag-handle').length).toBe(pages.length);
    expect(el.querySelector('.page-add')).not.toBeNull();
  });

  describe('drop() reorders pages and reindexes the active page', () => {
    const threePages = (): Dashboard[] => [
      { id: 'a', name: 'A', icon: '', configuration: [] },
      { id: 'b', name: 'B', icon: '', configuration: [] },
      { id: 'c', name: 'C', icon: '', configuration: [] }
    ];

    it('follows the active page when it is the one moved', () => {
      dashboard.dashboards.set(threePages());
      dashboard.activeDashboard.set(0); // A
      call('drop', { previousIndex: 0, currentIndex: 2 });
      expect(dashboard.dashboards().map(d => d.id)).toEqual(['b', 'c', 'a']);
      expect(dashboard.activeDashboard()).toBe(2);
    });

    it('decrements the active index when a page above it moves below it', () => {
      dashboard.dashboards.set(threePages());
      dashboard.activeDashboard.set(1); // B
      call('drop', { previousIndex: 0, currentIndex: 2 }); // A moves past B
      expect(dashboard.dashboards().map(d => d.id)).toEqual(['b', 'c', 'a']);
      expect(dashboard.activeDashboard()).toBe(0);
    });

    it('increments the active index when a page below it moves above it', () => {
      dashboard.dashboards.set(threePages());
      dashboard.activeDashboard.set(0); // A
      call('drop', { previousIndex: 2, currentIndex: 0 }); // C moves above A
      expect(dashboard.dashboards().map(d => d.id)).toEqual(['c', 'a', 'b']);
      expect(dashboard.activeDashboard()).toBe(1);
    });

    it('leaves the active index unchanged when the move does not span it', () => {
      dashboard.dashboards.set(threePages());
      dashboard.activeDashboard.set(2); // C
      call('drop', { previousIndex: 0, currentIndex: 1 }); // A/B swap
      expect(dashboard.dashboards().map(d => d.id)).toEqual(['b', 'a', 'c']);
      expect(dashboard.activeDashboard()).toBe(2);
    });
  });
});
