import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { signal } from '@angular/core';
import { AppComponent } from './app.component';
import { ConnectionState, IConnectionStatus } from './core/services/connection-state-machine.service';
import { AppNetworkInitService } from './core/services/app-initNetwork.service';
import { DashboardService } from './core/services/dashboard.service';
import { uiEventService } from './core/services/uiEvent.service';
import { AppService } from './core/services/app-service';
import { ChromeVisibilityService } from './core/services/chrome-visibility.service';
import { ToastService } from './core/services/toast.service';
import { ReloadService } from './core/services/reload.service';

// Access the component's private surface without widening the class API.
interface AppComponentHotkeyApi {
  dashboardVisible: { set: (v: boolean) => void };
  handleKeyDown: (key: string, event: { shiftKey: boolean }) => void;
  onShellPointerDown: (event: { target: { closest: (sel: string) => unknown } }) => void;
}

interface AppComponentNotifyApi {
  displayConnectionsStatusNotification: (status: IConnectionStatus) => void;
}

describe('AppComponent', () => {
  const appNetworkInitServiceStub = {
    bootstrapStatus$: new BehaviorSubject<'starting' | 'ready' | 'degraded'>('ready'),
    bootstrapIssue$: new BehaviorSubject({ reason: 'none' }),
  };

  let dashboard: {
    isDashboardStatic: ReturnType<typeof signal<boolean>>;
    activeDashboard: ReturnType<typeof signal<number | null>>;
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
  let chrome: {
    revealed: ReturnType<typeof signal<boolean>>;
    reveal: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    pulsePeek: ReturnType<typeof vi.fn>;
  };
  let toast: { show: ReturnType<typeof vi.fn> };
  let reloadService: { reload: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dashboard = {
      isDashboardStatic: signal(true),
      activeDashboard: signal<number | null>(null),
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
    chrome = { revealed: signal(false), reveal: vi.fn(), hide: vi.fn(), pulsePeek: vi.fn() };
    toast = { show: vi.fn().mockReturnValue({ onAction: () => new Subject() }) };
    reloadService = { reload: vi.fn() };
    appNetworkInitServiceStub.bootstrapIssue$.next({ reason: 'none' });
    appNetworkInitServiceStub.bootstrapStatus$.next('ready');

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: AppNetworkInitService, useValue: appNetworkInitServiceStub },
        { provide: DashboardService, useValue: dashboard },
        { provide: uiEventService, useValue: uiEvent },
        { provide: AppService, useValue: appService },
        { provide: ChromeVisibilityService, useValue: chrome },
        { provide: ToastService, useValue: toast },
        { provide: ReloadService, useValue: reloadService },
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

  describe('bootstrap recovery toast (#190)', () => {
    it('offers a persistent Retry toast when the server is unreachable at bootstrap', () => {
      create();
      toast.show.mockClear();
      appNetworkInitServiceStub.bootstrapIssue$.next({ reason: 'network-unreachable' });
      TestBed.tick();

      expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('Cannot reach'), 0, true, 'warn', 'Retry');
    });

    it('offers a Retry toast on an unknown bootstrap failure', () => {
      create();
      toast.show.mockClear();
      appNetworkInitServiceStub.bootstrapIssue$.next({ reason: 'unknown' });
      TestBed.tick();

      expect(toast.show).toHaveBeenCalledWith(expect.any(String), 0, true, 'warn', 'Retry');
    });

    it('does not show the recovery toast on a clean bootstrap', () => {
      create();
      toast.show.mockClear();
      TestBed.tick();

      expect(toast.show).not.toHaveBeenCalledWith(expect.any(String), 0, true, 'warn', 'Retry');
    });

    it('routes Retry through the reachability-gated reload seam', () => {
      const action$ = new Subject<void>();
      toast.show.mockReturnValue({ onAction: () => action$ });
      create();
      appNetworkInitServiceStub.bootstrapIssue$.next({ reason: 'network-unreachable' });
      TestBed.tick();
      action$.next();

      expect(reloadService.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('connection status notifications', () => {
    // Exercised through the private handler directly: mapping IConnectionStatus.state to the right
    // toast is the behavior under test, and driving it through the real root ConnectionStateMachine
    // would hinge on its retry timers and debounce. bootstrapStatus is 'ready', so
    // silentDuringBootstrap is false.
    function notify(state: ConnectionState, message = 'status message'): void {
      const app = create() as unknown as AppComponentNotifyApi;
      toast.show.mockClear();
      app.displayConnectionsStatusNotification({ state, message, timestamp: new Date() });
    }

    it('shows a transient toast when disconnected', () => {
      notify(ConnectionState.Disconnected, 'Not connected');
      expect(toast.show).toHaveBeenCalledWith('Not connected', 5000, true);
    });

    it('warns while retrying the connection', () => {
      notify(ConnectionState.WebSocketRetrying, 'Retrying');
      expect(toast.show).toHaveBeenCalledWith('Retrying', 3000, false, 'warn');
    });

    it('shows a persistent toast on permanent failure', () => {
      notify(ConnectionState.PermanentFailure, 'Gave up');
      expect(toast.show).toHaveBeenCalledWith('Gave up', 0, false);
    });

    it('stays silent while connecting or connected', () => {
      notify(ConnectionState.Connected, 'Connected');
      expect(toast.show).not.toHaveBeenCalled();
    });

    it('silences the warn and permanent-failure toasts while the app is still bootstrapping', () => {
      appNetworkInitServiceStub.bootstrapStatus$.next('starting');
      const app = create() as unknown as AppComponentNotifyApi;
      TestBed.tick();
      toast.show.mockClear();

      app.displayConnectionsStatusNotification({ state: ConnectionState.WebSocketRetrying, message: 'Retrying', timestamp: new Date() });
      expect(toast.show).toHaveBeenCalledWith('Retrying', 3000, true, 'warn');

      toast.show.mockClear();
      app.displayConnectionsStatusNotification({ state: ConnectionState.PermanentFailure, message: 'Gave up', timestamp: new Date() });
      expect(toast.show).toHaveBeenCalledWith('Gave up', 0, true);
    });

    it('reports an unrecognized state as an error toast', () => {
      const app = create() as unknown as AppComponentNotifyApi;
      toast.show.mockClear();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      app.displayConnectionsStatusNotification({ state: 'Bogus' as ConnectionState, message: 'weird', timestamp: new Date() });
      expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('Unknown connection status'), 0, false, 'error');
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
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

  describe('page-change toolbar reveal', () => {
    it('reveals the toolbar when the active page changes', () => {
      const fixture = TestBed.createComponent(AppComponent);
      fixture.detectChanges();
      chrome.reveal.mockClear();

      dashboard.activeDashboard.set(1);
      fixture.detectChanges();

      expect(chrome.reveal).toHaveBeenCalledTimes(1);
    });

    it('reveals again on each subsequent page change', () => {
      const fixture = TestBed.createComponent(AppComponent);
      fixture.detectChanges();
      dashboard.activeDashboard.set(1);
      fixture.detectChanges();
      chrome.reveal.mockClear();

      dashboard.activeDashboard.set(2);
      fixture.detectChanges();

      expect(chrome.reveal).toHaveBeenCalledTimes(1);
    });

    it('does not reveal on a transition to no active page', () => {
      const fixture = TestBed.createComponent(AppComponent);
      fixture.detectChanges();
      dashboard.activeDashboard.set(1);
      fixture.detectChanges();
      chrome.reveal.mockClear();

      dashboard.activeDashboard.set(null);
      fixture.detectChanges();

      expect(chrome.reveal).not.toHaveBeenCalled();
    });
  });

  describe('press-outside dismissal', () => {
    const outside = { target: { closest: () => null } };
    const onToolbar = { target: { closest: (sel: string) => (sel === 'app-toolbar' ? {} : null) } };

    it('dismisses the shown toolbar on a press outside it', () => {
      const app = create();
      chrome.revealed.set(true);
      app.onShellPointerDown(outside);
      expect(chrome.hide).toHaveBeenCalledTimes(1);
      expect(chrome.pulsePeek).not.toHaveBeenCalled();
    });

    it('flashes the peek on a press outside while the toolbar is hidden', () => {
      const app = create();
      chrome.revealed.set(false);
      app.onShellPointerDown(outside);
      expect(chrome.pulsePeek).toHaveBeenCalledTimes(1);
      expect(chrome.hide).not.toHaveBeenCalled();
    });

    it('ignores presses on the toolbar itself', () => {
      const app = create();
      chrome.revealed.set(true);
      app.onShellPointerDown(onToolbar);
      expect(chrome.hide).not.toHaveBeenCalled();
      expect(chrome.pulsePeek).not.toHaveBeenCalled();
    });
  });
});
