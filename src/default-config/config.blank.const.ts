import { IConfig ,IAppConfig, IConnectionConfig, IThemeConfig } from "../app/core/interfaces/app-settings.interfaces"
import { DefaultNotificationConfig } from './config.blank.notification.const';
import { DefaultUnitsConfig } from "./config.blank.units.const";
import { UUID } from "../app/core/utils/uuid.util";

// Immutable defaults: the settings getters and profile-import validation read these as a shared
// baseline, so callers must clone before mutating rather than corrupt the singleton in place.
export const DefaultAppConfig: Readonly<IAppConfig> = {
  "configVersion": 12,
  "autoNightMode": true,
  "redNightMode": false,
  "nightModeBrightness": 0.27,
  "dataSets": [],
  "unitDefaults": DefaultUnitsConfig,
  "notificationConfig": DefaultNotificationConfig,
  "browserTabTitle": "SKip"
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
  "configVersion": 13,
  "kipUUID": UUID.create(),
  "signalKUrl": null, // get's overwritten with host at getDefaultConnectionConfig()
  "proxyEnabled": false,
  "signalKSubscribeAll": false,
  "useSharedConfig": false,
  "sharedConfigName": "default",
  "isRemoteControl": false,
  "instanceName": ""
}
