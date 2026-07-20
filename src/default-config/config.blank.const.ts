import { IConfig ,IAppConfig, IConnectionConfig, IThemeConfig } from "../app/core/interfaces/app-settings.interfaces"
import { LATEST_APP_CONFIG_VERSION, CONNECTION_CONFIG_VERSION } from "../app/core/constants/config-versions.const";
import { DefaultNotificationConfig } from './config.blank.notification.const';
import { UUID } from "../app/core/utils/uuid.util";

// Immutable defaults: the settings getters and profile-import validation read these as a shared
// baseline, so callers must clone before mutating rather than corrupt the singleton in place.
export const DefaultAppConfig: Readonly<IAppConfig> = {
  "configVersion": LATEST_APP_CONFIG_VERSION,
  "autoNightMode": true,
  "redNightMode": false,
  "nightModeBrightness": 0.27,
  "notificationConfig": DefaultNotificationConfig,
  "browserTabTitle": "Skip"
}

export const DefaultThemeConfig: IThemeConfig = {
  "themeName": ""
}

export const defaultConfig: IConfig = {
  "app": DefaultAppConfig,
  "theme": DefaultThemeConfig,
  "dashboards": []
}

export const DefaultConnectionConfig: Readonly<IConnectionConfig> = {
  "configVersion": CONNECTION_CONFIG_VERSION,
  "skipUUID": UUID.create(),
  "signalKUrl": null, // get's overwritten with host at getDefaultConnectionConfig()
  "proxyEnabled": false,
  "signalKSubscribeAll": false,
  "sharedConfigName": "default",
  "isRemoteControl": false,
  "instanceName": ""
}
