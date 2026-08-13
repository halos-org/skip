import { Injectable, inject, signal } from '@angular/core';
import { cloneDeep } from 'lodash-es';
import { StorageService, Config } from './storage.service';
import { SettingsService } from './settings.service';
import { IAppConfig, IConfig, IThemeConfig } from '../interfaces/app-settings.interfaces';
import { v10IConfig, v10IThemeConfig } from '../interfaces/v10-config-interface';
import { DEFAULT_WIDGET_UPDATE_INTERVAL_MS } from '../interfaces/widgets-interface';
import { NgGridStackWidget } from 'gridstack/dist/angular';
import { Dashboard } from './dashboard.service';
import { LOCAL_CONFIG_KEYS } from '../constants/config-storage.const';
import { LATEST_APP_CONFIG_VERSION, REMOTE_CONFIG_FILE_VERSION } from '../constants/config-versions.const';
import { removeLocalStorageItem, setLocalStorageItem } from '../utils/local-storage.util';

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
const V15_MIGRATION_OUTPUT_VERSION = 15;
const V16_MIGRATION_OUTPUT_VERSION = 16;
const V17_MIGRATION_OUTPUT_VERSION = 17;
const V18_MIGRATION_OUTPUT_VERSION = 18;
const V19_MIGRATION_OUTPUT_VERSION = 19;

/**
 * v17 -> v18 target shape for the wind-family widgets' swept paths, keyed by runtime widget `type`
 * then path key. Each entry pins the path's canonical value and whether it stays user-editable (a
 * choice slot: true, the select offers the alternatives) or becomes fixed (false, Data Source only).
 * `pathOptions` is base-sourced from DEFAULT_CONFIG, so the migration never writes it.
 */
const V18_WIND_PATH_DEFAULTS: Record<string, Record<string, { path: string; isPathConfigurable: boolean; description?: string }>> = {
  'widget-wind-steer': {
    headingPath: { path: 'self.navigation.headingTrue', isPathConfigurable: true, description: 'Heading' },
    appWindAngle: { path: 'self.environment.wind.angleApparent', isPathConfigurable: false },
    appWindSpeed: { path: 'self.environment.wind.speedApparent', isPathConfigurable: false },
    trueWindAngle: { path: 'self.environment.wind.angleTrueWater', isPathConfigurable: true, description: 'Wind Angle' },
    trueWindSpeed: { path: 'self.environment.wind.speedTrue', isPathConfigurable: false },
    courseOverGround: { path: 'self.navigation.courseOverGroundTrue', isPathConfigurable: true, description: 'Course Over Ground' },
    set: { path: 'self.environment.current.setTrue', isPathConfigurable: false },
    drift: { path: 'self.environment.current.drift', isPathConfigurable: false },
  },
  'widget-racesteer': {
    headingPath: { path: 'self.navigation.headingTrue', isPathConfigurable: true, description: 'Heading' },
    appWindAngle: { path: 'self.environment.wind.angleApparent', isPathConfigurable: false },
    appWindSpeed: { path: 'self.environment.wind.speedApparent', isPathConfigurable: false },
    trueWindAngle: { path: 'self.environment.wind.angleTrueWater', isPathConfigurable: true, description: 'Wind Angle' },
    trueWindSpeed: { path: 'self.environment.wind.speedTrue', isPathConfigurable: false },
    courseOverGround: { path: 'self.navigation.courseOverGroundTrue', isPathConfigurable: true, description: 'Course Over Ground' },
    nextWaypointBearing: { path: 'self.navigation.course.calcValues.bearingTrue', isPathConfigurable: false },
    set: { path: 'self.environment.current.setTrue', isPathConfigurable: false },
    drift: { path: 'self.environment.current.drift', isPathConfigurable: false },
  },
  'widget-windtrends-chart': {
    trueWindDirection: { path: 'self.environment.wind.directionTrue', isPathConfigurable: true, description: 'Wind Direction' },
    trueWindSpeed: { path: 'self.environment.wind.speedTrue', isPathConfigurable: false },
  },
};

