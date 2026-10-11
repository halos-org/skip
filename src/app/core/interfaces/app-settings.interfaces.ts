import { Dashboard } from './../services/dashboard.service';

export interface IConnectionConfig {
  configVersion: number;
  skipUUID: string;
  signalKUrl: string | null;
  proxyEnabled: boolean;
  signalKSubscribeAll: boolean;
  // Last computed widget-demand for remote (AIS/DSC) contexts (#386), keyed by profile
  // (sharedConfigName) because demand is per-profile — a device switches between profiles with
  // different widgets. Consumed pre-auth at boot for the active profile to choose the WS subscribe
  // scope. A missing entry (profile never computed, or a switched-to profile) is treated as fail-open
  // (all): under-subscribing would hide collision-relevant AIS targets.
  remoteContextDemand?: Record<string, boolean>;
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
  autoRevealToolbar?: boolean;
  pinToolbar?: boolean;
  /** Widgets whose scale bounds the SI migration could not convert and reset, until the user dismisses the list. */
  siScaleResets?: ISiScaleReset[];
}

/** A widget whose stored scale bounds had no known unit to convert from, so the SI migration reset them. */
export interface ISiScaleReset {
  /** The dashboard's id, which keeps two dashboards with the same name apart. */
  dashboardId: string;
  /** The dashboard's name, or its 1-based position when it has none. */
  dashboard: string;
  /** The widget's displayName, or its type when it has none. */
  widget: string;
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
    /** Play a sound with the Signal K connection-problem toasts. Absent in configs written before
     *  the option existed, which means off. */
    playConnectionSound?: boolean;
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
