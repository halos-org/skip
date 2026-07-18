import { Injectable, inject, signal } from '@angular/core';
import { cloneDeep } from 'lodash-es';
import { StorageService, Config } from './storage.service';
import { SettingsService } from './settings.service';
import { IAppConfig, IConfig, IThemeConfig } from '../interfaces/app-settings.interfaces';
import { v10IConfig, v10IThemeConfig } from '../interfaces/v10-config-interface';
import { NgGridStackWidget } from 'gridstack/dist/angular';
import { Dashboard } from './dashboard.service';
import { LOCAL_CONFIG_KEYS } from '../constants/config-storage.const';
import { LATEST_APP_CONFIG_VERSION, REMOTE_CONFIG_FILE_VERSION } from '../constants/config-versions.const';

// The app-config schema version the legacy v10/v11 transforms produce. Pinned on purpose:
// bumping LATEST_APP_CONFIG_VERSION must not change what these transforms stamp — a newer
// schema needs a chained migration step here, not a re-labeled output. Divergence fails loud:
// a stamped config below latest re-raises the upgrade flag instead of masquerading as current.
const MIGRATION_OUTPUT_VERSION = 12;

// The v12 -> v13 transform output. Pinned the same way as MIGRATION_OUTPUT_VERSION: a fixed 13,
// never LATEST_APP_CONFIG_VERSION, so a future schema bump re-raises the upgrade flag for a v13
// config instead of relabeling it as current.
const V13_MIGRATION_OUTPUT_VERSION = 13;

// The v13 -> v14 transform output. Pinned to a fixed 14 for the same reason as the constants above.
const V14_MIGRATION_OUTPUT_VERSION = 14;

// SK-02 / #21: the delta parser stopped fabricating dotted child paths for compound leaves, so a
// stored widget path pointing at a sub-field of one of these leaves must be rewritten to the whole
// canonical path (the widgets read the sub-field off the whole value). Matched by suffix so a nested
// compound (e.g. courseGreatCircle.nextPoint.position) is covered as well as the top-level leaf.
const COMPOUND_SUBFIELD_PATH_SUFFIXES = [
  '.position.latitude', '.position.longitude', '.position.altitude',
  '.attitude.roll', '.attitude.pitch', '.attitude.yaw',
];

// Only the predefined widgets that were adapted to read a compound sub-field off the whole value are
// rewritten. A generic widget (numeric, gauge, ...) a user pointed at a compound sub-field has no
// sub-field accessor, so rewriting its path to the whole leaf would render a raw object — worse than
// leaving it on the now-inert child path (which shows a clean no-data placeholder). Charting a
// compound sub-field is deferred to #345. Autopilot's Next-WPT position is an internal widget config,
// not a stored path, so it is not listed here.
const SUBFIELD_WIDGET_TYPES = new Set(['widget-position', 'widget-heel-gauge', 'widget-horizon']);

// NOTE: This service encapsulates the app-config upgrades — the legacy migration (remote file
// version 9 / app-config version 10) and the v11 remote upgrade — each stamping the upgraded
// config with MIGRATION_OUTPUT_VERSION.

/**
 * Lowest app-config version an uploaded config can be migrated from on import. Deliberately the
 * fork's own floor: v11 reaches fork-era KIP exports, while the pre-fork v9/v10 localStorage
 * transforms are dead in Skip's storage namespace and so are out of scope for import.
 */
export const MIN_IMPORTABLE_APP_CONFIG_VERSION = 11;

