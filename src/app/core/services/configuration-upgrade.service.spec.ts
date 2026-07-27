import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationUpgradeService, MIN_IMPORTABLE_APP_CONFIG_VERSION } from './configuration-upgrade.service';
import { StorageService } from './storage.service';
import { SettingsService } from './settings.service';
import { IConfig } from '../interfaces/app-settings.interfaces';
import { LATEST_APP_CONFIG_VERSION } from '../constants/config-versions.const';

const importConfig = (version: unknown): IConfig =>
    ({
        app: version === undefined ? {} : { configVersion: version },
        theme: { themeName: '' },
        dashboards: []
    } as unknown as IConfig);

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
        mockStorage.initConfig = null;
        mockAppSettings.reloadApp.mockClear();
        mockAppSettings.resetSettings.mockClear();

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

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
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

    it('v13 upgrade rewrites sub-field-aware widget paths, sets isPathConfigurable:false, reconciles auto-history, and stamps v14', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 13 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-position', config: { paths: {
                        longPath: { path: 'self.navigation.position.longitude', pathType: 'number', isPathConfigurable: true },
                        latPath: { path: 'self.navigation.position.latitude', pathType: 'number', isPathConfigurable: true }
                    } } } } },
                    { input: { widgetProperties: { type: 'widget-horizon', config: { supportAutomaticHistoricalSeries: true, paths: {
                        gaugePitchPath: { path: 'self.navigation.attitude.pitch', pathType: 'number', isPathConfigurable: true },
                        gaugeRollPath: { path: 'self.navigation.attitude.roll', pathType: 'number', isPathConfigurable: true }
                    } } } } }
                ] }
            ]
        });

        await service.runUpgrade(13);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(14);
        const pos = written.dashboards[0].configuration[0].input.widgetProperties.config.paths;
        expect(pos.longPath.path).toBe('self.navigation.position');
        expect(pos.latPath.path).toBe('self.navigation.position');
        // The stale stored true would otherwise override the new isPathConfigurable:false default.
        expect(pos.longPath.isPathConfigurable).toBe(false);
        expect(pos.latPath.isPathConfigurable).toBe(false);
        const horizon = written.dashboards[0].configuration[1].input.widgetProperties.config;
        expect(horizon.paths.gaugePitchPath.path).toBe('self.navigation.attitude');
        expect(horizon.paths.gaugeRollPath.path).toBe('self.navigation.attitude');
        // Charting a compound sub-field is deferred (#345): auto-history reconciled off.
        expect(horizon.supportAutomaticHistoricalSeries).toBe(false);
    });

    it('v13 upgrade leaves a GENERIC widget pointed at a compound sub-field untouched (no whole-object readout)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 13 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-numeric', config: { paths: {
                        numericPath: { path: 'self.navigation.attitude.pitch', pathType: 'number', isPathConfigurable: true }
                    } } } } }
                ] }
            ]
        });

        await service.runUpgrade(13);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(14); // still advanced one step to the v13->v14 output
        const numeric = written.dashboards[0].configuration[0].input.widgetProperties.config.paths.numericPath;
        expect(numeric.path).toBe('self.navigation.attitude.pitch'); // path left on the inert child (clean no-data), not collapsed
        expect(numeric.isPathConfigurable).toBe(true);
    });

    it('v13 upgrade handles the array form of paths on a sub-field-aware widget', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 13 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-position', config: { paths: [
                        { path: 'self.navigation.position.latitude', pathType: 'number', isPathConfigurable: true }
                    ] } } } }
                ] }
            ]
        });

        await service.runUpgrade(13);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.dashboards[0].configuration[0].input.widgetProperties.config.paths[0].path)
            .toBe('self.navigation.position');
    });

    it('v13 upgrade skips a slot that is not at version 13 (no re-stamp)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 14 },
            theme: { themeName: '' },
            dashboards: []
        });

        await service.runUpgrade(13);

        expect(mockStorage.setConfig).not.toHaveBeenCalled();
    });

    it('v13 upgrade is idempotent — a path already at the compound level is not re-trimmed', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 13 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-heel-gauge', config: { paths: {
                        angle: { path: 'self.navigation.attitude', pathType: 'number' }
                    } } } } }
                ] }
            ]
        });

        await service.runUpgrade(13);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.dashboards[0].configuration[0].input.widgetProperties.config.paths.angle.path)
            .toBe('self.navigation.attitude');
    });

    it('v14 upgrade collapses a position widget to a single object-typed positionPath and stamps v15', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 14 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-position', config: { paths: {
                        longPath: { path: 'self.navigation.position.longitude', pathType: 'number', isPathConfigurable: true, source: 'gps.0', sampleTime: 1000 },
                        latPath: { path: 'self.navigation.position.latitude', pathType: 'number', isPathConfigurable: true, source: 'gps.0', sampleTime: 1000 }
                    } } } } }
                ] }
            ]
        });

        await service.runUpgrade(14);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(15);
        const paths = written.dashboards[0].configuration[0].input.widgetProperties.config.paths;
        // The two dead coordinate entries are gone, replaced by a single object-typed location path.
        expect(Object.keys(paths)).toEqual(['positionPath']);
        expect(paths.positionPath.path).toBe('self.navigation.position');
        expect(paths.positionPath.pathType).toBe('object');
        expect(paths.positionPath.isPathConfigurable).toBe(true);
        // A user-pinned source / sampleTime carries across the collapse.
        expect(paths.positionPath.source).toBe('gps.0');
        expect(paths.positionPath.sampleTime).toBe(1000);
    });

    it('v14 upgrade leaves a non-position widget untouched (scoped rewrite), still stamps v15', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 14 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-numeric', config: { paths: {
                        numericPath: { path: 'self.navigation.speedOverGround', pathType: 'number', isPathConfigurable: true }
                    } } } } }
                ] }
            ]
        });

        await service.runUpgrade(14);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(15);
        const paths = written.dashboards[0].configuration[0].input.widgetProperties.config.paths;
        expect(Object.keys(paths)).toEqual(['numericPath']);
        expect(paths.numericPath.path).toBe('self.navigation.speedOverGround');
    });

    it('v14 upgrade skips a slot that is not at version 14 (no re-stamp)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 15 },
            theme: { themeName: '' },
            dashboards: []
        });

        await service.runUpgrade(14);

        expect(mockStorage.setConfig).not.toHaveBeenCalled();
    });

    it('v14 upgrade fills default source/sampleTime and handles empty, array, and missing paths without throwing', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 14 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    // legacy record entry with no source/sampleTime -> both fall back to defaults
                    { input: { widgetProperties: { type: 'widget-position', config: { paths: {
                        longPath: { path: 'self.navigation.position.longitude', pathType: 'number' }
                    } } } } },
                    // array form of paths still collapses to the single object entry
                    { input: { widgetProperties: { type: 'widget-position', config: { paths: [
                        { path: 'self.navigation.position.latitude', pathType: 'number' }
                    ] } } } },
                    // empty paths object
                    { input: { widgetProperties: { type: 'widget-position', config: { paths: {} } } } },
                    // a widget with no widgetProperties is skipped, not crashed on
                    { input: {} }
                ] }
            ]
        });

        await service.runUpgrade(14);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(15);
        const cfgs = written.dashboards[0].configuration;
        for (const i of [0, 1, 2]) {
            const paths = cfgs[i].input.widgetProperties.config.paths;
            expect(Object.keys(paths)).toEqual(['positionPath']);
            expect(paths.positionPath.path).toBe('self.navigation.position');
            expect(paths.positionPath.pathType).toBe('object');
            expect(paths.positionPath.source).toBe('default');
            expect(paths.positionPath.sampleTime).toBe(500);
        }
    });

    it('v14 upgrade collapses every position widget across multiple dashboards', async () => {
        const positionWidget = () => ({ input: { widgetProperties: { type: 'widget-position', config: { paths: {
            longPath: { path: 'self.navigation.position.longitude', pathType: 'number' },
            latPath: { path: 'self.navigation.position.latitude', pathType: 'number' }
        } } } } });
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 14 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [positionWidget()] },
                { id: 'd1', configuration: [positionWidget()] }
            ]
        });

        await service.runUpgrade(14);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(Object.keys(written.dashboards[0].configuration[0].input.widgetProperties.config.paths)).toEqual(['positionPath']);
        expect(Object.keys(written.dashboards[1].configuration[0].input.widgetProperties.config.paths)).toEqual(['positionPath']);
    });

    it('v15 upgrade resets heel-gauge/horizon paths to the fixed default, enables the timeout, and stamps v16', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 15 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    // the stranded boat shape: whole leaf, still configurable, with a stale unit override
                    { input: { widgetProperties: { type: 'widget-heel-gauge', config: {
                        paths: { angle: { path: 'self.navigation.attitude', pathType: 'number', isPathConfigurable: true, convertUnitTo: 'rad' } },
                        enableTimeout: false, dataTimeout: 5
                    } } } },
                    // stale sub-field paths must be reset back to the whole leaf
                    { input: { widgetProperties: { type: 'widget-horizon', config: {
                        paths: {
                            gaugePitchPath: { path: 'self.navigation.attitude.pitch', pathType: 'number', isPathConfigurable: true },
                            gaugeRollPath: { path: 'self.navigation.attitude.roll', pathType: 'number', isPathConfigurable: true }
                        },
                        enableTimeout: false, dataTimeout: 5
                    } } } }
                ] }
            ]
        });

        await service.runUpgrade(15);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(16);
        const heelWp = written.dashboards[0].configuration[0].input.widgetProperties;
        expect(heelWp.config.paths.angle.path).toBe('self.navigation.attitude');
        expect(heelWp.config.paths.angle.isPathConfigurable).toBe(false);
        expect(heelWp.config.paths.angle.pathType).toBe('number'); // pipeline extracts sub-field then converts rad->deg
        expect(heelWp.config.paths.angle.convertUnitTo).toBe('deg'); // stale 'rad' override discarded
        // The Paths tab (and its timeout control) is gone, so the timeout defaults on.
        expect(heelWp.config.enableTimeout).toBe(true);
        expect(heelWp.config.dataTimeout).toBe(5);
        const horizon = written.dashboards[0].configuration[1].input.widgetProperties.config.paths;
        expect(horizon.gaugePitchPath.path).toBe('self.navigation.attitude');
        expect(horizon.gaugeRollPath.path).toBe('self.navigation.attitude');
        expect(horizon.gaugePitchPath.isPathConfigurable).toBe(false);
        expect(horizon.gaugeRollPath.isPathConfigurable).toBe(false);
        expect(written.dashboards[0].configuration[1].input.widgetProperties.config.enableTimeout).toBe(true);
    });

    it('v15 upgrade handles empty, array, and missing paths without throwing (still enables timeout, stamps v16)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 15 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-heel-gauge', config: { paths: {
                        angle: { path: 'self.navigation.attitude.roll', pathType: 'number', isPathConfigurable: true }
                    } } } } },
                    // array-form paths
                    { input: { widgetProperties: { type: 'widget-horizon', config: { paths: [
                        { path: 'self.navigation.attitude', pathType: 'number', isPathConfigurable: true }
                    ] } } } },
                    // empty paths object — still enables the timeout, does not throw
                    { input: { widgetProperties: { type: 'widget-heel-gauge', config: { paths: {} } } } },
                    // a widget with no widgetProperties is skipped, not crashed on
                    { input: {} }
                ] }
            ]
        });

        await service.runUpgrade(15);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(16);
        const cfgs = written.dashboards[0].configuration;
        expect(cfgs[0].input.widgetProperties.config.paths.angle.path).toBe('self.navigation.attitude');
        expect(cfgs[1].input.widgetProperties.config.paths[0].isPathConfigurable).toBe(false);
        // empty-paths widget still gets the timeout default and no throw
        expect(cfgs[2].input.widgetProperties.config.enableTimeout).toBe(true);
    });

    it('v15 upgrade enables the timeout on racer widgets without resetting their (scalar) paths', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 15 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-racer-timer', config: {
                        paths: { ttsPath: { path: 'self.navigation.racing.timeToStart', pathType: 'number', isPathConfigurable: false } },
                        enableTimeout: false, dataTimeout: 5
                    } } } }
                ] }
            ]
        });

        await service.runUpgrade(15);

        const wp = mockStorage.setConfig.mock.calls.at(-1)![2].dashboards[0].configuration[0].input.widgetProperties;
        // Paths tab (and its timeout toggle) is suppressed for this all-fixed-path widget → timeout defaults on.
        expect(wp.config.enableTimeout).toBe(true);
        expect(wp.config.dataTimeout).toBe(5);
        // Its scalar path is already fixed — left untouched (only attitude widgets get the path reset).
        expect(wp.config.paths.ttsPath.path).toBe('self.navigation.racing.timeToStart');
    });

    it('v15 upgrade leaves a non-attitude widget untouched (scoped), still stamps v16', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 15 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-numeric', config: { paths: {
                        numericPath: { path: 'self.navigation.speedOverGround', pathType: 'number', isPathConfigurable: true }
                    } } } } }
                ] }
            ]
        });

        await service.runUpgrade(15);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(16);
        const numeric = written.dashboards[0].configuration[0].input.widgetProperties.config.paths.numericPath;
        expect(numeric.path).toBe('self.navigation.speedOverGround');
        expect(numeric.isPathConfigurable).toBe(true);
    });

    it('v15 upgrade skips a slot that is not at version 15 (no re-stamp)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 16 },
            theme: { themeName: '' },
            dashboards: []
        });

        await service.runUpgrade(15);

        expect(mockStorage.setConfig).not.toHaveBeenCalled();
    });

    it('v16 upgrade collapses per-path sampleTime into one widget-level updateInterval (min) and stamps v17', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 16 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    // uniform per-path cadence -> that value
                    { input: { widgetProperties: { type: 'widget-numeric', config: {
                        paths: { numericPath: { path: 'self.navigation.speedOverGround', pathType: 'number', sampleTime: 500 } }
                    } } } },
                    // divergent per-path cadence -> the minimum (most responsive)
                    { input: { widgetProperties: { type: 'widget-racer-line', config: {
                        paths: {
                            a: { path: 'self.a', pathType: 'number', sampleTime: 1000 },
                            b: { path: 'self.b', pathType: 'number', sampleTime: 500 }
                        }
                    } } } }
                ] }
            ]
        });

        await service.runUpgrade(16);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(17);
        const numeric = written.dashboards[0].configuration[0].input.widgetProperties.config;
        expect(numeric.updateInterval).toBe(500);
        expect(numeric.paths.numericPath.sampleTime).toBeUndefined();
        const racer = written.dashboards[0].configuration[1].input.widgetProperties.config;
        expect(racer.updateInterval).toBe(500);
        expect(racer.paths.a.sampleTime).toBeUndefined();
        expect(racer.paths.b.sampleTime).toBeUndefined();
    });

    it('v16 upgrade defaults updateInterval to 1000 with no valid sampleTime, tolerates array/missing paths, stamps v17', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 16 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    // paths present but none carry a valid sampleTime -> default 1000
                    { input: { widgetProperties: { type: 'widget-text', config: {
                        paths: { stringPath: { path: 'self.some.string', pathType: 'string' } }
                    } } } },
                    // array-form paths iterate too (Object.values)
                    { input: { widgetProperties: { type: 'widget-boolean-switch', config: { paths: [
                        { path: 'self.sw', pathType: 'boolean', sampleTime: 500 }
                    ] } } } },
                    // no paths at all -> left untouched (no updateInterval)
                    { input: { widgetProperties: { type: 'widget-iframe', config: { widgetUrl: 'https://x' } } } },
                    // missing widgetProperties -> skipped, not crashed on
                    { input: {} }
                ] }
            ]
        });

        await service.runUpgrade(16);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(17);
        const cfgs = written.dashboards[0].configuration;
        expect(cfgs[0].input.widgetProperties.config.updateInterval).toBe(1000);
        expect(cfgs[1].input.widgetProperties.config.updateInterval).toBe(500);
        expect(cfgs[2].input.widgetProperties.config.updateInterval).toBeUndefined();
    });

    it('v16 upgrade skips a slot that is not at version 16 (no re-stamp)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 15 },
            theme: { themeName: '' },
            dashboards: []
        });

        await service.runUpgrade(16);

        expect(mockStorage.setConfig).not.toHaveBeenCalled();
    });

    it('v16 upgrade excludes non-positive sampleTime from the min (0 and negative ignored, valid value wins)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 16 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-numeric', config: {
                        paths: {
                            a: { path: 'self.a', pathType: 'number', sampleTime: 0 },
                            b: { path: 'self.b', pathType: 'number', sampleTime: -5 },
                            c: { path: 'self.c', pathType: 'number', sampleTime: 500 }
                        }
                    } } } }
                ] }
            ]
        });

        await service.runUpgrade(16);

        const cfg = mockStorage.setConfig.mock.calls.at(-1)![2].dashboards[0].configuration[0].input.widgetProperties.config;
        expect(cfg.updateInterval).toBe(500);
        expect(cfg.paths.a.sampleTime).toBeUndefined();
        expect(cfg.paths.b.sampleTime).toBeUndefined();
        expect(cfg.paths.c.sampleTime).toBeUndefined();
    });

    it('v17 upgrade resets wind-family paths to their fixed/choice default and stamps v18', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 17 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-wind-steer', config: {
                        paths: {
                            headingPath: { description: 'True Heading', path: 'self.navigation.headingMagnetic', isPathConfigurable: true, source: 'a-pinned-device' },
                            appWindAngle: { description: 'Apparent Wind Angle', path: 'self.environment.wind.angleApparent', isPathConfigurable: true },
                            trueWindAngle: { description: 'True Wind Angle', path: 'self.environment.wind.angleTrueGround', isPathConfigurable: true, source: 'ground-source' },
                            trueWindSpeed: { description: 'True Wind Speed', path: 'self.environment.wind.speedOverGround', isPathConfigurable: true }
                        }
                    } } } }
                ] }
            ]
        });

        await service.runUpgrade(17);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(18);
        const paths = written.dashboards[0].configuration[0].input.widgetProperties.config.paths;
        // choice slot: hard-reset to the canonical default, description neutralized, stays configurable
        expect(paths.trueWindAngle.path).toBe('self.environment.wind.angleTrueWater');
        expect(paths.trueWindAngle.description).toBe('Wind Angle');
        expect(paths.trueWindAngle.isPathConfigurable).toBe(true);
        expect(paths.headingPath.path).toBe('self.navigation.headingTrue'); // stored magnetic override discarded
        expect(paths.headingPath.description).toBe('Heading');
        // fixed slots: no longer user-editable; a stale path is corrected
        expect(paths.appWindAngle.isPathConfigurable).toBe(false);
        expect(paths.trueWindSpeed.isPathConfigurable).toBe(false);
        expect(paths.trueWindSpeed.path).toBe('self.environment.wind.speedTrue');
        // a pinned source is discarded too: a leftover pin can starve the reset path at runtime
        expect(paths.headingPath.source).toBe('default');
        expect(paths.trueWindAngle.source).toBe('default');
    });

    it('v17 upgrade resets widget-racesteer wind + nav paths to their fixed/choice defaults', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 17 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-racesteer', config: {
                        paths: {
                            courseOverGround: { description: 'True Course Over Ground', path: 'self.navigation.courseOverGroundMagnetic', isPathConfigurable: true, source: 'compass' },
                            nextWaypointBearing: { description: 'Next Waypoint Bearing', path: 'self.navigation.course.calcValues.bearingMagnetic', isPathConfigurable: true },
                            drift: { description: 'Drift', path: 'self.environment.current.drift', isPathConfigurable: true }
                        }
                    } } } }
                ] }
            ]
        });

        await service.runUpgrade(17);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(18);
        const paths = written.dashboards[0].configuration[0].input.widgetProperties.config.paths;
        // choice slot
        expect(paths.courseOverGround.path).toBe('self.navigation.courseOverGroundTrue');
        expect(paths.courseOverGround.description).toBe('Course Over Ground');
        expect(paths.courseOverGround.isPathConfigurable).toBe(true);
        expect(paths.courseOverGround.source).toBe('default');
        // fixed slots
        expect(paths.nextWaypointBearing.path).toBe('self.navigation.course.calcValues.bearingTrue');
        expect(paths.nextWaypointBearing.isPathConfigurable).toBe(false);
        expect(paths.drift.isPathConfigurable).toBe(false);
    });

    it('v17 upgrade resets widget-windtrends-chart direction (choice) and speed (fixed)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 17 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-windtrends-chart', config: {
                        paths: {
                            trueWindDirection: { description: 'True Wind Direction', path: 'self.environment.wind.directionMagnetic', isPathConfigurable: true },
                            trueWindSpeed: { description: 'True Wind Speed', path: 'self.environment.wind.speedTrue', isPathConfigurable: true }
                        }
                    } } } }
                ] }
            ]
        });

        await service.runUpgrade(17);

        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(18);
        const paths = written.dashboards[0].configuration[0].input.widgetProperties.config.paths;
        expect(paths.trueWindDirection.path).toBe('self.environment.wind.directionTrue');
        expect(paths.trueWindDirection.description).toBe('Wind Direction');
        expect(paths.trueWindDirection.isPathConfigurable).toBe(true);
        expect(paths.trueWindSpeed.isPathConfigurable).toBe(false);
        expect(paths.trueWindSpeed.path).toBe('self.environment.wind.speedTrue');
    });

    it('v17 upgrade leaves a non-wind widget untouched, still stamps v18', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({
            app: { configVersion: 17 },
            theme: { themeName: '' },
            dashboards: [
                { id: 'd0', configuration: [
                    { input: { widgetProperties: { type: 'widget-numeric', config: { paths: { numericPath: { path: 'self.navigation.speedOverGround', isPathConfigurable: true } } } } } }
                ] }
            ]
        });

        await service.runUpgrade(17);
        const written = mockStorage.setConfig.mock.calls.at(-1)![2];
        expect(written.app.configVersion).toBe(18);
        expect(written.dashboards[0].configuration[0].input.widgetProperties.config.paths.numericPath.isPathConfigurable).toBe(true);
    });

    it('v17 upgrade skips a slot that is not at version 17 (no re-stamp)', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({ app: { configVersion: 16 }, theme: { themeName: '' }, dashboards: [] });
        await service.runUpgrade(17);
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

    it('legacy upgrade clears the blocking overlay when slot listing fails, without wedging', async () => {
        mockStorage.listConfigs.mockRejectedValueOnce(new Error('offline'));

        await service.runUpgrade(); // legacy (version-less) path

        // The catch must reset upgrading(), matching the v11/v12 paths; leaving it set
        // wedges the app behind the upgrade overlay with no dismiss.
        expect(service.upgrading()).toBe(false);
    });

    it('legacy upgrade skips a slot whose config has no app section, without crashing', async () => {
        mockStorage.listConfigs.mockResolvedValueOnce([{ scope: 'user', name: 'default' }]);
        mockStorage.getConfig.mockResolvedValue({ theme: { themeName: '' } }); // no app section

        await service.runUpgrade();

        // transformConfig returns null for the app-less slot, so nothing is persisted and
        // the prior config.app.configVersion TypeError no longer fires.
        expect(mockStorage.setConfig).not.toHaveBeenCalled();
    });

    describe('migrateImportedConfig (in-memory import migration matrix)', () => {
        it('accepts a current-version config unchanged, running no migration and no slot I/O', () => {
            const result = service.migrateImportedConfig(importConfig(LATEST_APP_CONFIG_VERSION));

            expect(result.migrated).toBe(false);
            expect(result.config.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
            expect(mockStorage.setConfig).not.toHaveBeenCalled();
            expect(mockStorage.getConfig).not.toHaveBeenCalled();
            expect(mockStorage.listConfigs).not.toHaveBeenCalled();
            expect(mockAppSettings.reloadApp).not.toHaveBeenCalled();
        });

        it('migrates a floor (v11) config up to the current version purely in memory — no slot I/O, no reload', () => {
            const original = importConfig(MIN_IMPORTABLE_APP_CONFIG_VERSION);

            const result = service.migrateImportedConfig(original);

            expect(result.migrated).toBe(true);
            expect(result.config.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
            // The migration must not touch storage or reload the app — that is the reload trap #175 pins.
            expect(mockStorage.setConfig).not.toHaveBeenCalled();
            expect(mockStorage.getConfig).not.toHaveBeenCalled();
            expect(mockStorage.listConfigs).not.toHaveBeenCalled();
            expect(mockAppSettings.reloadApp).not.toHaveBeenCalled();
            // The caller's object is left untouched (the chain works on a clone).
            expect(original.app?.configVersion).toBe(MIN_IMPORTABLE_APP_CONFIG_VERSION);
        });

        it('migrates an intermediate (v12) config up to the current version', () => {
            const result = service.migrateImportedConfig(importConfig(12));

            expect(result.migrated).toBe(true);
            expect(result.config.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
        });

        it('rejects a below-floor config with a distinct "too old" error and no write', () => {
            expect(() => service.migrateImportedConfig(importConfig(10))).toThrow(/too old/i);
            expect(mockStorage.setConfig).not.toHaveBeenCalled();
        });

        it('rejects a config with no recognizable version with a distinct error and no write', () => {
            expect(() => service.migrateImportedConfig(importConfig(undefined))).toThrow(/recognizable version/i);
            expect(mockStorage.setConfig).not.toHaveBeenCalled();
        });

        it('rejects a too-new config with a distinct "newer" error and no write', () => {
            expect(() => service.migrateImportedConfig(importConfig(LATEST_APP_CONFIG_VERSION + 1))).toThrow(/newer/i);
            expect(mockStorage.setConfig).not.toHaveBeenCalled();
        });

        it('has an upgrade transform for every version from the import floor up to latest (guards future LATEST bumps)', () => {
            const dispatch = service as unknown as {
                migrateOneAppVersion(config: IConfig, from: number): IConfig | null;
            };
            for (let from = MIN_IMPORTABLE_APP_CONFIG_VERSION; from < LATEST_APP_CONFIG_VERSION; from++) {
                const upgraded = dispatch.migrateOneAppVersion(importConfig(from), from);
                // A bump of LATEST_APP_CONFIG_VERSION that forgets to register the new transform lands
                // here: the dispatch returns null for the now-in-range version, which would make every
                // current export non-importable through the migration loop.
                expect(upgraded, `no upgrade transform registered for config version ${from}`).not.toBeNull();
                expect(upgraded?.app?.configVersion).toBeGreaterThan(from);
            }
        });

        it('throws the distinct loop-reject error when an in-range version has no working transform', () => {
            const dispatch = service as unknown as {
                migrateOneAppVersion(config: IConfig, from: number): IConfig | null;
            };
            vi.spyOn(dispatch, 'migrateOneAppVersion').mockReturnValue(null);

            expect(() => service.migrateImportedConfig(importConfig(MIN_IMPORTABLE_APP_CONFIG_VERSION)))
                .toThrow(/could not be migrated from version 11/i);
            expect(mockStorage.setConfig).not.toHaveBeenCalled();
        });
    });

    it('startFresh skips a legacy slot missing its app section and still retires the rest', async () => {
        mockStorage.initConfig = null; // remote (Signal K) path
        mockStorage.listConfigs.mockResolvedValueOnce([
            { scope: 'global', name: 'gconf' },
            { scope: 'user', name: 'uconf' }
        ]);
        mockStorage.getConfig.mockImplementation((scope: string, name: string) =>
            Promise.resolve(name === 'uconf' ? { app: { configVersion: 10 } } : { theme: {} }));

        service.startFresh();
        await vi.waitFor(() => expect(mockAppSettings.resetSettings).toHaveBeenCalled());

        // The valid user slot is retired; the app-less global slot is skipped, not retired.
        expect(mockStorage.setConfig).toHaveBeenCalledWith(
            'user', 'uconf', expect.objectContaining({ app: expect.objectContaining({ configVersion: 0 }) }), 9);
        expect(mockStorage.setConfig).not.toHaveBeenCalledWith(
            'global', 'gconf', expect.anything(), 9);
    });
});
