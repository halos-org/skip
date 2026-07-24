import { Dashboard } from './../services/dashboard.service';

export interface IConnectionConfig {
  configVersion: number;
  skipUUID: string;
  signalKUrl: string | null;
  proxyEnabled: boolean;
  signalKSubscribeAll: boolean;
  // Last computed widget-demand for remote (AIS/DSC) contexts (#386), consumed pre-auth at boot to
  // choose the WS subscribe scope. Absent means "never computed" and is treated as fail-open (all):
  // under-subscribing would hide collision-relevant AIS targets.
  remoteContextDemand?: boolean;
  sharedConfigName: string;
  // Remote-control identity is per-device: a profile switch must not change whether this display
  // participates in remote control or the name it advertises.
  isRemoteControl: boolean;
  instanceName: string;
}

export interface IConfig {
  app: IAppConfig | null;
  theme: IThemeConfig | null;
  dashboards: Dashboard[];
}

export interface IAppConfig {
  configVersion: number;
  autoNightMode: boolean;
  redNightMode: boolean;
  nightModeBrightness: number;
  notificationConfig: INotificationConfig;
  browserTabTitle?: string;
  keepScreenAwake?: boolean;
}

export interface IThemeConfig {
  themeName: string;
}

export interface DashboardConfig {
  dashboards: Dashboard[];
}

export interface INotificationConfig {
  disableNotifications: boolean;
  menuGrouping: boolean;
  security: {
    disableSecurity: boolean;
  },
  devices: {
    disableDevices: boolean;
    showNormalState: boolean;
    showNominalState: boolean;
  },
  sound: {
    disableSound: boolean;
    muteNormal: boolean;
    muteNominal: boolean;
    muteWarn: boolean;
    muteAlert: boolean;
    muteAlarm: boolean;
    muteEmergency: boolean;
  },
}

export interface ISignalKUrl {
  url: string;
  new: boolean;
}
