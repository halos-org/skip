/*
 * Builders for the Skip boot config. Skip (unlike upstream Kip) always persists
 * app/theme/dashboards config on the server's applicationData — localStorage holds
 * only the per-device connection config ('skip.connectionConfig'). So the harness
 * seeds one localStorage key and hands the mock server a full IConfig document to
 * answer the applicationData GET with. Shapes are taken verbatim from
 * src/default-config/* and the widget registry.
 *
 * Three distinct version spaces (all from src/app/core/constants/config-versions.const.ts):
 *  - applicationData URL path segment 11 (REMOTE_CONFIG_FILE_VERSION)
 *  - app.configVersion 13 (LATEST_APP_CONFIG_VERSION)
 *  - connectionConfig.configVersion 13 (CONNECTION_CONFIG_VERSION)
 */
export const SELF_URN = 'vessels.urn:mrn:signalk:uuid:11111111-1111-4111-8111-111111111111';

const DEFAULT_UNITS = {
  Unitless: 'unitless', Speed: 'knots', Flow: 'l/h', Temperature: 'celsius', Length: 'm',
  Volume: 'liter', Current: 'A', Potential: 'V', Charge: 'C', Power: 'W', Energy: 'J',
  Pressure: 'mmHg', 'Fuel Distance': 'nm/l', 'Energy Distance': 'nm/kWh', Density: 'kg/m3',
  Time: 'Hours', 'Angular Velocity': 'deg/min', Angle: 'deg', Frequency: 'Hz', Ratio: 'ratio',
  Resistance: 'ohm',
};

const DEFAULT_NOTIF = {
  disableNotifications: false, menuGrouping: true,
  security: { disableSecurity: true },
  devices: { disableDevices: false, showNormalState: false, showNominalState: false },
  sound: { disableSound: false, muteNormal: true, muteNominal: true, muteWarn: true,
    muteAlert: false, muteAlarm: false, muteEmergency: false },
};

export function appConfig(extra = {}) {
  // configVersion 13 with no dataSets field: a genuine post-v12->v13 config, so the
  // boot skips ConfigurationUpgradeService's migration toast/reload (which is what
  // strips dataSets/datasetUUID/chartEngine) inside the measurement window.
  return {
    configVersion: 13, autoNightMode: false, redNightMode: false, nightModeBrightness: 0.27,
    widgetHistoryDisabled: false, unitDefaults: DEFAULT_UNITS,
    notificationConfig: DEFAULT_NOTIF, browserTabTitle: 'Skip', ...extra,
  };
}

export function connectionConfig(subscribeAll = false) {
  return {
    configVersion: 13, kipUUID: '00000000-0000-4000-8000-000000000001',
    signalKUrl: '__ORIGIN__', // replaced with the served origin at inject time
    proxyEnabled: false, signalKSubscribeAll: subscribeAll,
    sharedConfigName: 'default',
    isRemoteControl: false, instanceName: '',
  };
}

// --- widget factories (gridstack node wrapping widget-host2 + widgetProperties) ---
let seq = 0;
const uid = (p) => `${p}-0000-0000-0000-${String(++seq).padStart(12, '0')}`;

function node(w, h, x, y, widgetProperties) {
  const id = widgetProperties.uuid;
  return { x, y, w, h, id, selector: 'widget-host2', input: { widgetProperties } };
}

export function numericWidget({ path = 'self.navigation.speedOverGround', unit = 'knots', sampleTime = 500, miniChart = false } = {}) {
  const uuid = uid('num');
  return (x, y) => node(4, 6, x, y, {
    type: 'widget-numeric', uuid,
    config: {
      displayName: 'N', filterSelfPaths: true,
      paths: { numericPath: { description: 'Numeric Data', path, source: 'default', pathType: 'number', isPathConfigurable: true, convertUnitTo: unit, sampleTime } },
      numDecimal: 1, showMiniChart: miniChart, color: 'blue', enableTimeout: false, dataTimeout: 5, ignoreZones: false,
    },
  });
}

export function radialGaugeWidget({ path = 'self.navigation.speedOverGround', unit = 'knots', sampleTime = 500 } = {}) {
  const uuid = uid('rad');
  return (x, y) => node(4, 6, x, y, {
    type: 'widget-gauge-ng-radial', uuid,
    config: {
      displayName: 'G', filterSelfPaths: true,
      paths: { gaugePath: { description: 'Gauge', path, source: 'default', pathType: 'number', isPathConfigurable: true, convertUnitTo: unit, sampleTime } },
      gauge: { type: 'ngRadial', subType: 'measuring' },
      displayScale: { lower: 0, upper: 30, type: 'linear' }, numInt: 2, numDecimal: 1,
      color: 'blue', enableTimeout: false, dataTimeout: 5,
    },
  });
}

