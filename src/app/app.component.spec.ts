import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { signal } from '@angular/core';
import { AppComponent } from './app.component';
import { ConnectionState, IConnectionStatus } from './core/services/connection-state-machine.service';
import { AppNetworkInitService } from './core/services/app-initNetwork.service';
import { DashboardService } from './core/services/dashboard.service';
import { uiEventService } from './core/services/uiEvent.service';
import { AppService } from './core/services/app-service';
import { ChromeVisibilityService } from './core/services/chrome-visibility.service';
import { EmbedModeService } from './core/services/embed-mode.service';
import { SettingsService } from './core/services/settings.service';
import { ConfigurationUpgradeService } from './core/services/configuration-upgrade.service';
import { StorageService } from './core/services/storage.service';
import { ToastService } from './core/services/toast.service';
import { ReloadService } from './core/services/reload.service';
import { ToolbarComponent } from './core/components/toolbar/toolbar.component';
import { IConfig } from './core/interfaces/app-settings.interfaces';
import { LATEST_APP_CONFIG_VERSION } from './core/constants/config-versions.const';

// A minimal stand-in for the KeyboardEvent fields the handler reads.
interface HotkeyTestEvent {
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
  preventDefault?: ReturnType<typeof vi.fn>;
}

// Access the component's private surface without widening the class API.
interface AppComponentHotkeyApi {
  dashboardVisible: { set: (v: boolean) => void };
  handleKeyDown: (key: string, event: HotkeyTestEvent) => void;
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

