import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileService } from './profile.service';
import { StorageService } from './storage.service';
import { SettingsService } from './settings.service';
import { ConfigurationUpgradeService } from './configuration-upgrade.service';
import { IConfig } from '../interfaces/app-settings.interfaces';
import { DefaultDashboard } from '../../../default-config/config.blank.dashboard';

const cfg = (theme = 'x'): IConfig => ({
  app: { configVersion: 13 } as IConfig['app'],
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

    it('does not auto-switch into the created profile', async () => {
      await service.refresh();
      await service.createProfile('cockpit');
      expect(settings.setActiveProfile).not.toHaveBeenCalled();
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
      expect(written.app?.configVersion).toBe(13);
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
