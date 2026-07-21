import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageManagerBottomSheetComponent } from './page-manager-bottom-sheet.component';
import { Dashboard, DashboardService } from '../../services/dashboard.service';
import { DialogService } from '../../services/dialog.service';
import { uiEventService } from '../../services/uiEvent.service';
import { ensureTestIconsReady } from '../../../../test-helpers/icon-test-utils';

describe('PageManagerBottomSheetComponent', () => {
  let component: PageManagerBottomSheetComponent;
  let fixture: ComponentFixture<PageManagerBottomSheetComponent>;
  const bottomSheetRef = { dismiss: vi.fn() };
  const dashboard = {
    dashboards: signal<Dashboard[]>([{ id: 'a', name: 'Nav', icon: 'ic', configuration: [] }]),
    activeDashboard: signal(0)
  };

  beforeEach(async () => {
    bottomSheetRef.dismiss.mockClear();
    await TestBed.configureTestingModule({
      imports: [PageManagerBottomSheetComponent],
      providers: [
        { provide: MatBottomSheetRef, useValue: bottomSheetRef },
        { provide: DashboardService, useValue: dashboard },
        { provide: DialogService, useValue: { openDashboardPageEditorDialog: vi.fn(), openConfirmationDialog: vi.fn() } },
        { provide: uiEventService, useValue: { isDragging: signal(false) } }
      ]
    }).compileComponents();

    ensureTestIconsReady();
    fixture = TestBed.createComponent(PageManagerBottomSheetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('embeds the page editor in its compact layout', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('dashboards-editor')).not.toBeNull();
    expect(el.querySelector('.dashboard-manage.compact')).not.toBeNull();
  });

  it('dismisses the sheet when closed', () => {
    (component as unknown as { close: () => void }).close();
    expect(bottomSheetRef.dismiss).toHaveBeenCalled();
  });
});