  describe('bare-key hotkeys', () => {
    function keyEvent(overrides: Partial<HotkeyTestEvent> = {}): HotkeyTestEvent {
      return {
        ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
        target: document.body, preventDefault: vi.fn(),
        ...overrides,
      };
    }

    it('bare arrows navigate pages when static, visible and not dragging, and preventDefault', () => {
      const app = create();
      app.dashboardVisible.set(true);
      const right = keyEvent();
      const left = keyEvent();
      app.handleKeyDown('arrowright', right);
      app.handleKeyDown('arrowleft', left);
      expect(dashboard.navigateToNextDashboard).toHaveBeenCalledTimes(1);
      expect(dashboard.navigateToPreviousDashboard).toHaveBeenCalledTimes(1);
      expect(right.preventDefault).toHaveBeenCalledTimes(1);
      expect(left.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('any modifier suppresses the hotkey (bare keys only)', () => {
      const app = create();
      app.dashboardVisible.set(true);
      app.handleKeyDown('arrowright', keyEvent({ ctrlKey: true }));
      app.handleKeyDown('arrowright', keyEvent({ shiftKey: true }));
      app.handleKeyDown('n', keyEvent({ metaKey: true }));
      app.handleKeyDown('f', keyEvent({ altKey: true }));
      expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
      expect(appService.toggleNightMode).not.toHaveBeenCalled();
      expect(uiEvent.toggleFullScreen).not.toHaveBeenCalled();
    });

    it('an editable / interactive focus target suppresses the hotkey and does not preventDefault', () => {
      const app = create();
      app.dashboardVisible.set(true);
      const input = document.createElement('input');
      const nightEv = keyEvent({ target: input });
      const arrowEv = keyEvent({ target: input });
      app.handleKeyDown('n', nightEv);
      app.handleKeyDown('arrowright', arrowEv);
      expect(appService.toggleNightMode).not.toHaveBeenCalled();
      expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
      expect(nightEv.preventDefault).not.toHaveBeenCalled();
      expect(arrowEv.preventDefault).not.toHaveBeenCalled();
    });

    it('page nav is a no-op — and does not preventDefault — while the dashboard is unlocked', () => {
      const app = create();
      app.dashboardVisible.set(true);
      dashboard.isDashboardStatic.set(false);
      const ev = keyEvent();
      app.handleKeyDown('arrowright', ev);
      expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
      expect(ev.preventDefault).not.toHaveBeenCalled();
    });

    it('page nav is a no-op off a dashboard route', () => {
      const app = create();
      app.dashboardVisible.set(false);
      app.handleKeyDown('arrowright', keyEvent());
      expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
    });

    it('bare e/f/n enter edit / toggle fullscreen / toggle night, and preventDefault', () => {
      const app = create();
      app.dashboardVisible.set(true);
      const e = keyEvent();
      const f = keyEvent();
      const n = keyEvent();
      app.handleKeyDown('e', e);
      app.handleKeyDown('f', f);
      app.handleKeyDown('n', n);
      expect(dashboard.setStaticDashboard).toHaveBeenCalledWith(false);
      expect(uiEvent.toggleFullScreen).toHaveBeenCalledTimes(1);
      expect(appService.toggleNightMode).toHaveBeenCalledTimes(1);
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
      expect(f.preventDefault).toHaveBeenCalledTimes(1);
      expect(n.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('bare e does not enter edit off a dashboard route', () => {
      const app = create();
      app.dashboardVisible.set(false);
      const e = keyEvent();
      app.handleKeyDown('e', e);
      expect(dashboard.setStaticDashboard).not.toHaveBeenCalled();
      expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('suppresses hotkeys while a modal overlay (dialog/menu/select) is open', () => {
      const app = create();
      app.dashboardVisible.set(true);
      const backdrop = document.createElement('div');
      backdrop.className = 'cdk-overlay-backdrop';
      document.body.appendChild(backdrop);
      try {
        const n = keyEvent();
        const right = keyEvent();
        app.handleKeyDown('n', n);
        app.handleKeyDown('arrowright', right);
        expect(appService.toggleNightMode).not.toHaveBeenCalled();
        expect(dashboard.navigateToNextDashboard).not.toHaveBeenCalled();
        expect(n.preventDefault).not.toHaveBeenCalled();
      } finally {
        backdrop.remove();
      }
    });

    it('registers the bare hotkey set with no modifier filter', () => {
      const app = create() as unknown as { ngAfterViewInit: () => void };
      app.ngAfterViewInit();
      expect(uiEvent.addHotkeyListener).toHaveBeenCalledWith(
        expect.any(Function),
        { keys: ['arrowleft', 'arrowright', 'e', 'f', 'n'] }
      );
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

// Self-contained (no shared beforeEach): the toolbar mount gate depends on the injected
// EmbedModeService, which the main suite does not stub. Under embed the toolbar is unmounted from
// the DOM entirely (not CSS-hidden). (#216 E6)
describe('AppComponent — embed mode chrome', () => {
  async function render(embed: boolean): Promise<ComponentFixture<AppComponent>> {
    const appNetworkInitServiceStub = {
      bootstrapStatus$: new BehaviorSubject<'starting' | 'ready' | 'degraded'>('ready'),
      bootstrapIssue$: new BehaviorSubject({ reason: 'none' }),
    };
    const dashboard = {
      isDashboardStatic: signal(true),
      activeDashboard: signal<number | null>(null),
      dashboards: signal<unknown[]>([]),
      navigateToNextDashboard: vi.fn(),
      navigateToPreviousDashboard: vi.fn(),
      setStaticDashboard: vi.fn(),
      widgetAction$: new Subject(),
    };
    const uiEvent = {
      isDragging: signal(false),
      addHotkeyListener: vi.fn(),
      removeHotkeyListener: vi.fn(),
      toggleFullScreen: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: AppNetworkInitService, useValue: appNetworkInitServiceStub },
        { provide: DashboardService, useValue: dashboard },
        { provide: uiEventService, useValue: uiEvent },
        { provide: AppService, useValue: { toggleNightMode: vi.fn() } },
        { provide: ChromeVisibilityService, useValue: { revealed: signal(false), reveal: vi.fn(), hide: vi.fn(), pulsePeek: vi.fn() } },
        { provide: ToastService, useValue: { show: vi.fn().mockReturnValue({ onAction: () => new Subject() }) } },
        { provide: ReloadService, useValue: { reload: vi.fn() } },
        { provide: EmbedModeService, useValue: { embed: () => embed, profile: () => null } },
      ],
    });
    // Stub the toolbar's template so the mount/unmount gate can be asserted without wiring the
    // toolbar's own heavy dependency tree; the `app-toolbar` host element still marks its presence.
    TestBed.overrideComponent(ToolbarComponent, { set: { template: '<span class="stub-toolbar"></span>', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    (fixture.componentInstance as unknown as { dashboardVisible: { set: (v: boolean) => void } }).dashboardVisible.set(true);
    fixture.detectChanges();
    return fixture;
  }

  it('unmounts the toolbar from the DOM under embed even on a visible dashboard', async () => {
    const fixture = await render(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-toolbar')).toBeNull();
  });

  it('mounts the toolbar on a visible dashboard when not embedded', async () => {
    const fixture = await render(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-toolbar')).not.toBeNull();
  });
});

// Self-contained: exercises the two constructor effects that must stand down under embed — the
// automatic v11/v12 config migration (writes every user slot + reloadApp), and the
// missing-shared-config 'Create' prompt (its action calls settings.resetSettings, a write). Wires the
// real root SettingsService / ConfigurationUpgradeService (spied) like the chrome suite, plus a
// toggleable EmbedModeService. (#216 E6)
describe('AppComponent — embed read-only invariants (#216 E6)', () => {
  async function render(opts: { embed: boolean; configUpgrade?: boolean; configVersion?: number }) {
    const bootstrapIssue$ = new BehaviorSubject<{ reason: string; sharedConfigName?: string }>({ reason: 'none' });
    const appNetworkInitServiceStub = {
      bootstrapStatus$: new BehaviorSubject<'starting' | 'ready' | 'degraded'>('ready'),
      bootstrapIssue$,
    };
    const dashboard = {
      isDashboardStatic: signal(true),
      activeDashboard: signal<number | null>(null),
      dashboards: signal<unknown[]>([]),
      navigateToNextDashboard: vi.fn(),
      navigateToPreviousDashboard: vi.fn(),
      setStaticDashboard: vi.fn(),
      widgetAction$: new Subject(),
    };
    const uiEvent = {
      isDragging: signal(false),
      addHotkeyListener: vi.fn(),
      removeHotkeyListener: vi.fn(),
      toggleFullScreen: vi.fn(),
    };
    const toast = { show: vi.fn().mockReturnValue({ onAction: () => new Subject() }) };

    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: AppNetworkInitService, useValue: appNetworkInitServiceStub },
        { provide: DashboardService, useValue: dashboard },
        { provide: uiEventService, useValue: uiEvent },
        { provide: AppService, useValue: { toggleNightMode: vi.fn() } },
        { provide: ChromeVisibilityService, useValue: { revealed: signal(false), reveal: vi.fn(), hide: vi.fn(), pulsePeek: vi.fn() } },
        { provide: ToastService, useValue: toast },
        { provide: ReloadService, useValue: { reload: vi.fn() } },
        { provide: EmbedModeService, useValue: { embed: () => opts.embed, profile: () => null } },
      ],
    });
    TestBed.overrideComponent(ToolbarComponent, { set: { template: '<span class="stub-toolbar"></span>', imports: [] } });
    await TestBed.compileComponents();

    // Drive the constructor effects deterministically through the real root services the component
    // injects: force an upgradeable version and spy the write actions so nothing actually persists.
    const settings = TestBed.inject(SettingsService);
    const upgrade = TestBed.inject(ConfigurationUpgradeService);
    const runUpgradeSpy = vi.spyOn(upgrade, 'runUpgrade').mockResolvedValue(undefined);
    vi.spyOn(settings, 'getConfigVersion').mockReturnValue(opts.configVersion);
    vi.spyOn(settings, 'resetSettings').mockImplementation(() => undefined);
    settings.configUpgrade.set(opts.configUpgrade ?? false);

    const fixture = TestBed.createComponent(AppComponent);
    (fixture.componentInstance as unknown as { dashboardVisible: { set: (v: boolean) => void } }).dashboardVisible.set(true);
    fixture.detectChanges();
    return { toast, runUpgradeSpy, bootstrapIssue$ };
  }

  afterEach(() => vi.restoreAllMocks());

  it('does NOT run the config migration under embed even with an upgradeable v11/v12 config', async () => {
    const { runUpgradeSpy } = await render({ embed: true, configUpgrade: true, configVersion: 11 });
    expect(runUpgradeSpy).not.toHaveBeenCalled();
  });

  it('runs the config migration in the full app (not embed) for an upgradeable v11/v12 config', async () => {
    const { runUpgradeSpy } = await render({ embed: false, configUpgrade: true, configVersion: 12 });
    expect(runUpgradeSpy).toHaveBeenCalledWith(12);
  });

  it('runs the config migration in the full app for an upgradeable v13 config (the S2-0 gate)', async () => {
    const { runUpgradeSpy } = await render({ embed: false, configUpgrade: true, configVersion: 13 });
    expect(runUpgradeSpy).toHaveBeenCalledWith(13);
  });

  it('does NOT show the missing-shared-config create prompt under embed', async () => {
    const { toast, bootstrapIssue$ } = await render({ embed: true });
    toast.show.mockClear();
    bootstrapIssue$.next({ reason: 'missing-shared-config', sharedConfigName: 'default' });
    TestBed.tick();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('shows the missing-shared-config create prompt in the full app (not embed)', async () => {
    const { toast, bootstrapIssue$ } = await render({ embed: false });
    toast.show.mockClear();
    bootstrapIssue$.next({ reason: 'missing-shared-config', sharedConfigName: 'default' });
    TestBed.tick();
    expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('no shared configuration'), 0, true, 'warn', 'Create');
  });
});

// The whole-boot read-only invariant: an embed boot must issue ZERO server-config writes, even from a
// config that would normally self-heal. Drives the real root SettingsService + DashboardService +
// StorageService (only EmbedModeService and the component's UI collaborators are faked), boots a config
// that triggers BOTH boot-time self-heals (empty dashboards → DefaultDashboard seed + write-back;
// missing night-mode fields → pushSettings persist-on-missing), and counts patchConfig/setConfig. (#216 E6)
describe('AppComponent — embed boot performs zero server-config writes (#216 E6)', () => {
  async function bootAndCountWrites(embed: boolean) {
    const appNetworkInitServiceStub = {
      bootstrapStatus$: new BehaviorSubject<'starting' | 'ready' | 'degraded'>('ready'),
      bootstrapIssue$: new BehaviorSubject({ reason: 'none' }),
    };
    const uiEvent = {
      isDragging: signal(false),
      addHotkeyListener: vi.fn(),
      removeHotkeyListener: vi.fn(),
      toggleFullScreen: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: AppNetworkInitService, useValue: appNetworkInitServiceStub },
        { provide: uiEventService, useValue: uiEvent },
        { provide: AppService, useValue: { toggleNightMode: vi.fn() } },
        { provide: ChromeVisibilityService, useValue: { revealed: signal(false), reveal: vi.fn(), hide: vi.fn(), pulsePeek: vi.fn() } },
        { provide: ToastService, useValue: { show: vi.fn().mockReturnValue({ onAction: () => new Subject() }) } },
        { provide: ReloadService, useValue: { reload: vi.fn() } },
        { provide: EmbedModeService, useValue: { embed: () => embed, profile: () => null } },
        // DashboardService, SettingsService, StorageService and ConfigurationUpgradeService are left as
        // their real root instances so the boot self-heals actually run (or are gated) end to end.
      ],
    });
    TestBed.overrideComponent(ToolbarComponent, { set: { template: '<span class="stub-toolbar"></span>', imports: [] } });
    await TestBed.compileComponents();

    // Bootstrap a config that would trigger both self-heals: empty dashboards AND missing night-mode
    // fields. configVersion is the latest so no config-upgrade write path is dragged in.
    const storage = TestBed.inject(StorageService);
    storage.bootstrapRemoteContext({
      sharedConfigName: 'profileA',
      configFileVersion: 11,
      initConfig: {
        app: {
          configVersion: LATEST_APP_CONFIG_VERSION,
          notificationConfig: {
            disableNotifications: false,
            menuGrouping: true,
            security: { disableSecurity: false },
            devices: { disableDevices: false, showNormalState: false, showNominalState: false },
            sound: { disableSound: false, muteNormal: false, muteNominal: false, muteWarn: false, muteAlert: false, muteAlarm: false, muteEmergency: false },
          },
        },
        theme: null,
        dashboards: []
      } as unknown as IConfig
    });
    storage.storageServiceReady$.next(true); // saveDashboards gates its write on readiness

    // Installed AFTER bootstrap so only the boot self-heal writes are counted, never the bootstrap.
    const patchSpy = vi.spyOn(storage, 'patchConfig').mockImplementation(() => undefined);
    const setSpy = vi.spyOn(storage, 'setConfig').mockResolvedValue(null);

    const fixture = TestBed.createComponent(AppComponent);
    (fixture.componentInstance as unknown as { dashboardVisible: { set: (v: boolean) => void } }).dashboardVisible.set(true);
    fixture.detectChanges();
    TestBed.tick();
    return { patchSpy, setSpy };
  }

  afterEach(() => vi.restoreAllMocks());

  it('writes NOTHING to the server config during an embed boot (both self-heals suppressed)', async () => {
    const { patchSpy, setSpy } = await bootAndCountWrites(true);
    expect(patchSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('the same boot NOT under embed DOES fire the self-heal writes (the guard is embed-specific)', async () => {
    const { patchSpy } = await bootAndCountWrites(false);
    expect(patchSpy).toHaveBeenCalled();
  });
});
