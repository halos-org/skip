import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { GroupWidgetComponent } from './group-widget.component';
import { DashboardService } from '../../services/dashboard.service';

describe('GroupWidgetComponent', () => {
  let component: GroupWidgetComponent;
  let fixture: ComponentFixture<GroupWidgetComponent>;
  let dashboard: {
    isDashboardStatic: ReturnType<typeof signal<boolean>>;
    deleteWidget: ReturnType<typeof vi.fn>;
    duplicateWidget: ReturnType<typeof vi.fn>;
    copyWidget: ReturnType<typeof vi.fn>;
    cutWidget: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    dashboard = {
      isDashboardStatic: signal(false),
      deleteWidget: vi.fn(),
      duplicateWidget: vi.fn(),
      copyWidget: vi.fn(),
      cutWidget: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [GroupWidgetComponent],
      providers: [{ provide: DashboardService, useValue: dashboard }],
    })
    .compileComponents();

    fixture = TestBed.createComponent(GroupWidgetComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('widgetProperties', {
      uuid: 'group-widget-test',
      type: 'group-widget',
      config: {}
    });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('routes the Delete action to the dashboard service', () => {
    (component as unknown as { onWidgetAction: (id: string) => void }).onWidgetAction('delete');
    expect(dashboard.deleteWidget).toHaveBeenCalledWith('group-widget-test');
  });

  it('routes Duplicate / Copy / Cut actions to the dashboard service', () => {
    const api = component as unknown as { onWidgetAction: (id: string) => void };
    api.onWidgetAction('duplicate');
    api.onWidgetAction('copy');
    api.onWidgetAction('cut');
    expect(dashboard.duplicateWidget).toHaveBeenCalledWith('group-widget-test');
    expect(dashboard.copyWidget).toHaveBeenCalledWith('group-widget-test');
    expect(dashboard.cutWidget).toHaveBeenCalledWith('group-widget-test');
  });
});