/** Outcome of an in-memory import migration: the ready-to-store config and whether any step ran. */
export interface ImportedConfigMigration {
  config: IConfig;
  migrated: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConfigurationUpgradeService {
  private _storage = inject(StorageService);
  private _settings = inject(SettingsService);

  // Signals/state for UI binding if desired
  public upgrading = signal<boolean>(false);
  public error = signal<string | null>(null);
  public messages = signal<string[]>([]);

  // Source versions we support upgrading FROM (remote file version & app.configVersion).
  // Upgrades target MIGRATION_OUTPUT_VERSION.
  private readonly legacyFileVersion = 9;
  private readonly legacyConfigVersion = 10;

  // Static mapping of old widget.type to new selector values
  private static readonly widgetTypeToSelectorMap: Record<string, string> = {
    'WidgetNumeric': 'widget-numeric',
    'WidgetTextGeneric': 'widget-text',
    'WidgetDateGeneric': 'widget-datetime',
    'WidgetBooleanSwitch': 'widget-boolean-switch',
    'WidgetBlank': 'widget-blank',
    'WidgetStateComponent': 'widget-button',
    'WidgetSimpleLinearComponent': 'widget-simple-linear',
    'WidgetGaugeNgLinearComponent': 'widget-gauge-ng-linear',
    'WidgetGaugeNgRadialComponent': 'widget-gauge-ng-radial',
    'WidgetGaugeNgCompassComponent': 'widget-gauge-ng-compass',
    'WidgetGaugeComponent': 'widget-gauge-steel',
    'WidgetWindComponent': 'widget-wind-steer',
    'WidgetFreeboardskComponent': 'widget-freeboardsk',
    'WidgetAutopilotComponent': 'widget-autopilot',
    'WidgetDataChart': 'widget-data-chart',
    'WidgetRaceTimerComponent': 'widget-racetimer',
    'WidgetIframeComponent': 'widget-iframe'
  };

  /**
   * Triggers the configuration upgrade flow for local or remote storage.
   *
   * @param {number | undefined} version Optional current config version. Omit to run legacy remote migration discovery.
   * @returns {Promise<void>} Resolves when the selected upgrade flow has completed.
   *
   * @example
   * await this.upgradeService.runUpgrade(11);
   *
   * @example
   * await this.upgradeService.runUpgrade();
   */
  public async runUpgrade(version?: number): Promise<void> {
    this.error.set(null);
    this.upgrading.set(true);
    this.messages.set([]);


    if (version === undefined) {
      // Remote (Signal K) configs
      try {
        const rootConfigs = await this._storage.listConfigs(this.legacyFileVersion);
        for (const rootConfig of rootConfigs) {
          const transformedConfig = await this.transformConfig(rootConfig);
          if (!transformedConfig) continue; // skip if not eligible

          try {
            // Write upgraded config to current active file version
            await this._storage.setConfig(
              transformedConfig.scope,
              transformedConfig.name,
              transformedConfig.newConfiguration
            );
            // Retire legacy set in legacy file version
            await this._storage.setConfig(
              transformedConfig.scope,
              transformedConfig.name,
              transformedConfig.oldConfiguration,
              this.legacyFileVersion
            );
            this.pushMsg(`[Upgrade] Configuration ${transformedConfig.scope}/${transformedConfig.name} upgraded to version ${MIGRATION_OUTPUT_VERSION}. Old configuration patched to version 0.`);
          } catch (error) {
            this.pushError(`[Upgrade] Error saving configuration for ${rootConfig.name}: ${(error as Error).message}`);
          }
        }
        // After processing remote configs, reload
        setTimeout(() => this._settings.reloadApp(), 1500);
      } catch (error) {
        this.pushError('Error fetching configuration data: ' + (error as Error).message);
        // Clear the blocking overlay so the error is visible, matching the v11/v12 paths.
        this.upgrading.set(false);
      }

    } else if (version === 11) {
      // Remote (Signal K) configs
      try {
        const configsList: Config[] = await this._storage.listConfigs(11);

        for (const item of configsList) {
          try {
            const config = await this._storage.getConfig(item.scope, item.name, 11);
            const originalConfig = cloneDeep(config);

            this.pushMsg(`[Upgrade] Saving configuration backup to file ${item.scope}/${item.name}...`);
            await this._storage.setConfig(
              item.scope,
              item.name,
              originalConfig,
              11.99
            );

            this.pushMsg(`[Upgrade] ${item.scope}/${item.name} -> v${MIGRATION_OUTPUT_VERSION}.`);
            const migratedConfig = this.migrateOneAppVersion(config, 11);
            if (!migratedConfig) continue; // skip if not eligible

            this.pushMsg(`[Upgrade] Saving upgraded configurations...`);
            await this._storage.setConfig(
              item.scope,
              item.name,
              migratedConfig
            );
          } catch (error) {
            this.pushError(`[Upgrade] Error upgrading ${item.scope}/${item.name}: ${(error as Error).message}`);
          }
        }
        // After processing remote configs, reload
        this.pushMsg(`[Upgrade] Reloading app to finalize upgrade...`);
        setTimeout(() => this._settings.reloadApp(), 1500);
      } catch (error) {
        this.pushError('Error fetching configuration data. Aborting upgrade. Details: ' + (error as Error).message);
        // Clear the blocking overlay so the error is visible; no reload — the server still holds
        // v11, so the upgrade retries on the next boot instead of reload-looping on a dead link.
        this.upgrading.set(false);
      }

    } else if (version === 12) {
      // Remote (Signal K) configs. v12 slots live in the same active file version as v11.
      try {
        const configsList: Config[] = await this._storage.listConfigs(REMOTE_CONFIG_FILE_VERSION);

        for (const item of configsList) {
          try {
            const config = await this._storage.getConfig(item.scope, item.name, REMOTE_CONFIG_FILE_VERSION);
            this.pushMsg(`[Upgrade] ${item.scope}/${item.name} -> v${V13_MIGRATION_OUTPUT_VERSION}.`);
            const migratedConfig = this.migrateOneAppVersion(config, 12);
            if (!migratedConfig) continue; // skip if not a v12 slot

            await this._storage.setConfig(item.scope, item.name, migratedConfig);
          } catch (error) {
            this.pushError(`[Upgrade] Error upgrading ${item.scope}/${item.name}: ${(error as Error).message}`);
          }
        }
        this.pushMsg(`[Upgrade] Reloading app to finalize upgrade...`);
        setTimeout(() => this._settings.reloadApp(), 1500);
      } catch (error) {
        this.pushError('Error fetching configuration data. Aborting upgrade. Details: ' + (error as Error).message);
        this.upgrading.set(false);
      }

    } else if (version === 13) {
      // Remote (Signal K) configs. v13 slots live in the same active file version as v11/v12.
      try {
        const configsList: Config[] = await this._storage.listConfigs(REMOTE_CONFIG_FILE_VERSION);

        for (const item of configsList) {
          try {
            const config = await this._storage.getConfig(item.scope, item.name, REMOTE_CONFIG_FILE_VERSION);
            this.pushMsg(`[Upgrade] ${item.scope}/${item.name} -> v${V14_MIGRATION_OUTPUT_VERSION}.`);
            const migratedConfig = this.migrateOneAppVersion(config, 13);
            if (!migratedConfig) continue; // skip if not a v13 slot

            await this._storage.setConfig(item.scope, item.name, migratedConfig);
          } catch (error) {
            this.pushError(`[Upgrade] Error upgrading ${item.scope}/${item.name}: ${(error as Error).message}`);
          }
        }
        this.pushMsg(`[Upgrade] Reloading app to finalize upgrade...`);
        setTimeout(() => this._settings.reloadApp(), 1500);
      } catch (error) {
        this.pushError('Error fetching configuration data. Aborting upgrade. Details: ' + (error as Error).message);
        this.upgrading.set(false);
      }

    } else {
      // LocalStorage upgrade path for config version 10
      const localStorageConfig: v10IConfig = {
        app: this._settings.loadConfigFromLocalStorage('appConfig'),
        widget: this._settings.loadConfigFromLocalStorage('widgetConfig'),
        layout: this._settings.loadConfigFromLocalStorage('layoutConfig'),
        theme: this._settings.loadConfigFromLocalStorage('themeConfig')
      };

      const transformedApp = this.transformApp(localStorageConfig.app as IAppConfig);
      const transformedTheme = this.transformTheme(localStorageConfig.theme);
      const rootSplits = localStorageConfig.layout?.rootSplits || [];
      const splitSets = localStorageConfig.layout?.splitSets || [];
      const widgets = localStorageConfig.widget?.widgets || [];

      const dashboards: Dashboard[] = rootSplits.map((rootSplitUUID: string, i: number) => {
        const configuration = this.extractWidgetsFromSplitSets(splitSets, widgets, rootSplitUUID);
        return { id: rootSplitUUID, name: `Page ${i + 1}`, configuration };
      });

      this.migrateUseNeedleToEnableNeedle(dashboards);

      localStorage.setItem(LOCAL_CONFIG_KEYS.appConfig, JSON.stringify(transformedApp));
      localStorage.setItem(LOCAL_CONFIG_KEYS.dashboardsConfig, JSON.stringify(dashboards));
      localStorage.setItem(LOCAL_CONFIG_KEYS.themeConfig, JSON.stringify(transformedTheme));
      setTimeout(() => this._settings.reloadApp(), 1500);
      this.upgrading.set(false);
    }
  }

  /** Retire old configs without migrating (start fresh) */
  public startFresh(): void {
    this.error.set(null);
    this.upgrading.set(true);

    if (this._storage.initConfig === null) {
      this._storage.listConfigs(this.legacyFileVersion)
        .then(async (rootConfigs: Config[]) => {
          for (const rootConfig of rootConfigs) {
            const oldConfiguration = await this._storage.getConfig(rootConfig.scope, rootConfig.name, this.legacyFileVersion) as unknown as IConfig;
            if (!oldConfiguration.app) {
              this.pushError(`[Upgrade] Configuration ${rootConfig.scope}/${rootConfig.name} has no app section; skipping retire.`);
              continue;
            }
            oldConfiguration.app.configVersion = 0; // retire
            try {
              // Await the retire write for BOTH scopes so it completes before the
              // finally() block runs resetSettings() and reloads the page. The old
              // 'global' branch scheduled a deferred, un-awaited write (via
              // setTimeout) that the reload aborted, leaving the legacy global config
              // un-retired. Mirror the awaited setConfig pattern used by runUpgrade().
              await this._storage.setConfig(rootConfig.scope, rootConfig.name, oldConfiguration, this.legacyFileVersion);
              this.pushMsg(`[Retired] Configuration ${rootConfig.scope}/${rootConfig.name} patched to version 0.`);
            } catch {
              this.pushError(`[Upgrade] Error saving configuration for ${rootConfig.name}.`);
            }
          }
        })
        .catch(error => this.pushError('Error fetching configuration data: ' + (error as Error).message))
        .finally(() => {
          this.upgrading.set(false);
          this._settings.resetSettings();
          // close handled by component dialog; service only reloads on upgrade path
        });
    } else {
      const localStorageConfig: IConfig = { app: null, dashboards: [], theme: null };
      localStorageConfig.app = this._settings.loadConfigFromLocalStorage('appConfig');
      localStorageConfig.theme = this._settings.loadConfigFromLocalStorage('themeConfig');
      if (!localStorageConfig.app || !localStorageConfig.theme) {
        this.pushError('[Upgrade Service] Cannot start fresh: local appConfig/themeConfig failed to load.');
        this.upgrading.set(false);
        return;
      }
      localStorageConfig.app.configVersion = MIGRATION_OUTPUT_VERSION; // baseline fresh
      localStorageConfig.app.nightModeBrightness = 0.27;
      localStorageConfig.theme.themeName = '';
      localStorage.setItem(LOCAL_CONFIG_KEYS.appConfig, JSON.stringify(localStorageConfig.app));
      localStorage.setItem(LOCAL_CONFIG_KEYS.themeConfig, JSON.stringify(localStorageConfig.theme));
      localStorage.removeItem(LOCAL_CONFIG_KEYS.widgetConfig);
      localStorage.removeItem(LOCAL_CONFIG_KEYS.layoutConfig);
      this.upgrading.set(false);
    }
  }

  /**
   * Upgrade an uploaded config to the current app-config version PURELY IN MEMORY — no slot I/O,
   * no reload. The boot-time paths in runUpgrade() read/write server slots and reload the app;
   * import must do neither, so this reuses only the per-version transforms against the passed
   * object. Returns the ready-to-store config and whether any step ran, and throws a distinct,
   * actionable error for a below-floor, unrecognized, or too-new version. The caller is expected
   * to have already validated the config's shape.
   */
  public migrateImportedConfig(config: IConfig): ImportedConfigMigration {
    const version = config.app?.configVersion;
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      throw new Error('This configuration has no recognizable version number and cannot be imported.');
    }
    if (version === LATEST_APP_CONFIG_VERSION) {
      return { config, migrated: false };
    }
    if (version > LATEST_APP_CONFIG_VERSION) {
      throw new Error(`This configuration is version ${version}, which is newer than this version of KIP supports (version ${LATEST_APP_CONFIG_VERSION}). Update KIP and try again.`);
    }
    if (version < MIN_IMPORTABLE_APP_CONFIG_VERSION) {
      throw new Error(`This configuration is version ${version}, which is too old to import automatically (the minimum is version ${MIN_IMPORTABLE_APP_CONFIG_VERSION}). Load it into an older KIP, export it again, then import it here.`);
    }

    let working = cloneDeep(config);
    let current = version;
    while (current < LATEST_APP_CONFIG_VERSION) {
      const upgraded = this.migrateOneAppVersion(working, current);
      const nextVersion = upgraded?.app?.configVersion;
      if (!upgraded || typeof nextVersion !== 'number' || nextVersion <= current) {
        throw new Error(`This configuration could not be migrated from version ${current}.`);
      }
      working = upgraded;
      current = nextVersion;
    }
    return { config: working, migrated: true };
  }

