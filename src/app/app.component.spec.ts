import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { signal } from '@angular/core';
import { AppComponent } from './app.component';
import { AppNetworkInitService } from './core/services/app-initNetwork.service';
import { DashboardService } from './core/services/dashboard.service';
import { uiEventService } from './core/services/uiEvent.service';
import { AppService } from './core/services/app-service';

// Access the component's private hotkey surface without widening the class API.
interface AppComponentHotkeyApi {
  dashboardVisible: { set: (v: boolean) => void };
  handleKeyDown: (key: string, event: { shiftKey: boolean }) => void;
}

describe('AppComponent', () => {
  const appNetworkInitServiceStub = {
    bootstrapStatus$: new BehaviorSubject<'starting' | 'ready' | 'degraded'>('ready'),
    bootstrapIssue$: new BehaviorSubject({ reason: 'none' }),
  };

  let dashboard: {
    isDashboardStatic: ReturnType<typeof signal<boolean>>;
    activeDashboard: ReturnType<typeof signal<number>>;
    dashboards: ReturnType<typeof signal<unknown[]>>;
    navigateToNextDashboard: ReturnType<typeof vi.fn>;
    navigateToPreviousDashboard: ReturnType<typeof vi.fn>;
    setStaticDashboard: ReturnType<typeof vi.fn>;
    widgetAction$: Subject<unknown>;
  };
  let uiEvent: {
    isDragging: ReturnType<typeof signal<boolean>>;
    addHotkeyListener: ReturnType<typeof vi.fn>;
    removeHotkeyListener: ReturnType<typeof vi.fn>;
    toggleFullScreen: ReturnType<typeof vi.fn>;
  };
  let appService: { toggleNightMode: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dashboard = {
      isDashboardStatic: signal(true),
      activeDashboard: signal(0),
      dashboards: signal([]),
      navigateToNextDashboard: vi.fn(),
      navigateToPreviousDashboard: vi.fn(),
      setStaticDashboard: vi.fn(),
      widgetAction$: new Subject(),
    };
    uiEvent = {
      isDragging: signal(false),
      addHotkeyListener: vi.fn(),
      removeHotkeyListener: vi.fn(),
      toggleFullScreen: vi.fn(),
    };
    appService = { toggleNightMode: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: AppNetworkInitService, useValue: appNetworkInitServiceStub },
        { provide: DashboardService, useValue: dashboard },
        { provide: uiEventService, useValue: uiEvent },
        { provide: AppService, useValue: appService },
      ],
    }).compileComponents();
  });

  function create(): AppComponentHotkeyApi {
    const fixture = TestBed.createComponent(AppComponent);
    return fixture.componentInstance as unknown as AppComponentHotkeyApi;
  }

  it('should create the app', () => {
    expect(create()).toBeTruthy();
  });

  describe('consolidated hotkeys', () => {
    it('Ctrl+Arrow navigates pages when static, visible and not dragging', () => {
      const app = create();
      app.dashboardVisible.set(true);
      app.handleKeyDown('arrowright', { shiftKey: false });
      app.handleKeyDown('arrowleft', { shiftKey: false });
      expect(dashboard.navigateToNextDashboard).toHaveBeenCalledTimes(1);
      expect(dashboard.navigateToPreviousDashboard).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Shift+Arrow does not navigate (Shift is reserved for actions)', () => {
      const app = create();
      app.dashboardVisible.set(true);
      app.handleKeyDown('arrowright', { shiftKey: true });
      expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
    });

    it('page nav is a no-op while the dashboard is unlocked (edit mode)', () => {
      const app = create();
      app.dashboardVisible.set(true);
      dashboard.isDashboardStatic.set(false);
      app.handleKeyDown('arrowright', { shiftKey: false });
      expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
    });

    it('page nav is a no-op off a dashboard route', () => {
      const app = create();
      app.dashboardVisible.set(false);
      app.handleKeyDown('arrowright', { shiftKey: false });
      expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
    });

    it('Ctrl+Shift+E/F/N trigger edit / fullscreen / night; the unshifted keys do not', () => {
      const app = create();
      app.handleKeyDown('e', { shiftKey: true });
      app.handleKeyDown('f', { shiftKey: true });
      app.handleKeyDown('n', { shiftKey: true });
      expect(dashboard.setStaticDashboard).toHaveBeenCalledWith(false);
      expect(uiEvent.toggleFullScreen).toHaveBeenCalledTimes(1);
      expect(appService.toggleNightMode).toHaveBeenCalledTimes(1);

      app.handleKeyDown('e', { shiftKey: false });
      app.handleKeyDown('f', { shiftKey: false });
      app.handleKeyDown('n', { shiftKey: false });
      expect(dashboard.setStaticDashboard).toHaveBeenCalledTimes(1);
      expect(uiEvent.toggleFullScreen).toHaveBeenCalledTimes(1);
      expect(appService.toggleNightMode).toHaveBeenCalledTimes(1);
    });
  });
});
