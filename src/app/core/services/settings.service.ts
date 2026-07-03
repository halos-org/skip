import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable, filter } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { cloneDeep } from 'lodash-es';

import { IDatasetServiceDatasetConfig } from '../interfaces/dataset.interfaces';
import { IUnitDefaults } from './units.service';
import { UUID } from '../utils/uuid.util';

import { IConfig, IAppConfig, IConnectionConfig, IThemeConfig, INotificationConfig, ISignalKUrl, CONNECTION_CONFIG_VERSION, SUPPORTED_CONNECTION_CONFIG_VERSIONS } from "../interfaces/app-settings.interfaces";
import { DefaultAppConfig, DefaultConnectionConfig as DefaultConnectionConfig, DefaultThemeConfig } from '../../../default-config/config.blank.const';
import { DefaultUnitsConfig } from '../../../default-config/config.blank.units.const'
import { DefaultNotificationConfig } from '../../../default-config/config.blank.notification.const';
import { DemoAppConfig, DemoThemeConfig, DemoDashboardsConfig } from '../../../default-config/config.demo.const';
import { MatSnackBar } from '@angular/material/snack-bar';

import { StorageService } from './storage.service';
import { Dashboard } from './dashboard.service';
import { LOCAL_CONFIG_KEYS, localConfigKey } from '../constants/config-storage.const';