  // Single source of truth for the per-version upgrade dispatch: both the boot-time slot upgrades
  // (runUpgrade) and the in-memory import chain (migrateImportedConfig) route through here, so a new
  // LATEST_APP_CONFIG_VERSION can only be reached by adding its transform to this one switch.
  private migrateOneAppVersion(config: IConfig, fromVersion: number): IConfig | null {
    switch (fromVersion) {
      case 11: return this.upgradeConfig(config);
      case 12: return this.upgradeConfigV12toV13(config);
      case 13: return this.upgradeConfigV13toV14(config);
      default: return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async transformConfig(rootConfig: Config): Promise<any> {
    const config = await this._storage.getConfig(rootConfig.scope, rootConfig.name, this.legacyFileVersion) as unknown as v10IConfig;
    if (!config.app || config.app.configVersion !== this.legacyConfigVersion) {
      this.pushError(`[Upgrade Service] ${rootConfig.scope}/${rootConfig.name} is not an upgradable version ${this.legacyConfigVersion} config. Skipping.`);
      return null;
    }
    const transformedApp = this.transformApp(config.app as IAppConfig);
    const transformedTheme = this.transformTheme(config.theme);
    const rootSplits = config.layout?.rootSplits || [];
    const splitSets = config.layout?.splitSets || [];
    const widgets = config.widget?.widgets || [];
    const dashboards: Dashboard[] = rootSplits.map((rootSplitUUID: string, i: number) => {
      const configuration = this.extractWidgetsFromSplitSets(splitSets, widgets, rootSplitUUID);
      return { id: rootSplitUUID, name: `Page ${i + 1}`, configuration };
    });
    this.migrateUseNeedleToEnableNeedle(dashboards);
    const oldConf: v10IConfig = cloneDeep(config);
    oldConf.app.configVersion = 0; // retired
    return {
      scope: rootConfig.scope,
      name: rootConfig.name,
      newConfiguration: { app: transformedApp, theme: transformedTheme, dashboards },
      oldConfiguration: oldConf
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transformWidget(config: any, widgetType: string): any {
    if (config.color === 'white') config.color = 'contrast';
    if (config.textColor) {
      switch (config.textColor) {
        case 'text': config.color = 'contrast'; break;
        case 'primary': config.color = 'blue'; break;
        case 'accent': config.color = 'yellow'; break;
        case 'warn': config.color = 'purple'; break;
        case 'nobar':
          if (widgetType === 'WidgetGaugeNgLinearComponent') {
            config.color = 'blue';
            config.gauge = config.gauge || {};
            config.gauge.useNeedle = false;
          }
          break;
        default: config.color = config.textColor;
      }
      delete config.textColor;
    }
    return config;
  }

  private transformApp(app: IAppConfig | null): IAppConfig | null {
    if (!app) return null;
    const clone = cloneDeep(app);
    clone.configVersion = MIGRATION_OUTPUT_VERSION;
    clone.nightModeBrightness = 0.27;
    this.removeSplitShellConfigKeys(clone);
    return clone;
  }

  private transformTheme(theme: v10IThemeConfig): IThemeConfig | null {
    if (!theme) return null;
    const themeConfig: IThemeConfig = { themeName: '' };
    return themeConfig;
  }

  private upgradeConfig(config: IConfig): IConfig | null {
    try {
      const appConfig = config.app;
      if (!appConfig || appConfig.configVersion !== 11) {
        this.pushError(`[Upgrade Service] Config version ${appConfig?.configVersion} upgrade is not supported. Skipping...`);
        return null;
      }
      this.removeSplitShellConfigKeys(appConfig);
      this.migrateUseNeedleToEnableNeedle(config.dashboards);
      // Iterate dashboards and force widget selector to 'widget-host2'
      let updatedWidgetCount = 0;
      let dimensionUpdatedCount = 0;
      if (Array.isArray(config.dashboards)) {
        for (const dash of config.dashboards) {
          if (dash && Array.isArray(dash.configuration)) {
            for (const widget of dash.configuration) {
              if (widget && typeof widget === 'object') {
                if (widget.selector !== 'widget-host2') {
                  widget.selector = 'widget-host2';
                  updatedWidgetCount++;
                }
                // Helper to safely double a numeric property if > 0 (handles undefined and numeric strings)
                const maybeDouble = (prop: string) => {
                  const raw = widget[prop] as unknown;
                  const numVal = typeof raw === 'string' ? Number(raw) : (raw as number);
                  if (Number.isFinite(numVal) && numVal !== 0) {
                    widget[prop] = numVal * 2;
                    dimensionUpdatedCount++;
                  }
                };
                maybeDouble('w');
                maybeDouble('h');
                maybeDouble('x');
                maybeDouble('y');

                // If width/height were missing, add them using minW/minH (or 2)
                if (widget['w'] === undefined || widget['w'] === null) {
                  const minW = widget['minW'];
                  const baseW = minW ? minW : 2;
                  widget['w'] = baseW;
                  dimensionUpdatedCount++;
                }
                if (widget['h'] === undefined || widget['h'] === null) {
                  const minH = widget['minH'];
                  const baseH = minH ? minH : 2;
                  widget['h'] = baseH;
                  dimensionUpdatedCount++;
                }
              }
            }
          }
        }
      }
      if (updatedWidgetCount) {
        this.pushMsg(`[Upgrade] Updated ${updatedWidgetCount} widget selector(s) to 'widget-host2'.`);
      }
      if (dimensionUpdatedCount) {
        this.pushMsg(`[Upgrade] Doubled widget grid metrics for ${dimensionUpdatedCount} non-zero (w/h/x/y) entries.`);
      }

      appConfig.configVersion = MIGRATION_OUTPUT_VERSION;

      return {
        app: appConfig, theme: config.theme, dashboards: config.dashboards
      };

    } catch (error) {
      this.pushError(`[Upgrade Service] Error upgrading ${config.app?.configVersion}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * v12 -> v13: retire the recorder's config footprint. The client-side chart recorder was removed,
   * so the app-level dataset registry and the per-widget `datasetUUID` / `chartEngine` fields it fed
   * are dead. Strip them and stamp v13. Genuine chart inputs (path/source/window/units) are untouched.
   */
  private upgradeConfigV12toV13(config: IConfig): IConfig | null {
    try {
      const appConfig = config.app;
      if (!appConfig || appConfig.configVersion !== 12) {
        this.pushError(`[Upgrade Service] Config version ${appConfig?.configVersion} is not an upgradable v12 config. Skipping...`);
        return null;
      }

      delete (appConfig as unknown as Record<string, unknown>).dataSets;

      if (Array.isArray(config.dashboards)) {
        for (const dash of config.dashboards) {
          if (!dash || !Array.isArray(dash.configuration)) continue;
          for (const widget of dash.configuration) {
            const cfg = (widget as { input?: { widgetProperties?: { config?: Record<string, unknown> } } })
              ?.input?.widgetProperties?.config;
            if (cfg && typeof cfg === 'object') {
              delete cfg.datasetUUID;
              delete cfg.chartEngine;
            }
          }
        }
      }

      appConfig.configVersion = V13_MIGRATION_OUTPUT_VERSION;
      return { app: appConfig, theme: config.theme, dashboards: config.dashboards };
    } catch (error) {
      this.pushError(`[Upgrade Service] Error upgrading v12->v13: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * v13 -> v14 (SK-02 / #21): the delta parser no longer flattens compound Signal K leaves into
   * fabricated dotted child paths. For the predefined widgets that were adapted to read a sub-field
   * off the whole value (SUBFIELD_WIDGET_TYPES only), rewrite each stored path pointing at a
   * sub-field of a known compound leaf (`navigation.position.*`, `navigation.attitude.*`) to the
   * whole canonical path, and reconcile the fields whose new defaults a stale stored value would
   * otherwise override (`isPathConfigurable` -> false; heel/horizon auto-history -> off). A generic
   * widget is deliberately left untouched (see SUBFIELD_WIDGET_TYPES). Idempotent: a path already at
   * the compound level matches no suffix.
   */
  private upgradeConfigV13toV14(config: IConfig): IConfig | null {
    try {
      const appConfig = config.app;
      if (!appConfig || appConfig.configVersion !== 13) {
        this.pushError(`[Upgrade Service] Config version ${appConfig?.configVersion} is not an upgradable v13 config. Skipping...`);
        return null;
      }

      let rewritten = 0;
      if (Array.isArray(config.dashboards)) {
        for (const dash of config.dashboards) {
          if (!dash || !Array.isArray(dash.configuration)) continue;
          for (const widget of dash.configuration) {
            const wp = (widget as { input?: { widgetProperties?: {
              type?: unknown;
              config?: { paths?: unknown; supportAutomaticHistoricalSeries?: boolean };
            } } })?.input?.widgetProperties;
            if (!wp || typeof wp.type !== 'string' || !SUBFIELD_WIDGET_TYPES.has(wp.type)) continue;
            const type = wp.type;
            const cfg = wp.config;
            const paths = cfg?.paths;
            if (paths && typeof paths === 'object') {
              // paths is either a Record<string, IWidgetPath> or an IWidgetPath[]; Object.values covers both.
              for (const pathCfg of Object.values(paths as Record<string, { path?: unknown; isPathConfigurable?: boolean }>)) {
                if (!pathCfg || typeof pathCfg.path !== 'string') continue;
                if (COMPOUND_SUBFIELD_PATH_SUFFIXES.some(s => (pathCfg.path as string).endsWith(s))) {
                  pathCfg.path = (pathCfg.path as string).slice(0, (pathCfg.path as string).lastIndexOf('.'));
                  pathCfg.isPathConfigurable = false;
                  rewritten++;
                }
              }
            }
            if (cfg && (type === 'widget-heel-gauge' || type === 'widget-horizon')) {
              cfg.supportAutomaticHistoricalSeries = false;
            }
          }
        }
      }
      if (rewritten) {
        this.pushMsg(`[Upgrade] Rewrote ${rewritten} compound sub-field path(s) to their canonical whole path.`);
      }

      appConfig.configVersion = V14_MIGRATION_OUTPUT_VERSION;
      return { app: appConfig, theme: config.theme, dashboards: config.dashboards };
    } catch (error) {
      this.pushError(`[Upgrade Service] Error upgrading v13->v14: ${(error as Error).message}`);
      return null;
    }
  }

  private migrateUseNeedleToEnableNeedle(dashboards: Dashboard[]): void {
    if (!Array.isArray(dashboards)) return;
    interface WidgetHost2 { input?: { widgetProperties?: { config?: unknown } } }
    interface GaugeCfg { enableNeedle?: boolean; useNeedle?: boolean;[k: string]: unknown }
    let updatedCount = 0;
    for (const dash of dashboards) {
      if (!dash || !Array.isArray(dash.configuration)) continue;
      for (const w of dash.configuration) {
        const widget = w as WidgetHost2;
        const config = widget.input?.widgetProperties?.config as { gauge?: GaugeCfg } | undefined;
        const gauge = config?.gauge;
        if (!gauge || typeof gauge !== 'object') continue;
        if (Object.prototype.hasOwnProperty.call(gauge, 'useNeedle')) {
          if (gauge.enableNeedle === undefined) {
            gauge.enableNeedle = Boolean(gauge.useNeedle);
          } else {
            gauge.enableNeedle = Boolean(gauge.enableNeedle);
          }
          delete gauge.useNeedle;
          updatedCount++;
        }
      }
    }
    if (updatedCount) this.pushMsg(`[Upgrade] Renamed gauge.useNeedle -> gauge.enableNeedle on ${updatedCount} widget(s).`);
  }

  private removeSplitShellConfigKeys(app: IAppConfig): void {
    if (!app) return;
    // One-way cleanup: the split-shell (chartplotter) mode was removed, so strip its now-dead keys
    // from an upgraded config rather than seeding them.
    const raw = app as unknown as Record<string, unknown>;
    delete raw['splitShellEnabled'];
    delete raw['splitShellSide'];
    delete raw['splitShellWidth'];
    delete raw['splitShellSwipeDisabled'];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractWidgetsFromSplitSets(splitSets: any[], widgets: any[], rootSplitUUID: string): NgGridStackWidget[] {
    const widgetMap = new Map(widgets.map(widget => [widget.uuid, widget]));
    const extractedWidgets: NgGridStackWidget[] = [];
    const issues: string[] = [];
    let x = 0; let y = 0; // grid cursor
    const gridWidth = 24; const gridHeight = 24; const widgetWidth = 3; const widgetHeight = 3;
    const traverseSplitSets = (splitSetUUID: string) => {
      const splitSet = splitSets.find(set => set.uuid === splitSetUUID);
      if (!splitSet) { issues.push(`Missing splitSet with UUID: ${splitSetUUID}`); return; }
      splitSet.splitAreas.forEach(area => {
        if (area.type === 'widget') {
          const widget = widgetMap.get(area.uuid);
          if (widget) {
            if (widget.type === 'WidgetBlank') { return; }
            if (y + widgetHeight > gridHeight) { issues.push(`No space left for widget: ${widget.uuid}`); return; }
            const selector = ConfigurationUpgradeService.widgetTypeToSelectorMap[widget.type] || 'widget-unknown';
            const transformedConfig = this.transformWidget(widget.config, widget.type);
            extractedWidgets.push({
              id: widget.uuid,
              selector: 'widget-host2',
              input: { widgetProperties: { type: selector, uuid: widget.uuid, config: transformedConfig } },
              x, y, w: widgetWidth, h: widgetHeight
            });
            x += widgetWidth; if (x >= gridWidth) { x = 0; y += widgetHeight; }
          } else { issues.push(`Missing widget with UUID: ${area.uuid}`); }
        } else if (area.type === 'splitSet') { traverseSplitSets(area.uuid); }
      });
    };
    traverseSplitSets(rootSplitUUID);
    if (issues.length) { this.pushMsg('Transformation Issues: ' + issues.join('; ')); }
    return extractedWidgets;
  }

  private pushMsg(msg: string) {
    this.messages.update(list => [...list, msg]);
  }

  private pushError(msg: string) {
    this.error.set(msg);
    this.pushMsg(msg);
  }
}
