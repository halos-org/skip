import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';
import { ReloadService } from './reload.service';
import { ensureLocalStorage } from '../../../test-helpers/local-storage.test-helper';
import { DefaultAppConfig, DefaultConnectionConfig, DefaultThemeConfig } from '../../../default-config/config.blank.const';
import { IAppConfig, IConfig, IConnectionConfig, INotificationConfig, IThemeConfig } from '../interfaces/app-settings.interfaces';
import { LATEST_APP_CONFIG_VERSION, CONNECTION_CONFIG_VERSION } from '../constants/config-versions.const';
import { Dashboard } from './dashboard.service';

interface DefaultConfigGetters {
  getDefaultAppConfig(): IAppConfig;
  getDefaultConnectionConfig(): IConnectionConfig;
}

interface SeedOpts {
  sharedConfigName?: string;
  isRemoteControl?: boolean;
  instanceName?: string;
}

function seedConfig(opts: SeedOpts = {}): void {
  localStorage.setItem('authorization_token', JSON.stringify(null));
  localStorage.setItem('skip.connectionConfig', JSON.stringify({
    configVersion: 13,
    skipUUID: 'test-uuid',
    signalKUrl: 'https://boat.example:3443',
    proxyEnabled: false,
    signalKSubscribeAll: false,
    sharedConfigName: opts.sharedConfigName ?? 'profileA',
    isRemoteControl: opts.isRemoteControl ?? false,
    instanceName: opts.instanceName ?? ''
  }));
  localStorage.setItem('skip.appConfig', JSON.stringify({
    configVersion: 13,
    autoNightMode: false,
    redNightMode: false,
    nightModeBrightness: 1,
    notificationConfig: {
      disableNotifications: true,
      menuGrouping: false,
      security: { disableSecurity: true },
      devices: { disableDevices: true, showNormalState: false, showNominalState: false },
      sound: { disableSound: true, muteNormal: true, muteNominal: true, muteWarn: true, muteAlert: true, muteAlarm: true, muteEmergency: true }
    }
  }));
  localStorage.setItem('skip.dashboardsConfig', JSON.stringify([{ id: 'dash-1' }]));
  localStorage.setItem('skip.themeConfig', JSON.stringify({ themeName: 'light' }));
}

function seedConnectionConfig(extra: Record<string, unknown> = {}): void {
  localStorage.setItem('authorization_token', JSON.stringify(null));
  localStorage.setItem(
    'skip.connectionConfig',
    JSON.stringify({
      configVersion: 12,
      skipUUID: 'test-uuid',
      signalKUrl: 'http://localhost',
      proxyEnabled: false,
      signalKSubscribeAll: false,
      useDeviceToken: false,
      loginName: 'pi',
      sharedConfigName: 'default',
      ...extra
    })
  );
}

// Deliberately non-latest (LATEST_APP_CONFIG_VERSION is higher): the version-preservation pins
// below only mean something when the loaded version differs from the stamp-on-fallback value.
const LOADED_CONFIG_VERSION = 11;

function fullNotificationConfig(): INotificationConfig {
  return {
    disableNotifications: false,
    menuGrouping: true,
    security: { disableSecurity: false },
    devices: { disableDevices: false, showNormalState: true, showNominalState: true },
    sound: { disableSound: false, muteNormal: false, muteNominal: false, muteWarn: false, muteAlert: false, muteAlarm: false, muteEmergency: false }
  };
}

// A server-loaded profile app section with every hydrated field present; `omit` removes fields to
// exercise pushSettings' persist-on-missing bootstrap writes.
function loadedAppConfig(omit: string[] = []): Record<string, unknown> {
  const app: Record<string, unknown> = {
    configVersion: LOADED_CONFIG_VERSION,
    autoNightMode: true,
    redNightMode: true,
    nightModeBrightness: 0.65,
    notificationConfig: fullNotificationConfig(),
    browserTabTitle: 'My Boat'
  };
  for (const key of omit) delete app[key];
  return app;
}

interface HydratedInit {
  app: Record<string, unknown>;
  theme?: IThemeConfig | null;
  dashboards?: unknown;
}

