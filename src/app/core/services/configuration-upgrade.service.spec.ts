import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationUpgradeService } from './configuration-upgrade.service';
import { StorageService } from './storage.service';
import { SettingsService } from './settings.service';

describe('ConfigurationUpgradeService', () => {
    let service: ConfigurationUpgradeService;

    const mockStorage = {
        initConfig: null,
        listConfigs: vi.fn().mockResolvedValue([]),
        getConfig: vi.fn().mockResolvedValue(null),
        setConfig: vi.fn().mockResolvedValue(undefined)
    };

    const mockAppSettings = {
        reloadApp: vi.fn(),
        getAppConfig: vi.fn().mockReturnValue({}),
        getDashboardConfig: vi.fn().mockReturnValue([]),
        getThemeConfig: vi.fn().mockReturnValue({}),
        loadConfigFromLocalStorage: vi.fn().mockReturnValue({}),
        resetSettings: vi.fn()
    };

    beforeEach(() => {
        mockStorage.listConfigs.mockClear();
        mockStorage.getConfig.mockClear();
        mockStorage.setConfig.mockClear();
        mockAppSettings.reloadApp.mockClear();

        TestBed.configureTestingModule({
            providers: [
                ConfigurationUpgradeService,
                { provide: StorageService, useValue: mockStorage },
                { provide: SettingsService, useValue: mockAppSettings }
            ]
        });
        service = TestBed.inject(ConfigurationUpgradeService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('removeSplitShellConfigKeys strips the dead split-shell keys, preserving other fields', () => {
        const app = {
            configVersion: 12,
            browserTabTitle: 'Helm',
            splitShellEnabled: true,
            splitShellSide: 'left',
            splitShellWidth: 0.5,
            splitShellSwipeDisabled: false
        };
        (service as unknown as { removeSplitShellConfigKeys: (a: unknown) => void }).removeSplitShellConfigKeys(app);
        const raw = app as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(raw, 'splitShellEnabled')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(raw, 'splitShellSide')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(raw, 'splitShellWidth')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(raw, 'splitShellSwipeDisabled')).toBe(false);
        expect(raw['browserTabTitle']).toBe('Helm');
        expect(raw['configVersion']).toBe(12);
    });

    it('should support calling runUpgrade without a version argument', async () => {
        await service.runUpgrade();

        expect(mockStorage.listConfigs).toHaveBeenCalledWith(9);
        expect(service.error()).toBeNull();
    });

    it('v11 upgrade backs up and persists every slot to the server (anti-loop)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 11 },
            theme: { themeName: '' },
            dashboards: []
        });

        await service.runUpgrade(11);

        // Original v11 config is backed up to the 11.99 file version first...
        expect(mockStorage.setConfig).toHaveBeenCalledWith(
            'user', 'default',
            expect.objectContaining({ app: expect.objectContaining({ configVersion: 11 }) }),
            11.99);
        // ...then the upgraded v12 result lands on the server's active file version. If the
        // server copy stays v11 the upgrade re-triggers on every boot.
        expect(mockStorage.setConfig).toHaveBeenCalledWith(
            'user', 'default',
            expect.objectContaining({ app: expect.objectContaining({ configVersion: 12 }) }));
    });

    it('v11 upgrade reloads the app exactly once after the slots are persisted', async () => {
        vi.useFakeTimers();
        try {
            mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
            mockStorage.getConfig.mockResolvedValue({
                app: { configVersion: 11 },
                theme: { themeName: '' },
                dashboards: []
            });

            await service.runUpgrade(11);
            vi.advanceTimersByTime(1500);

            expect(mockAppSettings.reloadApp).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('clears the blocking overlay when the v11 slot listing fails, without reloading', async () => {
        vi.useFakeTimers();
        try {
            mockStorage.listConfigs.mockRejectedValueOnce(new Error('offline'));

            await service.runUpgrade(11);

            // The overlay is gated solely on upgrading(); leaving it set wedges the app behind
            // a spinner with no dismiss. No reload either: the server still holds v11, so the
            // upgrade retries next boot instead of reload-looping on a dead link.
            expect(service.upgrading()).toBe(false);
            vi.advanceTimersByTime(5000);
            expect(mockAppSettings.reloadApp).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('v12 upgrade drops the dataset registry, strips widget recorder vestige, and stamps v13', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 12, dataSets: [{ uuid: 'x' }] },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { config: { datasetUUID: 'x', chartEngine: 'recorder', datachartPath: 'self.foo' } } } }
                ] }
            ]
        });

        await service.runUpgrade(12);

        const written = mockStorage.setConfig.mock.calls.at(-1)[2];
        expect(written.app.configVersion).toBe(13);
        expect('dataSets' in written.app).toBe(false);
        const widgetCfg = written.dashboards[0].configuration[0].input.widgetProperties.config;
        expect('datasetUUID' in widgetCfg).toBe(false);
        expect('chartEngine' in widgetCfg).toBe(false);
        // Genuine chart inputs survive.
        expect(widgetCfg.datachartPath).toBe('self.foo');
    });

    it('v12 upgrade reloads the app exactly once after persisting', async () => {
        vi.useFakeTimers();
        try {
            mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
            mockStorage.getConfig.mockResolvedValue({
                app: { configVersion: 12, dataSets: [] },
                theme: { themeName: '' },
                dashboards: []
            });

            await service.runUpgrade(12);
            vi.advanceTimersByTime(1500);

            expect(mockAppSettings.reloadApp).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('v12 upgrade skips a slot that is not at version 12 (no re-stamp)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 13 },
            theme: { themeName: '' },
            dashboards: []
        });

        await service.runUpgrade(12);

        expect(mockStorage.setConfig).not.toHaveBeenCalled();
    });

    it('startFresh retires BOTH global and user legacy configs via an awaited write before resetting', async () => {
        mockStorage.initConfig = null; // remote (Signal K) path
        mockStorage.listConfigs.mockResolvedValueOnce([
            { scope: 'global', name: 'gconf' },
            { scope: 'user', name: 'uconf' }
        ]);
        mockStorage.getConfig.mockImplementation(async () => ({ app: { configVersion: 10 } }));

        service.startFresh();

        // The reset (which reloads the page) must run only after retiring completes.
        await vi.waitFor(() => expect(mockAppSettings.resetSettings).toHaveBeenCalled());

        // Global must be retired via an awaited setConfig (not a deferred fire-and-forget),
        // to legacy file version 9 with configVersion 0 — same as the user scope.
        expect(mockStorage.setConfig).toHaveBeenCalledWith(
            'global', 'gconf', expect.objectContaining({ app: expect.objectContaining({ configVersion: 0 }) }), 9);
        expect(mockStorage.setConfig).toHaveBeenCalledWith(
            'user', 'uconf', expect.objectContaining({ app: expect.objectContaining({ configVersion: 0 }) }), 9);
    });
});
