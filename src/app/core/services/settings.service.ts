import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable, filter } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { cloneDeep } from 'lodash-es';

import { IUnitDefaults } from './units.service';
import { UUID } from '../utils/uuid.util';

import { IConfig, IAppConfig, IConnectionConfig, IThemeConfig, INotificationConfig, ISignalKUrl } from "../interfaces/app-settings.interfaces";
import { DefaultAppConfig, DefaultConnectionConfig as DefaultConnectionConfig, DefaultThemeConfig } from '../../../default-config/config.blank.const';
import { DefaultUnitsConfig } from '../../../default-config/config.blank.units.const'
import { DefaultNotificationConfig } from '../../../default-config/config.blank.notification.const';
import { DemoAppConfig, DemoThemeConfig, DemoDashboardsConfig } from '../../../default-config/config.demo.const';
import { MatSnackBar } from '@angular/material/snack-bar';

import { StorageService, TConfigObjectType } from './storage.service';
import { Dashboard } from './dashboard.service';
import { LOCAL_CONFIG_KEYS, localConfigKey } from '../constants/config-storage.const';
import { REMOTE_CONFIG_FILE_VERSION, LATEST_APP_CONFIG_VERSION, CONNECTION_CONFIG_VERSION, SUPPORTED_CONNECTION_CONFIG_VERSIONS } from '../constants/config-versions.const';