// Boots the service through the real remote-bootstrap handoff (bootstrapRemoteContext) so the
// constructor's startup()/pushSettings() hydration runs against the given config. The patchConfig
// spy is installed BEFORE SettingsService is constructed: persist-on-missing writes fire during
// startup and would otherwise hit the network.
function setupHydrated(init: HydratedInit) {
  ensureLocalStorage();
  seedConfig({ sharedConfigName: 'profileA' });
  TestBed.configureTestingModule({ providers: [SettingsService, StorageService] });
  const storage = TestBed.inject(StorageService);
  storage.bootstrapRemoteContext({
    sharedConfigName: 'profileA',
    configFileVersion: 11,
    initConfig: { app: init.app, theme: init.theme ?? null, dashboards: init.dashboards } as unknown as IConfig
  });
  const patchSpy = vi.spyOn(storage, 'patchConfig').mockImplementation(() => undefined);
  const service = TestBed.inject(SettingsService);
  return { service, storage, patchSpy };
}

function createService(opts?: SeedOpts): SettingsService {
  // opts provided (profile suite): clear + seed inside. Omitted (credential/routing suites): the
  // describe's beforeEach already cleared and the test seeds via seedConnectionConfig first.
  if (opts) {
    ensureLocalStorage();
    seedConfig(opts);
  }
  // Provide both services in the module so transitive deps resolve to the global stubs
  // (AuthenticationService / SignalKConnectionService) rather than the real root services. The
  // ReloadService fake keeps the reconfigure/reset reload seam from firing a real reachability
  // probe (network fetch) during these tests; tests that care spy on its reload().
  TestBed.configureTestingModule({
    providers: [SettingsService, StorageService, { provide: ReloadService, useValue: { reload: () => Promise.resolve() } }]
  });
  return TestBed.inject(SettingsService);
}

describe('SettingsService — legacy credential purge', () => {
  beforeEach(() => ensureLocalStorage());

  it('getConnectionConfig() exposes no credential keys', () => {
    seedConnectionConfig();
    const cfg = createService().getConnectionConfig() as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(cfg, 'loginPassword')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(cfg, 'loginName')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(cfg, 'useDeviceToken')).toBe(false);
  });

  it('strips legacy credential fields on load, preserving other fields and without a version bump', () => {
    seedConnectionConfig({ loginPassword: 'plaintext-secret', loginName: 'captain', useDeviceToken: true });
    createService();
    const persisted = JSON.parse(localStorage.getItem('skip.connectionConfig') as string);
    expect(Object.prototype.hasOwnProperty.call(persisted, 'loginPassword')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(persisted, 'loginName')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(persisted, 'useDeviceToken')).toBe(false);
    // Non-legacy fields survive the targeted rewrite.
    expect(persisted.skipUUID).toBe('test-uuid');
    expect(persisted.sharedConfigName).toBe('default');
    expect(persisted.configVersion).toBe(12);
  });

  it('removes the orphaned authorization_token blob on load (a never-expiring device token)', () => {
    seedConnectionConfig();
    localStorage.setItem('authorization_token', JSON.stringify({ token: 'jwt', expiry: null, isDeviceAccessToken: true }));
    createService();
    expect(localStorage.getItem('authorization_token')).toBeNull();
  });
});

describe('SettingsService — storage routing (server applicationData only)', () => {
  beforeEach(() => ensureLocalStorage());

  // Skip runs same-origin with the SK server (SSO session), so config always persists to the
  // server's applicationData.
  function setup() {
    seedConnectionConfig();
    localStorage.setItem('skip.appConfig', JSON.stringify({ configVersion: 13, notificationConfig: {} }));
    localStorage.setItem('skip.dashboardsConfig', JSON.stringify([]));
    localStorage.setItem('skip.themeConfig', JSON.stringify({ themeName: '' }));
    TestBed.configureTestingModule({ providers: [SettingsService, StorageService] });
    const storage = TestBed.inject(StorageService);
    const patchSpy = vi.spyOn(storage, 'patchConfig').mockImplementation(() => undefined);
    const service = TestBed.inject(SettingsService);
    return { service, patchSpy };
  }

  it('routes a setting write to server applicationData, not localStorage', () => {
    const { service, patchSpy } = setup();
    localStorage.removeItem('skip.themeConfig');

    service.setThemeName('shared-theme');

    expect(patchSpy).toHaveBeenCalledWith('IThemeConfig', { themeName: 'shared-theme' });
    expect(localStorage.getItem('skip.themeConfig')).toBeNull();
  });

  it('setBrowserTabTitle routes to server applicationData like every other setter', () => {
    // Regression guard: setBrowserTabTitle must not diverge from the always-server invariant, or the
    // title would write to localStorage and be lost on the next (server-loaded) reload.
    const { service, patchSpy } = setup();
    localStorage.removeItem('skip.appConfig');

    service.setBrowserTabTitle('Helm');

    expect(patchSpy).toHaveBeenCalledWith('IAppConfig', expect.objectContaining({ browserTabTitle: 'Helm' }));
    expect(localStorage.getItem('skip.appConfig')).toBeNull();
  });
});

