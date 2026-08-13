import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileService } from './profile.service';
import { StorageService } from './storage.service';
import { SettingsService } from './settings.service';
import { ConfigurationUpgradeService } from './configuration-upgrade.service';
import { IConfig } from '../interfaces/app-settings.interfaces';
import { LATEST_APP_CONFIG_VERSION } from '../constants/config-versions.const';
import { DefaultDashboard } from '../../../default-config/config.blank.dashboard';

const cfg = (theme = 'x'): IConfig => ({
  app: { configVersion: LATEST_APP_CONFIG_VERSION } as IConfig['app'],
  theme: { themeName: theme },
  dashboards: [{ id: 'd' }]
});

function makeStorageMock(userNames: string[] = ['default', 'profileA']) {
  return {
    sharedConfigName: 'profileA',
    listConfigs: vi.fn<() => Promise<{ scope: string; name: string }[]>>(() =>
      Promise.resolve([
        ...userNames.map((name) => ({ scope: 'user', name })),
        { scope: 'global', name: 'sharedThing' }
      ])
    ),
    getConfig: vi.fn<(scope: string, name: string) => Promise<IConfig>>(() => Promise.resolve(cfg('fromGet'))),
    setConfig: vi.fn<(scope: string, name: string, config: IConfig) => Promise<null>>(() => Promise.resolve(null)),
    removeItem: vi.fn<(scope: string, name: string) => Promise<void>>(() => Promise.resolve()),
    awaitQueueDrain: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true))
  };
}