// v18 -> v19: widget-autopilot's redundant top-level pickers. heading is governed by the
// autopilot.headingDirectionTrue toggle (not a picker) and apparent wind angle has no alternative, so
// these become fixed; windAngleTrueWater was configured but never observed (dead UI) and is removed.
// Paths are unchanged, so a pinned source stays valid and is kept.
const V19_AUTOPILOT_FIXED_SLOTS = ['headingMag', 'headingTrue', 'windAngleApparent'];
const V19_AUTOPILOT_REMOVED_SLOTS = ['windAngleTrueWater'];

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
    // A migration rewrites every config slot it touches. A session that cannot write would fail on
    // the first slot after reporting progress on it, so it must not start: the config it is viewing
    // is not its own to migrate.
    if (!this._storage.canPersist()) {
      console.warn('[Configuration Upgrade Service] Read-only session: skipping the configuration migration.');
      return;
    }
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

    } else if (version === 14) {
      // Remote (Signal K) configs. v14 slots live in the same active file version as v11/v12/v13.
      try {
        const configsList: Config[] = await this._storage.listConfigs(REMOTE_CONFIG_FILE_VERSION);

        for (const item of configsList) {
          try {
            const config = await this._storage.getConfig(item.scope, item.name, REMOTE_CONFIG_FILE_VERSION);
            this.pushMsg(`[Upgrade] ${item.scope}/${item.name} -> v${V15_MIGRATION_OUTPUT_VERSION}.`);
            const migratedConfig = this.migrateOneAppVersion(config, 14);
            if (!migratedConfig) continue; // skip if not a v14 slot

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

    } else if (version === 15) {
      // Remote (Signal K) configs. v15 slots live in the same active file version as v11..v14.
      try {
        const configsList: Config[] = await this._storage.listConfigs(REMOTE_CONFIG_FILE_VERSION);

        for (const item of configsList) {
          try {
            const config = await this._storage.getConfig(item.scope, item.name, REMOTE_CONFIG_FILE_VERSION);
            this.pushMsg(`[Upgrade] ${item.scope}/${item.name} -> v${V16_MIGRATION_OUTPUT_VERSION}.`);
            const migratedConfig = this.migrateOneAppVersion(config, 15);
            if (!migratedConfig) continue; // skip if not a v15 slot

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

    } else if (version === 16) {
      // Remote (Signal K) configs. v16 slots live in the same active file version as v11..v15.
      try {
        const configsList: Config[] = await this._storage.listConfigs(REMOTE_CONFIG_FILE_VERSION);

        for (const item of configsList) {
          try {
            const config = await this._storage.getConfig(item.scope, item.name, REMOTE_CONFIG_FILE_VERSION);
            this.pushMsg(`[Upgrade] ${item.scope}/${item.name} -> v${V17_MIGRATION_OUTPUT_VERSION}.`);
            const migratedConfig = this.migrateOneAppVersion(config, 16);
            if (!migratedConfig) continue; // skip if not a v16 slot

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

    } else if (version === 17) {
      // Remote (Signal K) configs. v17 slots live in the same active file version as v11..v16.
      try {
        const configsList: Config[] = await this._storage.listConfigs(REMOTE_CONFIG_FILE_VERSION);

        for (const item of configsList) {
          try {
            const config = await this._storage.getConfig(item.scope, item.name, REMOTE_CONFIG_FILE_VERSION);
            this.pushMsg(`[Upgrade] ${item.scope}/${item.name} -> v${V18_MIGRATION_OUTPUT_VERSION}.`);
            const migratedConfig = this.migrateOneAppVersion(config, 17);
            if (!migratedConfig) continue; // skip if not a v17 slot

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

    } else if (version === 18) {
      // Remote (Signal K) configs. v18 slots live in the same active file version as v11..v17.
      try {
        const configsList: Config[] = await this._storage.listConfigs(REMOTE_CONFIG_FILE_VERSION);

        for (const item of configsList) {
          try {
            const config = await this._storage.getConfig(item.scope, item.name, REMOTE_CONFIG_FILE_VERSION);
            this.pushMsg(`[Upgrade] ${item.scope}/${item.name} -> v${V19_MIGRATION_OUTPUT_VERSION}.`);
            const migratedConfig = this.migrateOneAppVersion(config, 18);
            if (!migratedConfig) continue; // skip if not a v18 slot

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

      const transformedApp = this.transformApp(localStorageConfig.app as unknown as IAppConfig);
      const transformedTheme = this.transformTheme(localStorageConfig.theme);
      const rootSplits = localStorageConfig.layout?.rootSplits || [];
      const splitSets = localStorageConfig.layout?.splitSets || [];
      const widgets = localStorageConfig.widget?.widgets || [];

      const dashboards: Dashboard[] = rootSplits.map((rootSplitUUID: string, i: number) => {
        const configuration = this.extractWidgetsFromSplitSets(splitSets, widgets, rootSplitUUID);
        return { id: rootSplitUUID, name: `Page ${i + 1}`, configuration };
      });

      this.migrateUseNeedleToEnableNeedle(dashboards);

      setLocalStorageItem(LOCAL_CONFIG_KEYS.appConfig, JSON.stringify(transformedApp));
      setLocalStorageItem(LOCAL_CONFIG_KEYS.dashboardsConfig, JSON.stringify(dashboards));
      setLocalStorageItem(LOCAL_CONFIG_KEYS.themeConfig, JSON.stringify(transformedTheme));
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
      setLocalStorageItem(LOCAL_CONFIG_KEYS.appConfig, JSON.stringify(localStorageConfig.app));
      setLocalStorageItem(LOCAL_CONFIG_KEYS.themeConfig, JSON.stringify(localStorageConfig.theme));
      removeLocalStorageItem(LOCAL_CONFIG_KEYS.widgetConfig);
      removeLocalStorageItem(LOCAL_CONFIG_KEYS.layoutConfig);
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
      throw new Error(`This configuration is version ${version}, which is newer than this version of Skip supports (version ${LATEST_APP_CONFIG_VERSION}). Update Skip and try again.`);
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
      case 14: return this.upgradeConfigV14toV15(config);
      case 15: return this.upgradeConfigV15toV16(config);
      case 16: return this.upgradeConfigV16toV17(config);
      case 17: return this.upgradeConfigV17toV18(config);
      case 18: return this.upgradeConfigV18toV19(config);
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
    const transformedApp = this.transformApp(config.app as unknown as IAppConfig);
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
   * v12 -> v13: retire the recorder's config footprint. The client-side graph recorder was removed,
   * so the app-level dataset registry and the per-widget `datasetUUID` / `chartEngine` fields it fed
   * are dead. Strip them and stamp v13. Genuine graph inputs (path/source/window/units) are untouched.
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

  /**
   * v14 -> v15 (#414): the position widget rendered latitude and longitude from two independently
   * configurable path entries. After the compound leaves stopped being flattened (#21) a numeric
   * path can no longer point at `navigation.position.latitude`/`.longitude`, and configuring the two
   * coordinates separately never made sense. Collapse a position widget's paths to a single
   * object-typed `positionPath` pointing at the whole `navigation.position` leaf; the widget reads
   * both coordinates off it. The whole `paths` object is replaced (not field-patched) so no stale
   * `longPath`/`latPath` siblings survive the runtime default-merge. Scoped to `widget-position`
   * only — a generic widget handed the whole object would render garbage.
   */
  private upgradeConfigV14toV15(config: IConfig): IConfig | null {
    try {
      const appConfig = config.app;
      if (!appConfig || appConfig.configVersion !== 14) {
        this.pushError(`[Upgrade Service] Config version ${appConfig?.configVersion} is not an upgradable v14 config. Skipping...`);
        return null;
      }

      let rewritten = 0;
      if (Array.isArray(config.dashboards)) {
        for (const dash of config.dashboards) {
          if (!dash || !Array.isArray(dash.configuration)) continue;
          for (const widget of dash.configuration) {
            const wp = (widget as { input?: { widgetProperties?: {
              type?: unknown;
              config?: { paths?: unknown };
            } } })?.input?.widgetProperties;
            if (!wp || wp.type !== 'widget-position') continue;
            const cfg = wp.config;
            if (!cfg || typeof cfg !== 'object') continue;
            // Preserve a user-pinned source / sampleTime from whichever legacy coordinate entry exists.
            const oldPaths = cfg.paths as Record<string, { source?: unknown; sampleTime?: unknown }> | undefined;
            const donor = oldPaths && typeof oldPaths === 'object'
              ? Object.values(oldPaths).find(p => p && typeof p === 'object')
              : undefined;
            cfg.paths = {
              positionPath: {
                description: 'Position',
                path: 'self.navigation.position',
                source: typeof donor?.source === 'string' ? donor.source : 'default',
                pathType: 'object',
                isPathConfigurable: true,
                showPathSkUnitsFilter: false,
                pathSkUnitsFilter: null,
                sampleTime: typeof donor?.sampleTime === 'number' ? donor.sampleTime : 500
              }
            };
            rewritten++;
          }
        }
      }
      if (rewritten) {
        this.pushMsg(`[Upgrade] Collapsed ${rewritten} position widget(s) to a single location path.`);
      }

      appConfig.configVersion = V15_MIGRATION_OUTPUT_VERSION;
      return { app: appConfig, theme: config.theme, dashboards: config.dashboards };
    } catch (error) {
      this.pushError(`[Upgrade Service] Error upgrading v14->v15: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * v15 -> v16 (#416): widgets whose paths are all fixed (heel-gauge, horizon, racer-timer,
   * racer-line) no longer show the widget-settings Paths tab — with it goes the data-timeout
   * control, so those widgets default to a 5 s data timeout instead. heel-gauge/horizon additionally
   * carried a stranded dead path picker (a stored entry left at `pathType: 'number'` +
   * `isPathConfigurable: true`, which a number picker can't resolve against the object leaf — the
   * bug #414 fixed for position; the v14->v15 step only rewrote position). This enables the timeout
   * on all four types and, for the two attitude widgets, resets every path entry to its canonical
   * fixed shape (`self.navigation.attitude`, `pathType: 'number'` so the pipeline's sub-field extract
   * + rad->deg conversion still runs, `isPathConfigurable: false`, `convertUnitTo: 'deg'`), discarding
   * stale stored overrides. Racer paths are already scalar/fixed, so only their timeout changes.
   */
  private upgradeConfigV15toV16(config: IConfig): IConfig | null {
    try {
      const appConfig = config.app;
      if (!appConfig || appConfig.configVersion !== 15) {
        this.pushError(`[Upgrade Service] Config version ${appConfig?.configVersion} is not an upgradable v15 config. Skipping...`);
        return null;
      }

      const ATTITUDE_WIDGET_TYPES = new Set(['widget-heel-gauge', 'widget-horizon']);
      // All-fixed-path widgets whose Paths tab (and its timeout control) is now suppressed.
      const TIMEOUT_DEFAULT_WIDGET_TYPES = new Set([
        'widget-heel-gauge', 'widget-horizon', 'widget-racer-timer', 'widget-racer-line'
      ]);
      let rewritten = 0;
      if (Array.isArray(config.dashboards)) {
        for (const dash of config.dashboards) {
          if (!dash || !Array.isArray(dash.configuration)) continue;
          for (const widget of dash.configuration) {
            const wp = (widget as { input?: { widgetProperties?: {
              type?: unknown;
              config?: { paths?: unknown; enableTimeout?: boolean; dataTimeout?: number };
            } } })?.input?.widgetProperties;
            if (!wp || typeof wp.type !== 'string' || !TIMEOUT_DEFAULT_WIDGET_TYPES.has(wp.type) || !wp.config) continue;
            if (ATTITUDE_WIDGET_TYPES.has(wp.type)) {
              const paths = wp.config.paths;
              if (paths && typeof paths === 'object') {
                for (const pathCfg of Object.values(paths as Record<string, Record<string, unknown>>)) {
                  if (!pathCfg || typeof pathCfg !== 'object') continue;
                  // Discard stale overrides — the fixed attitude path is not user-configurable.
                  pathCfg.path = 'self.navigation.attitude';
                  pathCfg.pathType = 'number';
                  pathCfg.isPathConfigurable = false;
                  pathCfg.convertUnitTo = 'deg';
                  rewritten++;
                }
              }
            }
            // The Paths tab (and its timeout control) is gone — default the timeout on.
            wp.config.enableTimeout = true;
            wp.config.dataTimeout = 5;
          }
        }
      }
      if (rewritten) {
        this.pushMsg(`[Upgrade] Reset ${rewritten} attitude path(s) to the fixed hidden default.`);
      }

      appConfig.configVersion = V16_MIGRATION_OUTPUT_VERSION;
      return { app: appConfig, theme: config.theme, dashboards: config.dashboards };
    } catch (error) {
      this.pushError(`[Upgrade Service] Error upgrading v15->v16: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * v16 -> v17: the per-path `sampleTime` display-cadence field is replaced by a single widget-level
   * `updateInterval` (ms). For every path-bearing widget, collapse its paths' sampleTimes to one
   * value (the minimum — the most responsive) and delete the per-path field. Widgets without paths
   * are left untouched (they have no cadence to carry).
   */
  private upgradeConfigV16toV17(config: IConfig): IConfig | null {
    try {
      const appConfig = config.app;
      if (!appConfig || appConfig.configVersion !== 16) {
        this.pushError(`[Upgrade Service] Config version ${appConfig?.configVersion} is not an upgradable v16 config. Skipping...`);
        return null;
      }

      let rewritten = 0;
      if (Array.isArray(config.dashboards)) {
        for (const dash of config.dashboards) {
          if (!dash || !Array.isArray(dash.configuration)) continue;
          for (const widget of dash.configuration) {
            const wp = (widget as { input?: { widgetProperties?: {
              config?: { paths?: unknown; updateInterval?: number };
            } } })?.input?.widgetProperties;
            const cfg = wp?.config;
            if (!cfg || !cfg.paths || typeof cfg.paths !== 'object') continue;
            const sampleTimes: number[] = [];
            for (const pathCfg of Object.values(cfg.paths as Record<string, Record<string, unknown>>)) {
              if (!pathCfg || typeof pathCfg !== 'object') continue;
              const st = pathCfg['sampleTime'];
              if (typeof st === 'number' && Number.isFinite(st) && st > 0) sampleTimes.push(st);
              delete pathCfg['sampleTime'];
            }
            cfg.updateInterval = sampleTimes.length ? Math.min(...sampleTimes) : DEFAULT_WIDGET_UPDATE_INTERVAL_MS;
            rewritten++;
          }
        }
      }
      if (rewritten) {
        this.pushMsg(`[Upgrade] Collapsed per-path sampleTime to a widget-level updateInterval on ${rewritten} widget(s).`);
      }

      appConfig.configVersion = V17_MIGRATION_OUTPUT_VERSION;
      return { app: appConfig, theme: config.theme, dashboards: config.dashboards };
    } catch (error) {
      this.pushError(`[Upgrade Service] Error upgrading v16->v17: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * v17 -> v18: slim the wind-family widgets' path config. Reset each swept path (keyed by widget
   * type via V18_WIND_PATH_DEFAULTS) to its canonical path + fixed/choice editability + a default
   * source, discarding stored overrides (escape-hatch loss accepted). Keys are unchanged, so a
   * field-patch is safe; pathOptions is base-sourced from DEFAULT_CONFIG and is not written here.
   */
  private upgradeConfigV17toV18(config: IConfig): IConfig | null {
    try {
      const appConfig = config.app;
      if (!appConfig || appConfig.configVersion !== 17) {
        this.pushError(`[Upgrade Service] Config version ${appConfig?.configVersion} is not an upgradable v17 config. Skipping...`);
        return null;
      }

      let rewritten = 0;
      if (Array.isArray(config.dashboards)) {
        for (const dash of config.dashboards) {
          if (!dash || !Array.isArray(dash.configuration)) continue;
          for (const widget of dash.configuration) {
            const wp = (widget as { input?: { widgetProperties?: {
              type?: unknown;
              config?: { paths?: unknown };
            } } })?.input?.widgetProperties;
            if (!wp || typeof wp.type !== 'string') continue;
            const targets = V18_WIND_PATH_DEFAULTS[wp.type];
            const paths = wp.config?.paths;
            if (!targets || !paths || typeof paths !== 'object') continue;
            const pathMap = paths as Record<string, Record<string, unknown>>;
            for (const [key, target] of Object.entries(targets)) {
              const pathCfg = pathMap[key];
              if (!pathCfg || typeof pathCfg !== 'object') continue;
              pathCfg['path'] = target.path;
              pathCfg['isPathConfigurable'] = target.isPathConfigurable;
              if (target.description !== undefined) pathCfg['description'] = target.description;
              // Reset the source pin too: a pin left over from the pre-reset path can point at a
              // source bucket the new canonical path never fills, silently starving the widget.
              pathCfg['source'] = 'default';
              rewritten++;
            }
          }
        }
      }
      if (rewritten) {
        this.pushMsg(`[Upgrade] Reset ${rewritten} wind-family path(s) to the fixed/choice default.`);
      }

      appConfig.configVersion = V18_MIGRATION_OUTPUT_VERSION;
      return { app: appConfig, theme: config.theme, dashboards: config.dashboards };
    } catch (error) {
      this.pushError(`[Upgrade Service] Error upgrading v17->v18: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * v18 -> v19: slim widget-autopilot's path config. Make its redundant top-level pickers fixed
   * (heading is governed by the autopilot.headingDirectionTrue toggle, not a path picker; apparent
   * wind angle has no alternative) and DELETE the never-observed windAngleTrueWater slot. Paths are
   * unchanged, so a pinned source stays valid and is kept. The dead slot is deleted outright because
   * the runtime base+user merge would otherwise resurrect a stored orphan key.
   */
  private upgradeConfigV18toV19(config: IConfig): IConfig | null {
    try {
      const appConfig = config.app;
      if (!appConfig || appConfig.configVersion !== 18) {
        this.pushError(`[Upgrade Service] Config version ${appConfig?.configVersion} is not an upgradable v18 config. Skipping...`);
        return null;
      }

      let changed = 0;
      if (Array.isArray(config.dashboards)) {
        for (const dash of config.dashboards) {
          if (!dash || !Array.isArray(dash.configuration)) continue;
          for (const widget of dash.configuration) {
            const wp = (widget as { input?: { widgetProperties?: {
              type?: unknown;
              config?: { paths?: unknown };
            } } })?.input?.widgetProperties;
            if (!wp || wp.type !== 'widget-autopilot') continue;
            const paths = wp.config?.paths;
            if (!paths || typeof paths !== 'object') continue;
            const pathMap = paths as Record<string, Record<string, unknown>>;
            for (const slot of V19_AUTOPILOT_FIXED_SLOTS) {
              if (pathMap[slot] && typeof pathMap[slot] === 'object') {
                pathMap[slot]['isPathConfigurable'] = false;
                changed++;
              }
            }
            for (const slot of V19_AUTOPILOT_REMOVED_SLOTS) {
              if (slot in pathMap) {
                delete pathMap[slot];
                changed++;
              }
            }
          }
        }
      }
      if (changed) {
        this.pushMsg(`[Upgrade] Slimmed ${changed} autopilot path field(s).`);
      }

      appConfig.configVersion = V19_MIGRATION_OUTPUT_VERSION;
      return { app: appConfig, theme: config.theme, dashboards: config.dashboards };
    } catch (error) {
      this.pushError(`[Upgrade Service] Error upgrading v18->v19: ${(error as Error).message}`);
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