describe('SettingsService — config save failure reporting', () => {
  beforeEach(() => ensureLocalStorage());

  it('surfaces a snackbar when a routine config save to the server fails', async () => {
    const service = createService({ sharedConfigName: 'profileA' });
    const storage = TestBed.inject(StorageService);
    const http = TestBed.inject(HttpTestingController);
    const snack = TestBed.inject(MatSnackBar);
    const snackSpy = vi.spyOn(snack, 'open').mockImplementation(() => undefined as never);

    storage.storageServiceReady$.next(true);
    storage.activeConfigFileVersion = 11;
    storage.sharedConfigName = 'profileA';

    service.setThemeName('dark'); // fire-and-forget patchConfig write
    http.expectOne((r) => r.method === 'POST').flush('boom', { status: 500, statusText: 'err' });
    await Promise.resolve();

    expect(snackSpy).toHaveBeenCalled();
    http.verify();
  });

  it('does not raise the alarm toast for an expected read-only 401 save denial', async () => {
    const service = createService({ sharedConfigName: 'profileA' });
    const storage = TestBed.inject(StorageService);
    const http = TestBed.inject(HttpTestingController);
    const snack = TestBed.inject(MatSnackBar);
    const snackSpy = vi.spyOn(snack, 'open').mockImplementation(() => undefined as never);

    storage.storageServiceReady$.next(true);
    storage.activeConfigFileVersion = 11;
    storage.sharedConfigName = 'profileA';

    service.setThemeName('dark');
    http.expectOne((r) => r.method === 'POST').flush('denied', { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();

    expect(snackSpy).not.toHaveBeenCalled();
    http.verify();
  });
});

describe('SettingsService', () => {
  it('should be created', () => {
    expect(createService({})).toBeTruthy();
  });

  describe('active profile', () => {
    let service: SettingsService;

    beforeEach(() => {
      service = createService({ sharedConfigName: 'profileA' });
    });

    it('getActiveProfileName returns the booted slot name', () => {
      expect(service.getActiveProfileName()).toBe('profileA');
    });

    it('setActiveProfile updates the name and persists it to connectionConfig', () => {
      service.setActiveProfile('cockpit');
      expect(service.getActiveProfileName()).toBe('cockpit');
      const cc = JSON.parse(localStorage.getItem('skip.connectionConfig') as string);
      expect(cc.sharedConfigName).toBe('cockpit');
    });

    it('setActiveProfile keeps StorageService.sharedConfigName coherent', () => {
      const storage = TestBed.inject(StorageService);
      service.setActiveProfile('cockpit');
      expect(storage.sharedConfigName).toBe('cockpit');
    });
  });

  describe('remote-control identity (per-device, Unit 5)', () => {
    it('reads isRemoteControl / instanceName from connectionConfig at boot', () => {
      const service = createService({ isRemoteControl: true, instanceName: 'Helm' });
      expect(service.getIsRemoteControl()).toBe(true);
      expect(service.getInstanceName()).toBe('Helm');
    });

    it('setIsRemoteControl persists to connectionConfig, not the profile/appConfig', () => {
      const service = createService({ isRemoteControl: false });
      service.setIsRemoteControl(true);
      const cc = JSON.parse(localStorage.getItem('skip.connectionConfig') as string);
      expect(cc.isRemoteControl).toBe(true);
      const appConf = JSON.parse(localStorage.getItem('skip.appConfig') as string);
      expect(appConf.isRemoteControl).toBeUndefined();
    });

    it('setInstanceName persists to connectionConfig', () => {
      const service = createService({ instanceName: '' });
      service.setInstanceName('Mast');
      const cc = JSON.parse(localStorage.getItem('skip.connectionConfig') as string);
      expect(cc.instanceName).toBe('Mast');
    });

    it('switching the active profile leaves remote-control identity unchanged', () => {
      const service = createService({ isRemoteControl: true, instanceName: 'Helm' });
      service.setActiveProfile('cockpit');
      expect(service.getIsRemoteControl()).toBe(true);
      expect(service.getInstanceName()).toBe('Helm');
      const cc = JSON.parse(localStorage.getItem('skip.connectionConfig') as string);
      expect(cc.isRemoteControl).toBe(true);
      expect(cc.instanceName).toBe('Helm');
    });

    it('getAppConfig no longer carries remote-control fields', () => {
      const service = createService();
      const app = service.getAppConfig() as unknown as Record<string, unknown>;
      expect(app['isRemoteControl']).toBeUndefined();
      expect(app['instanceName']).toBeUndefined();
    });
  });
});

describe('SettingsService — default config isolation', () => {
  beforeEach(() => ensureLocalStorage());

  it('getDefaultAppConfig returns a fresh clone and never mutates the shared singleton', () => {
    const service = createService({}) as unknown as DefaultConfigGetters;
    // Capture the singleton's state up front rather than asserting an absolute value: other test
    // files share this module singleton and one (app-initNetwork) mutates it, so the invariant to
    // pin is that the getter itself leaves it unchanged, not what its value happens to be.
    const titleBefore = DefaultAppConfig.browserTabTitle;
    const notificationsBefore = DefaultAppConfig.notificationConfig.disableNotifications;

    const first = service.getDefaultAppConfig();
    first.browserTabTitle = 'mutated';
    first.notificationConfig.disableNotifications = !first.notificationConfig.disableNotifications;

    const second = service.getDefaultAppConfig();
    expect(second).not.toBe(first);
    expect(second.browserTabTitle).not.toBe('mutated');
    // Nested defaults are cloned too (different reference), and mutating a result never reaches the singleton.
    expect(first.notificationConfig).not.toBe(DefaultAppConfig.notificationConfig);
    expect(DefaultAppConfig.browserTabTitle).toBe(titleBefore);
    expect(DefaultAppConfig.notificationConfig.disableNotifications).toBe(notificationsBefore);
  });

  it('getDefaultConnectionConfig returns a fresh clone and never mutates the shared singleton', () => {
    const service = createService({}) as unknown as DefaultConfigGetters;
    const urlBefore = DefaultConnectionConfig.signalKUrl;
    const uuidBefore = DefaultConnectionConfig.skipUUID;

    const first = service.getDefaultConnectionConfig();
    first.sharedConfigName = 'mutated';
    first.signalKUrl = 'https://mutated.example';

    const second = service.getDefaultConnectionConfig();
    expect(second).not.toBe(first);
    expect(second.signalKUrl).not.toBe('https://mutated.example');
    // The getter clones, so mutating a returned result never reaches the shared singleton.
    expect(DefaultConnectionConfig.signalKUrl).toBe(urlBefore);
    expect(DefaultConnectionConfig.skipUUID).toBe(uuidBefore);
  });
});

describe('SettingsService — hydration (pushSettings) characterization', () => {
  const APP_CONFIG_KEYS = [
    'autoNightMode', 'browserTabTitle', 'configVersion',
    'nightModeBrightness', 'notificationConfig', 'redNightMode'
  ];

  it('a fully-populated loaded config hydrates state with zero bootstrap writes', () => {
    const { service, patchSpy } = setupHydrated({
      app: loadedAppConfig(),
      theme: { themeName: 'dark' },
      dashboards: [{ id: 'd1' }]
    });

    expect(patchSpy).not.toHaveBeenCalled();
    expect(service.getAutoNightMode()).toBe(true);
    expect(service.getRedNightMode()).toBe(true);
    expect(service.getNightModeBrightness()).toBe(0.65);
    expect(service.getBrowserTabTitle()).toBe('My Boat');
    expect(service.getThemeName()).toBe('dark');
    expect(service.getNotificationConfig()).toEqual(fullNotificationConfig());
    expect(service.getDashboardConfig()).toEqual([{ id: 'd1' }]);
    expect(service.getConfigVersion()).toBe(LOADED_CONFIG_VERSION);
  });

  // The persist-on-missing bootstrap fields: exactly these three (widgetHistoryDisabled was
  // removed by #157). A single missing field fires one whole-app patch built from fully-hydrated state;
  // `loaded` is that field's value in the DEFAULT_LOADED fixture, used to pin sibling preservation.
  const persistOnMissing: { field: string; bootstrapDefault: unknown; loaded: unknown; read: (s: SettingsService) => unknown }[] = [
    { field: 'autoNightMode', bootstrapDefault: false, loaded: true, read: (s) => s.getAutoNightMode() },
    { field: 'redNightMode', bootstrapDefault: false, loaded: true, read: (s) => s.getRedNightMode() },
    { field: 'nightModeBrightness', bootstrapDefault: 0.2, loaded: 0.65, read: (s) => s.getNightModeBrightness() }
  ];

  for (const { field, bootstrapDefault, read } of persistOnMissing) {
    it(`a loaded config missing ${field} fires one bootstrap patch carrying the default in a full IAppConfig blob`, () => {
      const { service, patchSpy } = setupHydrated({ app: loadedAppConfig([field]), theme: null, dashboards: [] });

      expect(patchSpy).toHaveBeenCalledTimes(1);
      const [objType, blob] = patchSpy.mock.calls[0];
      expect(objType).toBe('IAppConfig');
      expect(blob[field]).toBe(bootstrapDefault);
      // A whole-app blob (full IAppConfig shape), not a granular field patch...
      expect(Object.keys(blob).sort()).toEqual(APP_CONFIG_KEYS);
      // ...that preserves the loaded configVersion, with the already-hydrated fields riding along.
      expect(blob.configVersion).toBe(LOADED_CONFIG_VERSION);
      expect(blob.notificationConfig).toEqual(fullNotificationConfig());
      expect(read(service)).toBe(bootstrapDefault);
      // The write for THIS absent field must not revert a sibling (#170, symmetric across all three): every
      // other app-blob field rides along at its loaded value, not a pre-hydration default.
      for (const other of persistOnMissing) {
        if (other.field !== field) expect(blob[other.field]).toBe(other.loaded);
      }
      expect(blob.browserTabTitle).toBe('My Boat');
    });
  }

  it('all three persist-on-missing fields absent fire a single coalesced bootstrap patch', () => {
    const { patchSpy } = setupHydrated({
      app: loadedAppConfig(['autoNightMode', 'redNightMode', 'nightModeBrightness']),
      theme: null,
      dashboards: []
    });
    expect(patchSpy).toHaveBeenCalledTimes(1);
    const [objType, blob] = patchSpy.mock.calls[0];
    expect(objType).toBe('IAppConfig');
    expect(blob.autoNightMode).toBe(false);
    expect(blob.redNightMode).toBe(false);
    expect(blob.nightModeBrightness).toBe(0.2);
    expect(blob.browserTabTitle).toBe('My Boat');
  });

  it('a missing browserTabTitle defaults to "Skip" in memory WITHOUT a bootstrap write', () => {
    const { service, patchSpy } = setupHydrated({ app: loadedAppConfig(['browserTabTitle']), theme: null, dashboards: [] });
    expect(service.getBrowserTabTitle()).toBe('Skip');
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('a null loaded theme is not applied: the default (empty) theme name stays', () => {
    const { service, patchSpy } = setupHydrated({ app: loadedAppConfig(), theme: null, dashboards: [] });
    expect(service.getThemeName()).toBe('');
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('dashboards default to [] when the loaded config carries none', () => {
    const { service } = setupHydrated({ app: loadedAppConfig(), theme: null });
    expect(service.getDashboardConfig()).toEqual([]);
  });
});

describe('SettingsService — app-config version preservation on every write path', () => {
  it('whole-blob setters patch with the LOADED configVersion, never advancing it to latest', () => {
    // Guard: a latest-version seed would make these assertions vacuous.
    expect(LOADED_CONFIG_VERSION).not.toBe(LATEST_APP_CONFIG_VERSION);

    const { service, patchSpy } = setupHydrated({ app: loadedAppConfig(), theme: { themeName: 'dark' }, dashboards: [] });
    const writes: [string, () => void][] = [
      ['setAutoNightMode', () => service.setAutoNightMode(false)],
      ['setRedNightMode', () => service.setRedNightMode(false)],
      ['setNightModeBrightness', () => service.setNightModeBrightness(0.4)],
      ['setBrowserTabTitle', () => service.setBrowserTabTitle('Nav')]
    ];

    for (const [name, write] of writes) {
      patchSpy.mockClear();
      write();
      expect(patchSpy, name).toHaveBeenCalledTimes(1);
      const [objType, blob] = patchSpy.mock.calls[0];
      expect(objType, name).toBe('IAppConfig');
      expect(blob.configVersion, name).toBe(LOADED_CONFIG_VERSION);
    }
  });

  it('getAppConfig rebuilds the blob with the LOADED configVersion', () => {
    const { service } = setupHydrated({ app: loadedAppConfig(), theme: null, dashboards: [] });
    expect(service.getAppConfig().configVersion).toBe(LOADED_CONFIG_VERSION);
  });

  it('granular setters send only their own payload — no configVersion is stamped anywhere', () => {
    const { service, storage, patchSpy } = setupHydrated({ app: loadedAppConfig(), theme: null, dashboards: [] });
    storage.storageServiceReady$.next(true); // saveDashboards gates its patch on readiness

    const notif = fullNotificationConfig();
    service.setNotificationConfig(notif);
    expect(patchSpy).toHaveBeenLastCalledWith('INotificationConfig', notif);
    const notifPayload = patchSpy.mock.calls.at(-1)?.[1];
    expect(Object.prototype.hasOwnProperty.call(notifPayload, 'configVersion')).toBe(false);

    service.setThemeName('dusk');
    expect(patchSpy).toHaveBeenLastCalledWith('IThemeConfig', { themeName: 'dusk' });

    const dashboards = [{ id: 'd2' }] as unknown as Dashboard[];
    service.saveDashboards(dashboards);
    expect(patchSpy).toHaveBeenLastCalledWith('Dashboards', dashboards);
  });

  it('falls back to stamping LATEST_APP_CONFIG_VERSION only when no version was loaded', () => {
    // Un-hydrated boot (no remote bootstrap handoff): startup() bails before reading a version.
    const service = createService({});
    const storage = TestBed.inject(StorageService);
    const patchSpy = vi.spyOn(storage, 'patchConfig').mockImplementation(() => undefined);

    expect(service.getConfigVersion()).toBeUndefined();
    expect(service.getAppConfig().configVersion).toBe(LATEST_APP_CONFIG_VERSION);

    service.setBrowserTabTitle('Nav');
    const [, blob] = patchSpy.mock.calls[0];
    expect(blob.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
  });
});

describe('SettingsService — granular patch dispatch (end-to-end through StorageService)', () => {
  beforeEach(() => ensureLocalStorage());

  function setupLive() {
    const service = createService({ sharedConfigName: 'profileA' });
    const storage = TestBed.inject(StorageService);
    const http = TestBed.inject(HttpTestingController);
    storage.storageServiceReady$.next(true);
    storage.activeConfigFileVersion = 11;
    storage.sharedConfigName = 'profileA';
    return { service, http };
  }

  it('setNotificationConfig dispatches a JSON Patch replacing the profile app/notificationConfig sub-path', () => {
    const { service, http } = setupLive();

    service.setNotificationConfig(fullNotificationConfig());

    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual([{ op: 'replace', path: '/profileA/app/notificationConfig', value: fullNotificationConfig() }]);
    req.flush(null);
    expect(service.getNotificationConfig()).toEqual(fullNotificationConfig());
    http.verify();
  });
});

describe('SettingsService — resetSettings (characterization)', () => {
  beforeEach(() => { (window as unknown as Record<string, unknown>)['__SKIP_TEST__'] = true; });

  it('storage ready: replaces the active profile slot with the built defaults', () => {
    const service = createService({ sharedConfigName: 'profileA' });
    const storage = TestBed.inject(StorageService);
    storage.storageServiceReady$.next(true);
    const setSpy = vi.spyOn(storage, 'setConfig').mockResolvedValue(null);
    vi.spyOn(TestBed.inject(ReloadService), 'reload');

    service.resetSettings();

    expect(setSpy).toHaveBeenCalledTimes(1);
    const [scope, name, cfg] = setSpy.mock.calls[0];
    expect(scope).toBe('user');
    expect(name).toBe('profileA');
    expect(cfg.app).toEqual({ ...DefaultAppConfig });
    expect(cfg.theme).toEqual({ themeName: '' });
    expect(cfg.dashboards).toEqual([]);
  });

  it('storage ready: reloads only after the reset write resolves', async () => {
    const service = createService({ sharedConfigName: 'profileA' });
    const storage = TestBed.inject(StorageService);
    storage.storageServiceReady$.next(true);
    let resolveSave!: (value: unknown) => void;
    vi.spyOn(storage, 'setConfig').mockReturnValue(
      new Promise((resolve) => { resolveSave = resolve; })
    );
    const reloadSpy = vi.spyOn(TestBed.inject(ReloadService), 'reload');

    service.resetSettings();
    await Promise.resolve();

    expect(reloadSpy).not.toHaveBeenCalled();

    resolveSave(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('write rejection: surfaces the snackbar error and does not reload', async () => {
    const service = createService({ sharedConfigName: 'profileA' });
    const storage = TestBed.inject(StorageService);
    storage.storageServiceReady$.next(true);
    vi.spyOn(storage, 'setConfig').mockRejectedValue(new Error('network down'));
    const reloadSpy = vi.spyOn(TestBed.inject(ReloadService), 'reload');
    const snack = TestBed.inject(MatSnackBar);
    const snackSpy = vi.spyOn(snack, 'open').mockImplementation(() => undefined as never);

    service.resetSettings();
    await Promise.resolve();
    await Promise.resolve();

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(snackSpy).toHaveBeenCalled();
  });

  // The user asked for a reset and must learn it did not happen: storage-not-ready raises the
  // MatSnackBar error instead of silently doing nothing (issue #17, decision 5).
  it('storage NOT ready: surfaces a snackbar error — no write, no reload', () => {
    const service = createService({ sharedConfigName: 'profileA' });
    const storage = TestBed.inject(StorageService);
    storage.storageServiceReady$.next(false);
    const setSpy = vi.spyOn(storage, 'setConfig').mockResolvedValue(null);
    const reloadSpy = vi.spyOn(TestBed.inject(ReloadService), 'reload');
    const snack = TestBed.inject(MatSnackBar);
    const snackSpy = vi.spyOn(snack, 'open').mockImplementation(() => undefined as never);

    service.resetSettings();

    expect(setSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(snackSpy).toHaveBeenCalled();
  });
});

describe('SettingsService — getDefault* localStorage side effects (characterization)', () => {
  beforeEach(() => {
    ensureLocalStorage();
    (window as unknown as Record<string, unknown>)['__SKIP_TEST__'] = true;
  });

  // Config persists to the server; the app/theme/dashboards localStorage mirrors are dead weight
  // no live reader depends on, so the getDefault* helpers write none of them (issue #17,
  // decision 5). The connectionConfig default write is NOT part of this: it is live device scope
  // and stays (see the next test).
  it('resetSettings (server mode) leaves the local appConfig/themeConfig/dashboardsConfig mirrors untouched', () => {
    // seedConfig plants sentinels distinct from the defaults: appConfig{autoNightMode:false,
    // nightModeBrightness:1}, themeConfig 'light', dashboardsConfig [{id:'dash-1'}] — all survive.
    const service = createService({ sharedConfigName: 'profileA' });
    const storage = TestBed.inject(StorageService);
    storage.storageServiceReady$.next(true);
    vi.spyOn(storage, 'setConfig').mockResolvedValue(null);
    vi.spyOn(TestBed.inject(ReloadService), 'reload');

    service.resetSettings();

    const app = JSON.parse(localStorage.getItem('skip.appConfig') as string);
    expect(app.autoNightMode).toBe(false);
    expect(app.nightModeBrightness).toBe(1);
    expect(JSON.parse(localStorage.getItem('skip.themeConfig') as string)).toEqual({ themeName: 'light' });
    expect(JSON.parse(localStorage.getItem('skip.dashboardsConfig') as string)).toEqual([{ id: 'dash-1' }]);
  });

  // NOT Phase-B-mutable: the connectionConfig default write is live device scope and survives the
  // rewrite (issue #17, decision 5 keeps it).
  it('getDefaultConnectionConfig (via a missing connectionConfig) writes the device connectionConfig key', () => {
    const service = createService({});
    localStorage.removeItem('skip.connectionConfig');

    const cfg = service.loadConfigFromLocalStorage('connectionConfig') as IConnectionConfig;

    const persisted = JSON.parse(localStorage.getItem('skip.connectionConfig') as string);
    expect(persisted.configVersion).toBe(CONNECTION_CONFIG_VERSION);
    expect(persisted.skipUUID).toBeTruthy();
    expect(persisted.signalKUrl).toBe(window.location.origin);
    expect(cfg.skipUUID).toBe(persisted.skipUUID);
  });

  // getDefaultThemeConfig clones (issue #17, decision 5 / PCS-08): a caller mutating the result
  // must never reach the shared DefaultThemeConfig module const, and no localStorage mirror is
  // written.
  it('getDefaultThemeConfig returns a fresh clone and writes no localStorage mirror', () => {
    const service = createService({});
    localStorage.removeItem('skip.themeConfig');

    const theme = service.loadConfigFromLocalStorage('themeConfig');

    expect(theme).not.toBe(DefaultThemeConfig);
    expect(theme).toEqual({ themeName: '' });
    expect(localStorage.getItem('skip.themeConfig')).toBeNull();
  });
});

describe('SettingsService — notifications reactive signal', () => {
  // The remaining signal consumer (notifications.service) reads this directly (#79 retired the
  // observable bridges), so the write path must keep it current.
  it('exposes the hydrated notification config via a signal', () => {
    const { service } = setupHydrated({ app: loadedAppConfig(), theme: null, dashboards: [] });

    expect(service.notificationConfig()).toEqual(fullNotificationConfig());
  });

  it('the write path updates the notification signal', () => {
    const { service } = setupHydrated({ app: loadedAppConfig(), theme: null, dashboards: [] });

    const updated = { ...fullNotificationConfig(), menuGrouping: false };
    service.setNotificationConfig(updated);
    expect(service.notificationConfig()).toEqual(updated);
  });
});

describe('SettingsService — getActiveProfileName ephemeral honesty (#216 E6)', () => {
  beforeEach(() => ensureLocalStorage());

  function bootstrap(storage: StorageService, name: string): void {
    storage.bootstrapRemoteContext({
      sharedConfigName: name,
      configFileVersion: 11,
      initConfig: { app: { configVersion: 11 }, theme: null, dashboards: [] } as unknown as IConfig
    });
  }

  it('reports the persisted localStorage slot when the remote context is not bootstrapped', () => {
    const service = createService({ sharedConfigName: 'myboat' });
    const storage = TestBed.inject(StorageService);
    expect(storage.isRemoteContextBootstrapped()).toBe(false);
    expect(service.getActiveProfileName()).toBe('myboat');
  });

  it('reports the live StorageService slot once bootstrapped (the ephemeral session slot)', () => {
    const service = createService({ sharedConfigName: 'default' });
    const storage = TestBed.inject(StorageService);
    bootstrap(storage, 'day');
    expect(service.getActiveProfileName()).toBe('day');
    // The persisted per-device name is never overwritten by the ephemeral read.
    const cc = JSON.parse(localStorage.getItem('skip.connectionConfig') as string);
    expect(cc.sharedConfigName).toBe('default');
  });

  it('a connection save serializes the persisted slot, not the ephemeral bootstrapped one', () => {
    const service = createService({ sharedConfigName: 'default' });
    const storage = TestBed.inject(StorageService);
    bootstrap(storage, 'day');
    service.setInstanceName('Helm'); // triggers saveConnectionConfigToLocalStorage
    const cc = JSON.parse(localStorage.getItem('skip.connectionConfig') as string);
    expect(cc.sharedConfigName).toBe('default');
  });

  it('getPersistedProfileName reports the persisted per-device name, never the ephemeral slot', () => {
    // The rename "is this the device default?" decision keys off this, so it must stay the persisted
    // localStorage name even while an ephemeral ?profile override is the active bootstrapped slot.
    const service = createService({ sharedConfigName: 'default' });
    const storage = TestBed.inject(StorageService);
    bootstrap(storage, 'day');
    expect(service.getActiveProfileName()).toBe('day');
    expect(service.getPersistedProfileName()).toBe('default');
  });
});

describe('SettingsService — reloadApp target (query-string preservation, #216 E6)', () => {
  // Exposes the private target computation so its query-preservation can be asserted directly; the
  // real navigation stays __SKIP_TEST__-guarded and never fires here.
  interface ReloadInternals { reloadTarget(): string }

  beforeEach(() => ensureLocalStorage());

  it('preserves the pre-hash query so ?embed/?profile survive a direct reloadApp() reload', () => {
    const service = createService({});
    const original = window.location.search;
    try {
      window.location.search = '?embed=1&profile=day';
      expect((service as unknown as ReloadInternals).reloadTarget()).toBe('./?embed=1&profile=day');
    } finally {
      window.location.search = original;
    }
  });

  it('is the bare app root when there is no query string', () => {
    const service = createService({});
    const original = window.location.search;
    try {
      window.location.search = '';
      expect((service as unknown as ReloadInternals).reloadTarget()).toBe('./');
    } finally {
      window.location.search = original;
    }
  });
});
