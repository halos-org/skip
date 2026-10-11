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
import { removeLocalStorageItem, setLocalStorageItem } from '../utils/local-storage.util';
import {
  MIGRATION_OUTPUT_VERSION,
  MigrationMessageSink,
  migrateOneAppVersion,
  migrateUseNeedleToEnableNeedle,
  removeSplitShellConfigKeys
} from '../utils/config-migration.util';

// Upgrades the stored config slots in place: the legacy migration (remote file version 9 /
// app-config version 10) and the chained per-version steps from config-migration.util, reporting
// progress through the messages signal for the upgrade overlay.

/**
 * Lowest app-config version of a stored slot that the chained upgrade migrates. Skip's own config
 * namespace started at v12, so no Skip wrote a v11 slot; v11 configs reach Skip only as imports,
 * which the in-memory chain migrates.
 */
export const MIN_UPGRADABLE_SLOT_VERSION = 12;

@Injectable({ providedIn: 'root' })
export class ConfigurationUpgradeService {
  private _storage = inject(StorageService);
  private _settings = inject(SettingsService);

  // Signals/state for UI binding if desired
  public upgrading = signal<boolean>(false);
  public error = signal<string | null>(null);
  public messages = signal<string[]>([]);

  private readonly sink: MigrationMessageSink = {
    info: message => this.pushMsg(message)
  };

  // Source versions we support upgrading FROM (remote file version & app.configVersion).
  // Upgrades target MIGRATION_OUTPUT_VERSION.
  private readonly legacyFileVersion = 9;
  private readonly legacyConfigVersion = 10;
  // Holds each slot as it was at app-config v19, before the first step that converts stored numbers
  // to SI: a Skip older than v20 reads those numbers in display units, so a downgrade restores from here.
  private readonly v19BackupFileVersion = 19.99;

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
   * await this.upgradeService.runUpgrade(19);
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
        // Clear the blocking overlay so the error is visible, matching the chained upgrade.
        this.upgrading.set(false);
      }

    } else if (version >= MIN_UPGRADABLE_SLOT_VERSION && version < LATEST_APP_CONFIG_VERSION) {
      await this.upgradeRemoteSlots(version);

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

      migrateUseNeedleToEnableNeedle(dashboards, this.sink);

      setLocalStorageItem(LOCAL_CONFIG_KEYS.appConfig, JSON.stringify(transformedApp));
      setLocalStorageItem(LOCAL_CONFIG_KEYS.dashboardsConfig, JSON.stringify(dashboards));
      setLocalStorageItem(LOCAL_CONFIG_KEYS.themeConfig, JSON.stringify(transformedTheme));
      setTimeout(() => this._settings.reloadApp(), 1500);
      this.upgrading.set(false);
    }
  }

  /**
   * One chained step, from `version` to the next, over every slot at `version` in the active file
   * version, then a reload. A slot at another version is left for the upgrade that matches it. A
   * failed slot listing clears the overlay without reloading, so the upgrade retries on the next boot.
   * A v19 slot is backed up before it is converted; one whose backup fails stays at v19, and when
   * that is the active slot there is no reload, since it would run this upgrade again at once.
   */
  private async upgradeRemoteSlots(version: number): Promise<void> {
    try {
      const configsList: Config[] = await this._storage.listConfigs(REMOTE_CONFIG_FILE_VERSION);
      let activeHeldBack = false;

      for (const item of configsList) {
        try {
          const config = await this._storage.getConfig(item.scope, item.name, REMOTE_CONFIG_FILE_VERSION);
          if (config?.app?.configVersion !== version) continue;
          if (version === 19 && !await this.backUpV19Once(item, config)) {
            activeHeldBack ||= item.scope === 'user' && item.name === this._storage.sharedConfigName;
            continue;
          }
          this.pushMsg(`[Upgrade] ${item.scope}/${item.name} -> v${version + 1}.`);
          const migratedConfig = migrateOneAppVersion(config, version, this.sink);

          await this._storage.setConfig(item.scope, item.name, migratedConfig);
        } catch (error) {
          this.pushError(`[Upgrade] Error upgrading ${item.scope}/${item.name}: ${(error as Error).message}`);
        }
      }
      if (activeHeldBack) {
        this.upgrading.set(false);
        return;
      }
      this.pushMsg(`[Upgrade] Reloading app to finalize upgrade...`);
      setTimeout(() => this._settings.reloadApp(), 1500);
    } catch (error) {
      this.pushError('Error fetching configuration data. Aborting upgrade. Details: ' + (error as Error).message);
      this.upgrading.set(false);
    }
  }

  /**
   * Saves a slot's v19 config to the backup file version unless a backup is already there, so a
   * rerun of the upgrade cannot overwrite the original with converted numbers. Returns whether the
   * slot may be upgraded: false when the backup location could not be read or written, in which
   * case the slot stays at v19 and the upgrade retries on the next boot.
   */
  private async backUpV19Once(item: Config, config: IConfig): Promise<boolean> {
    try {
      const existing = await this._storage.getConfig(item.scope, item.name, this.v19BackupFileVersion);
      // A slot never written can also come back as an appless 200, which means "none" as a 404 does.
      if (existing?.app) return true;
    } catch (error) {
      if ((error as { status?: number })?.status !== 404) {
        this.pushError(`[Upgrade] Cannot read the backup of ${item.scope}/${item.name}; leaving it at version 19. Details: ${(error as Error).message}`);
        return false;
      }
    }
    try {
      this.pushMsg(`[Upgrade] Saving configuration backup to file ${item.scope}/${item.name}...`);
      await this._storage.setConfig(item.scope, item.name, cloneDeep(config), this.v19BackupFileVersion);
      return true;
    } catch (error) {
      this.pushError(`[Upgrade] Cannot save the backup of ${item.scope}/${item.name}; leaving it at version 19. Details: ${(error as Error).message}`);
      return false;
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
    migrateUseNeedleToEnableNeedle(dashboards, this.sink);
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
    removeSplitShellConfigKeys(clone);
    return clone;
  }

  private transformTheme(theme: v10IThemeConfig): IThemeConfig | null {
    if (!theme) return null;
    const themeConfig: IThemeConfig = { themeName: '' };
    return themeConfig;
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