/** A promise plus its resolver, for tests that need to hold an async step open and release it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeSettingsMock(active = 'profileA', persisted = active) {
  return {
    getActiveProfileName: vi.fn(() => active),
    getPersistedProfileName: vi.fn(() => persisted),
    setActiveProfile: vi.fn()
  };
}

describe('ProfileService', () => {
  let service: ProfileService;
  let storage: ReturnType<typeof makeStorageMock>;
  let settings: ReturnType<typeof makeSettingsMock>;

  function setup(storageMock = makeStorageMock(), settingsMock = makeSettingsMock()) {
    storage = storageMock;
    settings = settingsMock;
    TestBed.resetTestingModule(); // allow tests to reconfigure with different mocks
    TestBed.configureTestingModule({
      providers: [
        ProfileService,
        ConfigurationUpgradeService, // real service: its migrateImportedConfig is pure (no storage/settings I/O)
        { provide: StorageService, useValue: storage },
        { provide: SettingsService, useValue: settings }
      ]
    });
    service = TestBed.inject(ProfileService);
  }

  beforeEach(() => setup());

  /**
   * Make the server's listing reflect the slots written so far, so a test can assert what the user
   * would see in the profile list. The default mock returns a fixed listing, under which a created
   * profile is invisible however the service refreshes.
   */
  function listConfigsReflectsWrites(): void {
    const base = [{ scope: 'user', name: 'default' }, { scope: 'user', name: 'profileA' }];
    storage.listConfigs.mockImplementation(() =>
      Promise.resolve([
        ...base,
        ...storage.setConfig.mock.calls.map(([scope, name]) => ({ scope, name })),
        { scope: 'global', name: 'sharedThing' }
      ])
    );
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('refresh / list', () => {
    it('lists user-scope profiles (incl default), flags the active one, drops global scope', async () => {
      await service.refresh();
      expect(service.profiles().map((p) => p.name)).toEqual(['default', 'profileA']);
      expect(service.profiles().find((p) => p.name === 'profileA')?.isActive).toBe(true);
      expect(service.profiles().find((p) => p.name === 'default')?.isActive).toBe(false);
    });
  });

  describe('switch', () => {
    it('verifies the slot exists, drains the queue, then delegates to setActiveProfile', async () => {
      await service.switchProfile('default'); // present in the listed user slots
      expect(storage.awaitQueueDrain).toHaveBeenCalled();
      expect(settings.setActiveProfile).toHaveBeenCalledWith('default');
    });

    it('refuses to switch to a slot that no longer exists (deleted on another device)', async () => {
      await expect(service.switchProfile('ghost')).rejects.toThrow(/no longer exists/i);
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
    });

    it('refuses to switch when the queue did not drain, rather than reloading over the pending write', async () => {
      storage.awaitQueueDrain.mockResolvedValueOnce(false);
      await expect(service.switchProfile('default')).rejects.toThrow(/could not be saved/i);
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('writes a default config under the new name', async () => {
      await service.refresh();
      await service.createProfile('cockpit');
      expect(storage.setConfig).toHaveBeenCalledTimes(1);
      const [scope, name, config] = storage.setConfig.mock.calls[0];
      expect(scope).toBe('user');
      expect(name).toBe('cockpit');
      expect(config.app).toBeTruthy();
      expect(Array.isArray(config.dashboards)).toBe(true);
      expect(config.dashboards.length).toBeGreaterThan(0);
      // Every page gets a fresh, distinct id — not just page 0. Reverting the fix to
      // `dashboards[0].id = UUID.create()` would leave later pages sharing the constant's
      // static ids across every profile; this guards that regression.
      expect(config.dashboards).toHaveLength(DefaultDashboard.length);
      const pageIds = config.dashboards.map(d => d.id);
      expect(new Set(pageIds).size).toBe(pageIds.length);
      config.dashboards.forEach((d, i) => expect(d.id).not.toBe(DefaultDashboard[i].id));
    });

    it('activates the created profile', async () => {
      await service.refresh();
      await service.createProfile('cockpit');
      expect(settings.setActiveProfile).toHaveBeenCalledWith('cockpit');
    });

    it('waits for the drain to settle before activating, not merely calling it', async () => {
      // Code that fires awaitQueueDrain() without awaiting it activates anyway, and both call-order
      // and a fixed microtask flush would still pass — the flush lands while createProfile is inside
      // its first refresh(), long before the drain. Gate on the mock being entered, hold the drain
      // open across a full macrotask, and only then assert nothing has activated.
      const drain = deferred<boolean>();
      const entered = deferred<void>();
      storage.awaitQueueDrain.mockImplementationOnce(() => { entered.resolve(); return drain.promise; });
      await service.refresh();
      const pending = service.createProfile('cockpit');
      await entered.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
      drain.resolve(true);
      await pending;
      expect(settings.setActiveProfile).toHaveBeenCalledWith('cockpit');
    });

    it('does not activate when the queue did not drain — the reload would abandon the pending write', async () => {
      listConfigsReflectsWrites();
      storage.awaitQueueDrain.mockResolvedValueOnce(false);
      await service.refresh();
      await expect(service.createProfile('cockpit')).rejects.toThrow(/could not be saved/i);
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
      // The slot is written before the drain runs, so the cancellation has to leave the user a
      // profile they can see and switch to by hand — not a write with nothing on screen to show it.
      expect(storage.setConfig).toHaveBeenCalledWith('user', 'cockpit', expect.anything());
      expect(service.profiles()).toContainEqual({ name: 'cockpit', isActive: false });
    });

    it.each(['', '   ', 'default', 'profileA', 'bad/name', 'bad.name', 'a~b', 'a::b'])(
      'rejects invalid/duplicate/reserved name "%s" without writing',
      async (bad) => {
        await service.refresh();
        await expect(service.createProfile(bad)).rejects.toThrow();
        expect(storage.setConfig).not.toHaveBeenCalled();
      }
    );

    it('surfaces a storage failure and never switches', async () => {
      await service.refresh();
      storage.setConfig.mockRejectedValueOnce(new Error('500'));
      await expect(service.createProfile('cockpit')).rejects.toThrow();
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
    });
  });

  describe('duplicate', () => {
    it('copies the source config under a new name', async () => {
      await service.refresh();
      await service.duplicateProfile('profileA', 'profileB');
      expect(storage.getConfig).toHaveBeenCalledWith('user', 'profileA');
      expect(storage.setConfig).toHaveBeenCalledWith('user', 'profileB', expect.anything());
    });

    it('refuses to copy an empty/unbootable source slot (server returns {})', async () => {
      storage.getConfig.mockResolvedValueOnce({} as IConfig);
      await service.refresh();
      await expect(service.duplicateProfile('profileA', 'profileB')).rejects.toThrow(/no usable configuration/i);
      expect(storage.setConfig).not.toHaveBeenCalled();
    });

    it('activates the copy, not the source', async () => {
      await service.refresh();
      await service.duplicateProfile('profileA', 'profileB');
      expect(settings.setActiveProfile).toHaveBeenCalledWith('profileB');
    });

    it('surfaces a storage failure and never activates', async () => {
      await service.refresh();
      storage.setConfig.mockRejectedValueOnce(new Error('500'));
      await expect(service.duplicateProfile('profileA', 'profileB')).rejects.toThrow();
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
    });

    it('does not activate the copy when the queue did not drain', async () => {
      listConfigsReflectsWrites();
      storage.awaitQueueDrain.mockResolvedValueOnce(false);
      await service.refresh();
      await expect(service.duplicateProfile('profileA', 'profileB')).rejects.toThrow(/could not be saved/i);
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
      expect(service.profiles()).toContainEqual({ name: 'profileB', isActive: false });
    });
  });

  describe('import', () => {
    it('imports a current-version config as a new profile (no migration, no auto-switch)', async () => {
      await service.refresh();
      const migrated = await service.importProfile('imported', cfg('imp'));
      expect(migrated).toBe(false);
      expect(storage.setConfig).toHaveBeenCalledWith('user', 'imported', expect.objectContaining({ theme: { themeName: 'imp' } }));
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
    });

    it('migrates an older-but-supported config to the current version before writing, and reports it', async () => {
      await service.refresh();
      const older = { app: { configVersion: 11 }, theme: { themeName: 'old' }, dashboards: [] };
      const migrated = await service.importProfile('imported', older);
      expect(migrated).toBe(true);
      const written = storage.setConfig.mock.calls.at(-1)?.[2] as IConfig;
      expect(written.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
    });

    it('rejects a structurally invalid config without writing', async () => {
      await service.refresh();
      await expect(service.importProfile('imported', { not: 'a config' })).rejects.toThrow(/valid/i);
      expect(storage.setConfig).not.toHaveBeenCalled();
    });

    it('rejects a shape-valid but below-floor config without writing', async () => {
      await service.refresh();
      const stale = { app: { configVersion: 9 }, theme: { themeName: 'old' }, dashboards: [] };
      await expect(service.importProfile('imported', stale)).rejects.toThrow(/too old/i);
      expect(storage.setConfig).not.toHaveBeenCalled();
    });

    it('rejects a shape-valid config with no recognizable version without writing', async () => {
      await service.refresh();
      const versionless = { app: {}, theme: { themeName: 'old' }, dashboards: [] };
      await expect(service.importProfile('imported', versionless)).rejects.toThrow(/recognizable version/i);
      expect(storage.setConfig).not.toHaveBeenCalled();
    });

    it('rejects an invalid name without writing', async () => {
      await service.refresh();
      await expect(service.importProfile('bad/name', cfg())).rejects.toThrow();
      expect(storage.setConfig).not.toHaveBeenCalled();
    });
  });

  describe('delete (guard rails)', () => {
    it('blocks deleting the active profile', async () => {
      await service.refresh();
      await expect(service.deleteProfile('profileA')).rejects.toThrow(/active/i);
      expect(storage.removeItem).not.toHaveBeenCalled();
    });

    // A switch whose reload was declined leaves the persisted name on a profile that is not loaded,
    // so the loaded-slot guard above no longer covers it. Deleting it there points the device at a
    // slot that no longer exists, and the next reload lands on the degraded recovery screen.
    it('blocks deleting the profile a deferred switch will boot into', async () => {
      setup(makeStorageMock(['default', 'profileA', 'cockpit']), makeSettingsMock('profileA', 'cockpit'));
      await service.refresh();
      await expect(service.deleteProfile('cockpit')).rejects.toThrow(/next reload/i);
      expect(storage.removeItem).not.toHaveBeenCalled();
    });

    it('blocks deleting the reserved default profile', async () => {
      await service.refresh();
      await expect(service.deleteProfile('default')).rejects.toThrow(/default/i);
      expect(storage.removeItem).not.toHaveBeenCalled();
    });

    it('blocks deleting the last remaining profile', async () => {
      setup(makeStorageMock(['solo']), makeSettingsMock('other'));
      await service.refresh();
      await expect(service.deleteProfile('solo')).rejects.toThrow(/last/i);
      expect(storage.removeItem).not.toHaveBeenCalled();
    });

    it('deletes a non-active, non-default profile', async () => {
      setup(makeStorageMock(['default', 'profileA', 'old']), makeSettingsMock('profileA'));
      await service.refresh();
      await service.deleteProfile('old');
      expect(storage.removeItem).toHaveBeenCalledWith('user', 'old');
    });

    it('surfaces a delete that did not persist (drain reports failure)', async () => {
      setup(makeStorageMock(['default', 'profileA', 'old']), makeSettingsMock('profileA'));
      storage.awaitQueueDrain.mockResolvedValueOnce(false);
      await service.refresh();
      await expect(service.deleteProfile('old')).rejects.toThrow(/retry/i);
    });
  });

  describe('rename', () => {
    it('renaming the active profile creates new, deletes old, then switches (reload)', async () => {
      await service.refresh(); // active = profileA
      await service.renameProfile('profileA', 'newName');
      expect(storage.setConfig).toHaveBeenCalledWith('user', 'newName', expect.anything());
      expect(storage.removeItem).toHaveBeenCalledWith('user', 'profileA');
      expect(settings.setActiveProfile).toHaveBeenCalledWith('newName');
      // ordering: create new slot before deleting old before switching
      const setOrder = storage.setConfig.mock.invocationCallOrder[0];
      const rmOrder = storage.removeItem.mock.invocationCallOrder[0];
      const switchOrder = settings.setActiveProfile.mock.invocationCallOrder[0];
      expect(setOrder).toBeLessThan(rmOrder);
      expect(rmOrder).toBeLessThan(switchOrder);
    });

    it('renaming a non-active profile does not reload', async () => {
      setup(makeStorageMock(['default', 'profileA', 'other']), makeSettingsMock('profileA'));
      await service.refresh();
      await service.renameProfile('other', 'renamed');
      expect(storage.setConfig).toHaveBeenCalledWith('user', 'renamed', expect.anything());
      expect(storage.removeItem).toHaveBeenCalledWith('user', 'other');
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
    });

    it('renaming the ephemerally-active (?profile override) slot never repersists the device default (#216 E6)', async () => {
      // Ephemeral override: the active bootstrapped slot is 'day', but the persisted per-device
      // default is 'default'. Renaming the ephemeral slot must create/delete the storage slots yet
      // NOT write its name into the persisted default (no setActiveProfile → no persist + reload).
      setup(makeStorageMock(['default', 'day']), makeSettingsMock('day', 'default'));
      await service.refresh();
      await service.renameProfile('day', 'night');
      expect(storage.setConfig).toHaveBeenCalledWith('user', 'night', expect.anything());
      expect(storage.removeItem).toHaveBeenCalledWith('user', 'day');
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
    });

    // The rename deletes the old slot, so a write path left on that name posts every later save
    // against a slot the server no longer has. A rename preserves the config, so the write path
    // follows the name — including when the reload is declined and when there is no reload at all.
    it('moves the write path onto the new name, whatever happens to the reload', async () => {
      const s = makeStorageMock(['default', 'profileA']);
      s.sharedConfigName = 'profileA';
      setup(s, makeSettingsMock('profileA'));
      await service.refresh();

      await service.renameProfile('profileA', 'newName');

      expect(s.sharedConfigName).toBe('newName');
    });

    it('moves the write path when the ephemerally-active slot is renamed, which never reloads', async () => {
      const s = makeStorageMock(['default', 'day']);
      s.sharedConfigName = 'day';
      setup(s, makeSettingsMock('day', 'default'));
      await service.refresh();

      await service.renameProfile('day', 'night');

      expect(s.sharedConfigName).toBe('night');
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
    });

    it('leaves the write path alone when some other profile is renamed', async () => {
      const s = makeStorageMock(['default', 'profileA', 'other']);
      s.sharedConfigName = 'profileA';
      setup(s, makeSettingsMock('profileA'));
      await service.refresh();

      await service.renameProfile('other', 'renamed');

      expect(s.sharedConfigName).toBe('profileA');
    });

    it('blocks renaming the reserved default profile', async () => {
      await service.refresh();
      await expect(service.renameProfile('default', 'x')).rejects.toThrow(/default/i);
    });

    it('refuses to rename when the source slot is empty/unbootable', async () => {
      setup(makeStorageMock(['default', 'profileA', 'other']), makeSettingsMock('profileA'));
      storage.getConfig.mockResolvedValueOnce({} as IConfig);
      await service.refresh();
      await expect(service.renameProfile('other', 'renamed')).rejects.toThrow(/no usable configuration/i);
      expect(storage.setConfig).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    });

    it('waits for the old-slot delete to drain before switching to the renamed active slot', async () => {
      let resolveDrain: (v: boolean) => void = () => undefined;
      storage.awaitQueueDrain.mockReturnValueOnce(new Promise<boolean>((r) => { resolveDrain = r; }));
      const p = service.renameProfile('profileA', 'newName'); // active = profileA
      await new Promise((r) => setTimeout(r, 0)); // flush the resolved awaits up to the hanging drain
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
      resolveDrain(true);
      await p;
      expect(settings.setActiveProfile).toHaveBeenCalledWith('newName');
    });
  });

  describe('re-entrancy', () => {
    it('rejects a second mutation while one is still in flight', async () => {
      let release: () => void = () => undefined;
      storage.setConfig.mockReturnValueOnce(new Promise((r) => { release = () => r(null); }));
      const first = service.createProfile('one');
      const second = service.createProfile('two');
      await expect(second).rejects.toThrow(/in progress/i);
      release();
      await first;
    });
  });
});