const defaultTheme = '';
@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly storage = inject(StorageService);
  private readonly snackBar = inject(MatSnackBar);

  // Source-of-truth signals for the profile/app-scope settings and the per-device identity.
  private readonly _unitDefaults = signal<IUnitDefaults>({});
  private readonly _themeName = signal<string>(defaultTheme);
  private readonly _notificationConfig = signal<INotificationConfig>(DefaultNotificationConfig);
  private readonly _autoNightMode = signal<boolean>(false);
  private readonly _redNightMode = signal<boolean>(false);
  private readonly _nightModeBrightness = signal<number>(1);
  private readonly _isRemoteControl = signal<boolean>(false);
  private readonly _instanceName = signal<string>('');
  private readonly _browserTabTitle = signal<string>('Skip');

  public readonly unitDefaults = this._unitDefaults.asReadonly();
  public readonly themeName = this._themeName.asReadonly();
  public readonly notificationConfig = this._notificationConfig.asReadonly();
  public readonly autoNightMode = this._autoNightMode.asReadonly();
  public readonly redNightMode = this._redNightMode.asReadonly();
  public readonly nightModeBrightness = this._nightModeBrightness.asReadonly();
  public readonly isRemoteControl = this._isRemoteControl.asReadonly();
  public readonly instanceName = this._instanceName.asReadonly();
  public readonly browserTabTitle = this._browserTabTitle.asReadonly();

  // Observable bridges for the two remaining .subscribe() consumers (units.service,
  // notifications.service — removed by #79). A fresh subscriber must receive the current value
  // synchronously (notifications.service dereferences it in the same tick), which bare
  // toObservable(signal) does not provide, so the write path feeds these alongside the signals.
  private readonly unitDefaults$ = new BehaviorSubject<IUnitDefaults>(this._unitDefaults());
  private readonly notificationConfig$ = new BehaviorSubject<INotificationConfig>(this._notificationConfig());

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
  public configUpgrade = signal<boolean>(false);
  private configVersion: number | undefined; // store actual config version from config version property in config
  private disablePathValidation = false; // used to disable path validation in path control component in widget options.

  constructor() {
    console.log("[AppSettings Service] Service startup...");
    this.storage.activeConfigFileVersion = REMOTE_CONFIG_FILE_VERSION;

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
    const initConfig = this.storage.initConfig;
    if (!this.storage.isRemoteContextBootstrapped() || !initConfig?.app) {
      console.warn('[AppSettings Service] Shared configuration enabled but remote bootstrap handoff is missing or empty. Waiting for explicit recovery action.');
      return;
    }

    this.configVersion = initConfig.app.configVersion;
    this.checkConfigUpgradeRequired(false, initConfig.app.configVersion);
    this.activeConfig = initConfig;
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
    this._isRemoteControl.set(config.isRemoteControl ?? false);
    this._instanceName.set(config.instanceName ?? '');
  }

  public resetConnection() {
    localStorage.setItem(LOCAL_CONFIG_KEYS.connectionConfig, JSON.stringify(this.getDefaultConnectionConfig()));
    this.reloadApp();
  }

  private checkConfigUpgradeRequired(isLocalStorageConfig: boolean, storageVersion?: number): void {
    if (storageVersion !== LATEST_APP_CONFIG_VERSION) {
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
    const app = this.activeConfig.app;
    // Guaranteed non-null by startup()'s pre-check before pushSettings() is invoked; guarded again
    // here defensively rather than asserted, since activeConfig is a mutable field.
    if (!app) {
      return;
    }

    if (this.activeConfig.theme) {
      this._themeName.set(this.activeConfig.theme.themeName);
    }
    this.applyUnitDefaults(app.unitDefaults);
    this.applyNotificationConfig(app.notificationConfig);

    if (app.autoNightMode === undefined) {
      this.setAutoNightMode(false);
    } else {
      this._autoNightMode.set(app.autoNightMode);
    }

    if (app.redNightMode === undefined) {
      this.setRedNightMode(false);
    } else {
      this._redNightMode.set(app.redNightMode);
    }

    if (app.nightModeBrightness === undefined) {
      this.setNightModeBrightness(0.2);
    } else {
      this._nightModeBrightness.set(app.nightModeBrightness);
    }

    if (this.activeConfig.dashboards === undefined) {
      this._dashboards = [];
    } else {
      this._dashboards = this.activeConfig.dashboards;
    }

    if (app.browserTabTitle === undefined) {
      this._browserTabTitle.set('Skip');
    } else {
      this._browserTabTitle.set(app.browserTabTitle);
    }
  }

  // Update the two bridged values through one point so the signal and its observable bridge can
  // never diverge.
  private applyUnitDefaults(value: IUnitDefaults): void {
    this._unitDefaults.set(value);
    this.unitDefaults$.next(value);
  }

  private applyNotificationConfig(value: INotificationConfig): void {
    this._notificationConfig.set(value);
    this.notificationConfig$.next(value);
  }

  /**
   * Single write path for whole-blob app-scope saves: rebuilds the full IAppConfig from current
   * state (preserving the loaded configVersion) and queues it as one replace patch.
   */
  private saveAppConfig(): void {
    this.storage.patchConfig('IAppConfig', this.buildAppStorageObject());
  }

  /** Single write path for granular (sub-app-scope) profile saves. */
  private saveConfigSection(objType: TConfigObjectType, value: unknown): void {
    this.storage.patchConfig(objType, value);
  }

  //UnitDefaults
  public getDefaultUnitsAsO(): Observable<IUnitDefaults> {
    return this.unitDefaults$.asObservable();
  }
  public getDefaultUnits(): IUnitDefaults {
    return this.unitDefaults();
  }
  public setDefaultUnits(newDefaults: IUnitDefaults) {
    this.applyUnitDefaults(newDefaults);
    this.saveConfigSection('Array<IUnitDefaults>', newDefaults);
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
  public setThemeName(newTheme: string) {
    this._themeName.set(newTheme);
    this.saveConfigSection('IThemeConfig', { themeName: newTheme });
  }

  public getThemeName(): string {
    return this.themeName();
  }

  // Auto night mode
  public setAutoNightMode(enabled: boolean) {
    this._autoNightMode.set(enabled);
    this.saveAppConfig();
  }

  public getAutoNightMode(): boolean {
    return this.autoNightMode();
  }

  // Red night mode
  public getRedNightMode(): boolean {
    return this.redNightMode();
  }

  public setRedNightMode(enabled: boolean) {
    this._redNightMode.set(enabled);
    this.saveAppConfig();
  }

  // isRemoteControl mode
  public getIsRemoteControl(): boolean {
    return this.isRemoteControl();
  }

  public setIsRemoteControl(enabled: boolean) {
    this._isRemoteControl.set(enabled);
    this.connectionIdentityDirty = true;
    // Remote-control identity is per-device: persist to connectionConfig, never the profile.
    this.saveConnectionConfigToLocalStorage();
  }

  // Remote Control Instance Name
  public getInstanceName(): string {
    return this.instanceName();
  }

  public setInstanceName(name: string) {
    this._instanceName.set(name);
    this.connectionIdentityDirty = true;
    // Remote-control identity is per-device: persist to connectionConfig, never the profile.
    this.saveConnectionConfigToLocalStorage();
  }

  // Browser tab title (document.title)
  public getBrowserTabTitle(): string {
    return this.browserTabTitle();
  }

  public setBrowserTabTitle(title: string) {
    // Trim before storing so a padded/whitespace-only value isn't persisted (the resolver already
    // trims for display; this keeps the saved config clean and blank values normalized to '').
    this._browserTabTitle.set((title ?? '').trim());
    this.saveAppConfig();
  }

  public getDisablePathValidation(): boolean {
    return this.disablePathValidation;
  }

  public setDisablePathValidation(disable: boolean) {
    this.disablePathValidation = disable;
  }

  public getNightModeBrightness(): number {
    return this.nightModeBrightness();
  }

  public setNightModeBrightness(brightness: number): void {
    this._nightModeBrightness.set(brightness);
    this.saveAppConfig();
  }

  public saveDashboards(dashboards: Dashboard[]) {
    if (this.storage.storageServiceReady$.getValue()) {
      this.saveConfigSection('Dashboards', dashboards);
    }
    this._dashboards = dashboards;
  }

  // Notification Service Setting
  public getNotificationServiceConfigAsO(): Observable<INotificationConfig> {
    return this.notificationConfig$.asObservable();
  }
  public getNotificationConfig(): INotificationConfig {
    return this.notificationConfig();
  }
  public setNotificationConfig(notificationConfig: INotificationConfig) {
    this.applyNotificationConfig(notificationConfig);
    this.saveConfigSection('INotificationConfig', notificationConfig);
  }

  //Config manipulation: RAW and SignalK server - used by Settings Config Component
  public resetSettings() {
    // The user asked for a reset: a storage that is not ready must fail loudly, not silently
    // leave the previous configuration in place.
    if (!this.storage.storageServiceReady$.getValue()) {
      console.error("[AppSettings Service] Storage not ready; cannot reset configuration.");
      this.snackBar.open(
        'Cannot reset configuration: server storage is not ready. Reload the app and try again.',
        'Close',
        {
          duration: 0,
          verticalPosition: 'top'
        }
      );
      return;
    }

    const newDefaultConfig: IConfig = {
      app: this.getDefaultAppConfig(),
      theme: this.getDefaultThemeConfig(),
      dashboards: this.getDefaultDashboardsConfig()
    };

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
      configVersion: this.configVersion ?? LATEST_APP_CONFIG_VERSION,
      autoNightMode: this.autoNightMode(),
      redNightMode: this.redNightMode(),
      nightModeBrightness: this.nightModeBrightness(),
      unitDefaults: this.unitDefaults(),
      notificationConfig: this.notificationConfig(),
      browserTabTitle: this.browserTabTitle()
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
      isRemoteControl: this.connectionIdentityDirty ? this.isRemoteControl() : (stored?.isRemoteControl ?? this.isRemoteControl()),
      instanceName: this.connectionIdentityDirty ? this.instanceName() : (stored?.instanceName ?? this.instanceName())
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
      themeName: this.themeName()
      }
    return storageObject;
  }

  private saveConnectionConfigToLocalStorage() {
    console.log("[AppSettings Service] Saving Connection config to LocalStorage");
    localStorage.setItem(LOCAL_CONFIG_KEYS.connectionConfig, JSON.stringify(this.buildConnectionStorageObject()));
  }

  // Builders returning fresh default configs. Profile config persists to the server, so these
  // write no localStorage mirrors — except the connection config, which is per-device
  // localStorage scope and must persist where it lives.
  private getDefaultAppConfig(): IAppConfig {
    const config: IAppConfig = cloneDeep(DefaultAppConfig);
    config.notificationConfig = cloneDeep(DefaultNotificationConfig);
    config.unitDefaults = cloneDeep(DefaultUnitsConfig);
    config.configVersion = LATEST_APP_CONFIG_VERSION;
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
    return [];
  }

  private getDefaultThemeConfig(): IThemeConfig {
    return cloneDeep(DefaultThemeConfig);
  }
}
