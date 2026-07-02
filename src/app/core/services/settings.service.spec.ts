import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';
import { ensureLocalStorage } from '../../../test-helpers/local-storage.test-helper';
import { DefaultAppConfig, DefaultConnectionConfig } from '../../../default-config/config.blank.const';
import { IAppConfig, IConnectionConfig } from '../interfaces/app-settings.interfaces';

interface DefaultConfigGetters {
  getDefaultAppConfig(): IAppConfig;
  getDefaultConnectionConfig(): IConnectionConfig;
}

interface SeedOpts {
  sharedConfigName?: string;
  useSharedConfig?: boolean;
  isRemoteControl?: boolean;
  instanceName?: string;
}

function seedConfig(opts: SeedOpts = {}): void {
  localStorage.setItem('authorization_token', JSON.stringify(null));
  localStorage.setItem('skip.connectionConfig', JSON.stringify({
    configVersion: 13,
    kipUUID: 'test-uuid',
    signalKUrl: 'https://boat.example:3443',
    proxyEnabled: false,
    signalKSubscribeAll: false,
    useSharedConfig: opts.useSharedConfig ?? false,
    sharedConfigName: opts.sharedConfigName ?? 'profileA',
    isRemoteControl: opts.isRemoteControl ?? false,
    instanceName: opts.instanceName ?? ''
  }));
  localStorage.setItem('skip.appConfig', JSON.stringify({
    configVersion: 12,
    autoNightMode: false,
    redNightMode: false,
    nightModeBrightness: 1,
    dataSets: [],
    unitDefaults: {},
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
      kipUUID: 'test-uuid',
      signalKUrl: 'http://localhost',
      proxyEnabled: false,
      signalKSubscribeAll: false,
      useDeviceToken: false,
      loginName: 'pi',
      useSharedConfig: true,
      sharedConfigName: 'default',
      ...extra
    })
  );
}

function createService(opts?: SeedOpts): SettingsService {
  // opts provided (profile suite): clear + seed inside. Omitted (credential/routing suites): the
  // describe's beforeEach already cleared and the test seeds via seedConnectionConfig first.
  if (opts) {
    ensureLocalStorage();
    seedConfig(opts);
  }
  // Provide both services in the module so transitive deps resolve to the global stubs
  // (AuthenticationService / SignalKConnectionService) rather than the real root services.
  TestBed.configureTestingModule({ providers: [SettingsService, StorageService] });
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
    expect(persisted.kipUUID).toBe('test-uuid');
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

  // SKip runs same-origin with the SK server (SSO session), so config always persists to the
  // server's applicationData regardless of the useSharedConfig flag.
  function setup(connExtra: Record<string, unknown>) {
    seedConnectionConfig(connExtra);
    localStorage.setItem('skip.appConfig', JSON.stringify({ configVersion: 12, dataSets: [], unitDefaults: {}, notificationConfig: {} }));
    localStorage.setItem('skip.dashboardsConfig', JSON.stringify([]));
    localStorage.setItem('skip.themeConfig', JSON.stringify({ themeName: '' }));
    TestBed.configureTestingModule({ providers: [SettingsService, StorageService] });
    const storage = TestBed.inject(StorageService);
    const patchSpy = vi.spyOn(storage, 'patchConfig').mockImplementation(() => undefined);
    const service = TestBed.inject(SettingsService);
    return { service, patchSpy };
  }

  it('shared config routes a setting write to server applicationData, not localStorage', () => {
    const { service, patchSpy } = setup({ useSharedConfig: true });
    localStorage.removeItem('skip.themeConfig');

    service.setThemeName('shared-theme');

    expect(patchSpy).toHaveBeenCalledWith('IThemeConfig', { themeName: 'shared-theme' });
    expect(localStorage.getItem('skip.themeConfig')).toBeNull();
  });

  it('local (useSharedConfig:false) also routes to server applicationData (single same-origin store)', () => {
    const { service, patchSpy } = setup({ useSharedConfig: false });
    localStorage.removeItem('skip.themeConfig');

    service.setThemeName('local-theme');

    expect(patchSpy).toHaveBeenCalledWith('IThemeConfig', { themeName: 'local-theme' });
    expect(localStorage.getItem('skip.themeConfig')).toBeNull();
  });

  it('setBrowserTabTitle routes to server applicationData like every other setter (useSharedConfig:false)', () => {
    // Regression guard: setBrowserTabTitle must not diverge from the always-server invariant, or the
    // title would write to localStorage and be lost on the next (server-loaded) reload.
    const { service, patchSpy } = setup({ useSharedConfig: false });
    localStorage.removeItem('skip.appConfig');

    service.setBrowserTabTitle('Helm');

    expect(patchSpy).toHaveBeenCalledWith('IAppConfig', expect.objectContaining({ browserTabTitle: 'Helm' }));
    expect(localStorage.getItem('skip.appConfig')).toBeNull();
  });
});