export function aisRadarWidget() {
  const uuid = uid('ais');
  return (x, y) => node(12, 12, x, y, {
    type: 'widget-ais-radar', uuid,
    config: {
      filterSelfPaths: false, enableTimeout: false, dataTimeout: 5, color: 'grey',
      ais: {
        filters: { anchoredMoored: false, noCollisionRisk: false, allAton: false, allButSar: false, allVessels: false, vesselTypes: [] },
        viewMode: 'course-up', rangeRings: [1, 3, 6, 12, 24, 48], rangeIndex: '3',
        showCogVectors: true, cogVectorsMinutes: 10, showLostTargets: true, showUnconfirmedTargets: true, showSelf: true,
      },
    },
  });
}

/**
 * Switch-panel (widget-boolean-switch) factory. Mirrors the persisted config
 * shape: multiChildCtrls holds the IDynamicControl list, paths holds one
 * IWidgetPath per control keyed by a matching pathID. Each control:
 *   { label, type ('1' switch | '2' button | '3' light), color, value, isNumeric, path }
 * Controls render from multiChildCtrls regardless of live data. Each path carries
 * suppressBootstrapNull so the widget keeps the control's configured on/off value
 * instead of being clobbered by DataService's synchronous bootstrap null (nothing
 * streams these paths here, so without it every control would render OFF).
 */
export function booleanControlWidget({ controls, w = 4, h = 6, displayName = 'Switch Panel', showLabel = true, color = 'contrast' } = {}) {
  const uuid = uid('bool');
  const multiChildCtrls = [];
  const paths = [];
  controls.forEach((c, i) => {
    const pathID = `bctrl-${String(++seq).padStart(4, '0')}`;
    multiChildCtrls.push({
      ctrlLabel: c.label, type: c.type ?? '1', pathID,
      value: c.value ?? false, color: c.color ?? color, isNumeric: c.isNumeric ?? false,
    });
    paths.push({
      description: c.label, path: c.path ?? `self.electrical.switches.bank.0.${i}.state`,
      source: 'default', pathType: 'boolean', isPathConfigurable: true, sampleTime: 500, pathID,
      suppressBootstrapNull: true,
    });
  });
  return (x, y) => node(w, h, x, y, {
    type: 'widget-boolean-switch', uuid,
    config: {
      displayName, showLabel, filterSelfPaths: true, paths,
      enableTimeout: false, dataTimeout: 5, color, zonesOnlyPaths: false,
      putEnable: true, putMomentary: false, multiChildCtrls,
    },
  });
}

/** Lay out widget factories in a grid and wrap them in one dashboard. */
export function buildDashboards(factories, cols = 12) {
  let x = 0, y = 0, rowH = 0;
  const configuration = factories.map((make) => {
    const probe = make(0, 0);
    const w = probe.w, h = probe.h;
    if (x + w > cols) { x = 0; y += rowH; rowH = 0; }
    const n = make(x, y);
    x += w; rowH = Math.max(rowH, h);
    return n;
  });
  return [{ id: uid('dash'), name: 'Perf', icon: 'dashboard-dashboard', configuration }];
}

/**
 * The only localStorage key Skip reads at boot. All other config (app/theme/
 * dashboards) lives server-side — see serverConfigDocument().
 */
export function localStorageBundle({ origin, subscribeAll }) {
  const cc = connectionConfig(subscribeAll);
  cc.signalKUrl = origin;
  return { 'skip.connectionConfig': JSON.stringify(cc) };
}

/**
 * Playwright addInitScript body: sets the boot-time test flag, then seeds the
 * localStorageBundle() keys before the app script runs. Pass the object from
 * localStorageBundle().
 */
export function initScriptContent(bundle) {
  return `window.__KIP_TEST__=true;` +
    Object.entries(bundle).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('');
}

/** Full IConfig document the mock serves from applicationData/user/skip/<ver>/default. */
export function serverConfigDocument({ dashboards, app = appConfig() }) {
  return { app, theme: { themeName: '' }, dashboards };
}