const defaultTheme = '';
const configFileVersion = 11; // used to change the Signal K configuration storage file name (ie. 9.0.0.json) that contains the configuration definitions. Applies only to remote storage. Local storage has no file concept.
const latestConfigVersion = 12; // used to set the configVersion property in the app config. This is used to manage config upgrades.
@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly storage = inject(StorageService);
  private readonly snackBar = inject(MatSnackBar);

  private unitDefaults: BehaviorSubject<IUnitDefaults> = new BehaviorSubject<IUnitDefaults>({});
  private themeName: BehaviorSubject<string> = new BehaviorSubject<string>(defaultTheme);
  private kipKNotificationConfig: BehaviorSubject<INotificationConfig> = new BehaviorSubject<INotificationConfig>(DefaultNotificationConfig);
  private autoNightMode: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private redNightMode: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private nightModeBrightness: BehaviorSubject<number> = new BehaviorSubject<number>(1);
  private isRemoteControl: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private instanceName: BehaviorSubject<string> = new BehaviorSubject<string>('');
  private browserTabTitle: BehaviorSubject<string> = new BehaviorSubject<string>('SKip');

  public proxyEnabled = false;
  public signalKSubscribeAll = false;
  private sharedConfigName = 'default';
  // True once the user explicitly changes the remote-control identity this session; until then a
  // connection write preserves the stored (possibly migration-written) identity rather than the
  // in-memory default loaded before the migration ran.
  private connectionIdentityDirty = false;
  private activeConfig: IConfig = { app: null, theme: null, dashboards: [] };

  private kipUUID = '';
  public signalkUrl: ISignalKUrl | undefined;
  private _dashboards: Dashboard[] = [];
  private dataSets: IDatasetServiceDatasetConfig[] = [];
  public configUpgrade = signal<boolean>(false);
  private configVersion: number | undefined; // store actual config version from config version property in config
  private disablePathValidation = false; // used to disable path validation in path control component in widget options.

  constructor() {
    console.log("[AppSettings Service] Service startup...");
    this.storage.activeConfigFileVersion = configFileVersion;

    // Routine saves go through the fire-and-forget patchConfig queue, so a failed server write is
    // otherwise invisible: the setting applies in memory but reverts on the next reload. Surface it.
    this.storage.patchFailure$
      .pipe(
        // A read-only session (no SK write scope) returns 401/403 on every save — expected, not a
        // fault — so it must not raise the alarming persistent toast; only genuine failures do.
        filter(({ error }) => !(error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403))),
        takeUntilDestroyed()
      )
      .subscribe(() => this.snackBar.open(
        'Problem saving configuration to the server. Resolve this issue before KIP can be used reliably.',
        'Close',
        {
          duration: 0,
          verticalPosition: 'top'
        }
      ));

    if (!window.localStorage) {
      // REQUIRED BY APP - localStorage support
      console.error("[AppSettings Service] LocalStorage NOT SUPPORTED by browser\nThis is a requirement to run Kip. See browser documentation to enable this feature.");

    } else {
      this.loadConnectionConfig();
      this.startup();
    }
  }

  private async startup(): Promise<void> {
    // A missing server config comes back as {} (not a 404), so guard on the presence of app config —
    // an empty/appless object must not fall through to pushSettings() and dereference activeConfig.app.
    if (!this.storage.isRemoteContextBootstrapped() || !this.storage.initConfig?.app) {
      console.warn('[AppSettings Service] Shared configuration enabled but remote bootstrap handoff is missing or empty. Waiting for explicit recovery action.');
      return;
    }

    this.configVersion = this.storage.initConfig?.app?.configVersion;
    this.checkConfigUpgradeRequired(false, this.storage.initConfig?.app?.configVersion);
    this.activeConfig = this.storage.initConfig;
    this.pushSettings();
  }

  private loadConnectionConfig(): void {
    const config :IConnectionConfig = this.loadConfigFromLocalStorage("connectionConfig");

    switch (config.configVersion) {
      case 11:
      case 12:
      case 13:
        break;
      default:
        console.error(`[AppSettings Service] Invalid connectionConfig version ${config.configVersion}. Resetting and loading connection configuration default`);
        this.resetConnection();
        break;
    }

    this.signalkUrl = {url: config.signalKUrl, new: false};
    this.proxyEnabled = config.proxyEnabled;
    this.signalKSubscribeAll = config.signalKSubscribeAll;
    this.sharedConfigName = config.sharedConfigName;
    this.kipUUID = config.kipUUID;

    // Idempotent purge: strip legacy credential fields (plaintext password, login name, device-token
    // flag) persisted by an older version. Targeted rewrite preserves all other fields exactly.
    const legacyCredentialKeys = ['loginPassword', 'loginName', 'useDeviceToken'];
    const rawConfig = config as unknown as Record<string, unknown>;
    if (legacyCredentialKeys.some(key => Object.prototype.hasOwnProperty.call(config, key))) {
      for (const key of legacyCredentialKeys) {
        delete rawConfig[key];
      }
      localStorage.setItem(LOCAL_CONFIG_KEYS.connectionConfig, JSON.stringify(config));
    }

    // Also drop the legacy top-level session/device token blob. Nothing reads it anymore (auth is
    // session-cookie only), so leaving it would strand a still-server-valid bearer credential —
    // often a never-expiring device token — at rest.
    localStorage.removeItem('authorization_token');

    // Remote-control identity is per-device: read from connectionConfig, not the profile.
    this.isRemoteControl.next(config.isRemoteControl ?? false);
    this.instanceName.next(config.instanceName ?? '');
  }

  public resetConnection() {
    localStorage.setItem(LOCAL_CONFIG_KEYS.connectionConfig, JSON.stringify(this.getDefaultConnectionConfig()));
    this.reloadApp();
  }

  private checkConfigUpgradeRequired(isLocalStorageConfig: boolean, storageVersion?: number): void {
    if (storageVersion !== latestConfigVersion) {
      this.configUpgrade.set(true);
    }
  }

  /**
   * Get configuration from local browser storage rather then in
   * memory running config.
   *
   * @param {string} type Possible choices are: appConfig, dashboardsConfig, themeConfig, connectionConfig or older v2 if they are present widgetConfig, layoutConfig, themeConfig, zonesConfig, connectionConfig.
   * @return {*}
   * @memberof SettingsService
   */
  public loadConfigFromLocalStorage(type: string) {
    let config = JSON.parse(localStorage.getItem(localConfigKey(type)) ?? 'null');

    if (config === null) {
      console.log(`[AppSettings Service] Error loading ${type} config. Force loading ${type} defaults`);
      switch (type) {
        case "appConfig":
          config = this.getDefaultAppConfig();
          break;

        case "connectionConfig":
          config = this.getDefaultConnectionConfig();
          break;

        case "dashboardsConfig":
          config = this.getDefaultDashboardsConfig();
          break;

        case "themeConfig":
          config = this.getDefaultThemeConfig();
          break;

        default:
          console.error(`[AppSettings Service] Invalid ${type} default config requested`);
          break;
      }
    }

    if(type === 'connectionConfig') {
      if (!SUPPORTED_CONNECTION_CONFIG_VERSIONS.includes(config.configVersion)) {
        console.log(`[AppSettings Service] Invalid ${type} version. Force loading defaults`);

        switch (type) {
          case "connectionConfig":
            config = this.getDefaultConnectionConfig();
            break;
        }
      }
    }

    return config;
  }

  private pushSettings(): void {
    if (this.activeConfig.theme) {
      this.themeName.next(this.activeConfig.theme.themeName);
    }
    this.dataSets = this.activeConfig.app.dataSets;
    this.unitDefaults.next(this.activeConfig.app.unitDefaults);
    this.kipKNotificationConfig.next(this.activeConfig.app.notificationConfig);

    if (this.activeConfig.app.autoNightMode === undefined) {
      this.setAutoNightMode(false);
    } else {
      this.autoNightMode.next(this.activeConfig.app.autoNightMode);
    }

    if (this.activeConfig.app.redNightMode === undefined) {
      this.setRedNightMode(false);
    } else {
      this.redNightMode.next(this.activeConfig.app.redNightMode);
    }

    if (this.activeConfig.app.nightModeBrightness === undefined) {
      this.setNightModeBrightness(0.2);
    } else {
      this.nightModeBrightness.next(this.activeConfig.app.nightModeBrightness);
    }

    if (this.activeConfig.dashboards === undefined) {
      this._dashboards = [];
    } else {
      this._dashboards = this.activeConfig.dashboards;
    }

    if (this.activeConfig.app.browserTabTitle === undefined) {
      this.browserTabTitle.next('SKip');
    } else {
      this.browserTabTitle.next(this.activeConfig.app.browserTabTitle);
    }
  }

  //UnitDefaults
  public getDefaultUnitsAsO() {
    return this.unitDefaults.asObservable();
  }
  public getDefaultUnits() {
    return this.unitDefaults.getValue();
  }
  public setDefaultUnits(newDefaults: IUnitDefaults) {
    this.unitDefaults.next(newDefaults);
    this.storage.patchConfig('Array<IUnitDefaults>', newDefaults);
  }

  // Configuration version
  public getConfigVersion(): number | undefined {
    return this.activeConfig.app?.configVersion ?? undefined;
  }

  // App config - use by Settings Config Component
  public getAppConfig(): IAppConfig {
    return this.buildAppStorageObject();
  }

  public getConnectionConfig(): IConnectionConfig {
    return this.buildConnectionStorageObject();
  }

  public setConnectionConfig(value: IConnectionConfig) {
    this.proxyEnabled = value.proxyEnabled;
    this.signalKSubscribeAll = value.signalKSubscribeAll;
    if (this.signalkUrl) {
      this.signalkUrl.url = value.signalKUrl;
    }
    this.saveConnectionConfigToLocalStorage();
  }

  public getDashboardConfig(): Dashboard[] {
    return this.buildDashboardStorageObject();
  }

  public getThemeConfig(): IThemeConfig {
    return this.buildThemeStorageObject();
  }

  // --- Active profile (named config slot) ---
  public getActiveProfileName(): string {
    return this.sharedConfigName;
  }

  /**
   * Points this device at a different profile (named config slot) and reloads so the bootstrap
   * loads it. The active profile is per-device: persisted in the always-local connectionConfig.
   *
   * @param {string} name Profile (config slot) name to make active on this device.
   */
  public setActiveProfile(name: string): void {
    this.sharedConfigName = name;
    this.storage.sharedConfigName = name; // keep the storage write-path slot name coherent
    this.saveConnectionConfigToLocalStorage();
    this.reloadApp();
  }

  public get KipUUID(): string {
    return this.kipUUID;
  }

  // Themes
  public getThemeNameAsO() {
    return this.themeName.asObservable();
  }

  public setThemeName(newTheme: string) {
    this.themeName.next(newTheme);
    const theme: IThemeConfig = {
      themeName: newTheme
    }
    this.storage.patchConfig('IThemeConfig', theme)
  }

  public getThemeName(): string {
    return this.themeName.getValue();;
  }

  // Auto night mode
  public getAutoNightModeAsO() {
    return this.autoNightMode.asObservable();
  }

  public setAutoNightMode(enabled: boolean) {
    this.autoNightMode.next(enabled);
    const appConf = this.buildAppStorageObject();
    this.storage.patchConfig('IAppConfig', appConf);
  }

  public getAutoNightMode(): boolean {
    return this.autoNightMode.getValue();
  }

  // Red night mode
  public getRedNightModeAsO() {
    return this.redNightMode.asObservable();
  }

  public getRedNightMode(): boolean {
    return this.redNightMode.getValue();
  }

  public setRedNightMode(enabled: boolean) {
    this.redNightMode.next(enabled);
    const appConf = this.buildAppStorageObject();
    this.storage.patchConfig('IAppConfig', appConf);
  }

  // isRemoteControl mode
  public getIsRemoteControlAsO() {
    return this.isRemoteControl.asObservable();
  }

  public getIsRemoteControl(): boolean {
    return this.isRemoteControl.getValue();
  }

  public setIsRemoteControl(enabled: boolean) {
    this.isRemoteControl.next(enabled);
    this.connectionIdentityDirty = true;
    // Remote-control identity is per-device: persist to connectionConfig, never the profile.
    this.saveConnectionConfigToLocalStorage();
  }

  // Remote Control Instance Name
  public getInstanceNameAsO() {
    return this.instanceName.asObservable();
  }

  public getInstanceName(): string {
    return this.instanceName.getValue();
  }

  public setInstanceName(name: string) {
    this.instanceName.next(name);
    this.connectionIdentityDirty = true;
    // Remote-control identity is per-device: persist to connectionConfig, never the profile.
    this.saveConnectionConfigToLocalStorage();
  }

  // Browser tab title (document.title)
  public getBrowserTabTitleAsO() {
    return this.browserTabTitle.asObservable();
  }

  public getBrowserTabTitle(): string {
    return this.browserTabTitle.getValue();
  }

  public setBrowserTabTitle(title: string) {
    // Trim before storing so a padded/whitespace-only value isn't persisted (the resolver already
    // trims for display; this keeps the saved config clean and blank values normalized to '').
    this.browserTabTitle.next((title ?? '').trim());
    const appConf = this.buildAppStorageObject();
    this.storage.patchConfig('IAppConfig', appConf);
  }

  public getDisablePathValidation(): boolean {
    return this.disablePathValidation;
  }

  public setDisablePathValidation(disable: boolean) {
    this.disablePathValidation = disable;
  }

  public getNightModeBrightness(): number {
    return this.nightModeBrightness.getValue();
  }

  public setNightModeBrightness(brightness: number): void {
    this.nightModeBrightness.next(brightness);
    const appConf = this.buildAppStorageObject();
    this.storage.patchConfig('IAppConfig', appConf);
  }

  public saveDashboards(dashboards: Dashboard[]) {
    if (this.storage.storageServiceReady$.getValue()) {
      this.storage.patchConfig('Dashboards', dashboards);
    }
    this._dashboards = dashboards;
  }

  // DataSets
  public saveDataSets(dataSets: IDatasetServiceDatasetConfig[]) {
    this.dataSets = dataSets;
    this.storage.patchConfig('Array<IDatasetDef>', dataSets);
  }
  public getDataSets() {
    return this.dataSets;
  }

  // Notification Service Setting
  public getNotificationServiceConfigAsO(): Observable<INotificationConfig> {
    return this.kipKNotificationConfig.asObservable();
  }
  public getNotificationConfig(): INotificationConfig {
    return this.kipKNotificationConfig.getValue();
  }
  public setNotificationConfig(notificationConfig: INotificationConfig) {
    this.kipKNotificationConfig.next(notificationConfig);
    this.storage.patchConfig('INotificationConfig', notificationConfig);
  }

  //Config manipulation: RAW and SignalK server - used by Settings Config Component
  public resetSettings() {

    const newDefaultConfig: IConfig = { app: null, theme: null, dashboards: [] };
    newDefaultConfig.app = this.getDefaultAppConfig();
    newDefaultConfig.theme = this.getDefaultThemeConfig();
    newDefaultConfig.dashboards = this.getDefaultDashboardsConfig();

    if (this.storage.storageServiceReady$.getValue()) {
      this.storage.setConfig('user', this.sharedConfigName, newDefaultConfig)
        .then(() => {
          console.log("[AppSettings Service] Replaced server config name: " + this.sharedConfigName + ", with default configuration values");
          this.reloadApp();
        })
        .catch(error => {
          console.error("[AppSettings Service] Error replacing server config name: " + this.sharedConfigName + ", with default configuration values", error);
          this.snackBar.open(
            'Problem saving configuration to the server. Resolve this issue before KIP can be used reliably.',
            'Close',
            {
              duration: 0,
              verticalPosition: 'top'
            }
          );
        });
    }
  }

  public loadDemoConfig() {
    if (!this.storage.storageServiceReady$.getValue()) {
      console.warn("[AppSettings Service] Storage not ready; cannot load demo configuration.");
      return;
    }
    const demoConfig: IConfig = {
      app: DemoAppConfig,
      dashboards: DemoDashboardsConfig,
      theme: DemoThemeConfig
    };
    console.log("[AppSettings Service] Loading Demo configuration settings to the server and reloading app.");
    // Wait for the server write to land before reloading; reloading mid-request
    // aborts the POST and leaves the previous configuration in place. Storage
    // readiness is already guaranteed by the guard above.
    this.storage.setConfig('user', this.sharedConfigName, demoConfig)
      .then(() => {
        this.reloadApp();
      })
      .catch(error => {
        console.error("[AppSettings Service] Error saving demo configuration to the server", error);
        this.snackBar.open(
          'Problem saving configuration to the server. Resolve this issue before KIP can be used reliably.',
          'Close',
          {
            duration: 0,
            verticalPosition: 'top'
          }
        );
      });
  }

  public reloadApp() {
    console.log("[AppSettings Service] Reload app");
    // Prevent hard navigation in unit tests (breaks Karma)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).__KIP_TEST__) {
      return; // no-op
    }
    location.replace("./");
  }

  // builds config data oject from running data
  private buildAppStorageObject() {

    const storageObject: IAppConfig = {
      configVersion: this.configVersion ?? latestConfigVersion,
      autoNightMode: this.autoNightMode.getValue(),
      redNightMode: this.redNightMode.getValue(),
      nightModeBrightness: this.nightModeBrightness.getValue(),
      dataSets: this.dataSets,
      unitDefaults: this.unitDefaults.getValue(),
      notificationConfig: this.kipKNotificationConfig.getValue(),
      browserTabTitle: this.browserTabTitle.getValue()
    }
    return storageObject;
  }

  private buildConnectionStorageObject() {
    const stored = this.readStoredConnectionConfig();
    const storageObject: IConnectionConfig = {
      // Preserve the stored connectionConfig version; only the one-time migration in
      // AppNetworkInitService advances it. Stamping the latest here would prematurely mark the
      // migration done and lose the not-yet-lifted remote-control identity.
      configVersion: stored?.configVersion ?? CONNECTION_CONFIG_VERSION,
      kipUUID: this.kipUUID,
      signalKUrl: this.signalkUrl?.url ?? '',
      proxyEnabled: this.proxyEnabled,
      signalKSubscribeAll: this.signalKSubscribeAll,
      sharedConfigName: this.sharedConfigName,
      // Preserve the stored (possibly migration-written) identity unless the user changed it this
      // session, so a connection write around the migration cannot revert the lifted value.
      isRemoteControl: this.connectionIdentityDirty ? this.isRemoteControl.getValue() : (stored?.isRemoteControl ?? this.isRemoteControl.getValue()),
      instanceName: this.connectionIdentityDirty ? this.instanceName.getValue() : (stored?.instanceName ?? this.instanceName.getValue())
    }
    return storageObject;
  }

  private readStoredConnectionConfig(): Partial<IConnectionConfig> | null {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEYS.connectionConfig) ?? 'null');
    } catch {
      return null;
    }
  }

  private buildDashboardStorageObject() {
    return this._dashboards;
  }

  private buildThemeStorageObject() {
    const storageObject: IThemeConfig = {
      themeName: this.themeName.getValue()
      }
    return storageObject;
  }

  private saveConnectionConfigToLocalStorage() {
    console.log("[AppSettings Service] Saving Connection config to LocalStorage");
    localStorage.setItem(LOCAL_CONFIG_KEYS.connectionConfig, JSON.stringify(this.buildConnectionStorageObject()));
  }

  // Creates config from defaults and saves to LocalStorage
  private getDefaultAppConfig(): IAppConfig {
    const config: IAppConfig = cloneDeep(DefaultAppConfig);
    config.notificationConfig = cloneDeep(DefaultNotificationConfig);
    config.unitDefaults = cloneDeep(DefaultUnitsConfig);
    config.configVersion = latestConfigVersion;
    localStorage.setItem(LOCAL_CONFIG_KEYS.appConfig, JSON.stringify(config));
    return config;
  }

  private getDefaultConnectionConfig(): IConnectionConfig {
    const config: IConnectionConfig = cloneDeep(DefaultConnectionConfig);
    config.kipUUID = UUID.create();
    config.signalKUrl = window.location.origin;
    localStorage.setItem(LOCAL_CONFIG_KEYS.connectionConfig, JSON.stringify(config));
    return config;
  }

  private getDefaultDashboardsConfig(): Dashboard[] {
    const config: Dashboard[] = [];
    localStorage.setItem(LOCAL_CONFIG_KEYS.dashboardsConfig, JSON.stringify(config));
    return config;
  }

  private getDefaultThemeConfig(): IThemeConfig {
    const config: IThemeConfig = DefaultThemeConfig;
    localStorage.setItem(LOCAL_CONFIG_KEYS.themeConfig, JSON.stringify(config));
    return config;
  }
}