describe('SettingsService — config save failure reporting', () => {
  beforeEach(() => ensureLocalStorage());

  it('surfaces a snackbar when a routine config save to the server fails', async () => {
    const service = createService({ useSharedConfig: true, sharedConfigName: 'profileA' });
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
    const service = createService({ useSharedConfig: true, sharedConfigName: 'profileA' });
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

  describe('active profile (local mode)', () => {
    let service: SettingsService;

    beforeEach(() => {
      service = createService({ useSharedConfig: false, sharedConfigName: 'profileA' });
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

  describe('loadDemoConfig storage-readiness guard (server mode)', () => {
    beforeEach(() => { (window as unknown as Record<string, unknown>)['__KIP_TEST__'] = true; });

    it('does not write the demo config to the server when storage is not ready', () => {
      const service = createService({ useSharedConfig: true, sharedConfigName: 'profileA' });
      const storage = TestBed.inject(StorageService);
      storage.storageServiceReady$.next(false);
      const setSpy = vi.spyOn(storage, 'setConfig').mockImplementation(() => undefined);
      service.loadDemoConfig();
      expect(setSpy).not.toHaveBeenCalled();
    });

    it('writes the demo config to the server when storage is ready', () => {
      const service = createService({ useSharedConfig: true, sharedConfigName: 'profileA' });
      const storage = TestBed.inject(StorageService);
      storage.storageServiceReady$.next(true);
      const setSpy = vi.spyOn(storage, 'setConfig').mockResolvedValue(undefined);
      vi.spyOn(service, 'reloadApp').mockImplementation(() => undefined);
      service.loadDemoConfig();
      expect(setSpy).toHaveBeenCalledWith('user', 'profileA', expect.objectContaining({ app: expect.anything() }));
    });

    it('reloads only after the demo config save resolves', async () => {
      const service = createService({ useSharedConfig: true, sharedConfigName: 'profileA' });
      const storage = TestBed.inject(StorageService);
      storage.storageServiceReady$.next(true);
      let resolveSave!: (value: unknown) => void;
      vi.spyOn(storage, 'setConfig').mockReturnValue(
        new Promise((resolve) => { resolveSave = resolve; })
      );
      const reloadSpy = vi.spyOn(service, 'reloadApp').mockImplementation(() => undefined);

      service.loadDemoConfig();
      await Promise.resolve();

      // Reload must wait for the write, not race it.
      expect(reloadSpy).not.toHaveBeenCalled();

      resolveSave(null);
      await Promise.resolve();
      await Promise.resolve();

      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('does not reload and surfaces an error when the demo config save fails', async () => {
      const service = createService({ useSharedConfig: true, sharedConfigName: 'profileA' });
      const storage = TestBed.inject(StorageService);
      storage.storageServiceReady$.next(true);
      vi.spyOn(storage, 'setConfig').mockRejectedValue(new Error('network down'));
      const reloadSpy = vi.spyOn(service, 'reloadApp').mockImplementation(() => undefined);
      const snack = TestBed.inject(MatSnackBar);
      const snackSpy = vi.spyOn(snack, 'open').mockImplementation(() => undefined as never);

      service.loadDemoConfig();
      await Promise.resolve();
      await Promise.resolve();

      expect(reloadSpy).not.toHaveBeenCalled();
      expect(snackSpy).toHaveBeenCalled();
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
    const uuidBefore = DefaultConnectionConfig.kipUUID;

    const first = service.getDefaultConnectionConfig();
    first.sharedConfigName = 'mutated';
    first.signalKUrl = 'https://mutated.example';

    const second = service.getDefaultConnectionConfig();
    expect(second).not.toBe(first);
    expect(second.signalKUrl).not.toBe('https://mutated.example');
    // The getter clones, so mutating a returned result never reaches the shared singleton.
    expect(DefaultConnectionConfig.signalKUrl).toBe(urlBefore);
    expect(DefaultConnectionConfig.kipUUID).toBe(uuidBefore);
  });
});
