// Signal K server plugin bundled with the Skip webapp package.
//
// It registers Skip as a Freeboard-SK "plotter extension" panel: a read-only
// `plotterExtensions` resource whose manifest tells a supporting chartplotter
// (Freeboard-SK) to offer a toolbar button that opens Skip in a side panel.
// See https://github.com/SignalK/freeboard-sk/blob/master/docs/api/plotter_extension_provider_plugins.md
//
// The panel iframe is the Skip webapp served by this same package, so the URL is
// the package's fixed serving path and the same-origin session authenticates it.

const { version } = require('../package.json');

const PLUGIN_ID = 'skip-plotter-panel';
const SKIP_URL = '/@halos-org/skip/';
// The panel iframe boots Skip in chromeless embed mode. The flag rides in the pre-hash query string
// so Skip's in-app (hash) navigation preserves it. No profile is baked in — the panel shows the
// user's own default profile.
const SKIP_PANEL_URL = `${SKIP_URL}?embed=1`;

// A widget iframe boots the same chromeless Skip on its single-widget route (`#/widget/<type>`),
// rendering one control full-bleed against the user's own live session. The embed flag is pre-hash
// (survives in-app navigation); the widget type is the hash route param. Data comes from Skip's own
// session; the plotter-extension bus carries only the long-press that opens the host's remove/settings
// dialog and the per-instance config. The settings iframe is served on the widget-config route.
const skipWidgetUrl = (widgetType) => `${SKIP_URL}?embed=1#/widget/${widgetType}`;
const skipWidgetConfigUrl = (widgetType) => `${SKIP_URL}?embed=1#/widget-config/${widgetType}`;
// Skip's widget type id is the component selector used in dashboard configs and the widget route.
const WIND_STEER_TYPE = 'widget-wind-steer';
const WIND_STEER_CONFIG_PANEL = 'wind-steer-config';

module.exports = function (app) {
  let running = false;

  function buildManifest() {
    return {
      name: 'Skip',
      description: 'Opens the Skip instrument panel inside Freeboard-SK.',
      version,
      apiVersion: '1',
      // 'widgets' is intentionally absent: the panel is the primary contribution, so requiring widget
      // support would drop the whole extension on hosts that lack it. Widget-capable hosts render the
      // additive widgets[] section below; others silently omit it and keep the panel.
      requires: ['panels.iframe', 'buttons'],
      // 'widgets' is declared optional (not required): it announces the widget contribution to hosts
      // that gate rendering on the declared capability, while keeping the extension — and its panel —
      // available on hosts without widget support. 'state' is optional too: without it the widget
      // still works, it just cannot persist per-instance settings.
      optional: ['widgets', 'state'],
      widgets: [
        {
          id: 'wind-steer-1x1',
          title: 'Wind Steer',
          type: 'iframe',
          url: skipWidgetUrl(WIND_STEER_TYPE),
          size: '1x1',
          configPanel: WIND_STEER_CONFIG_PANEL,
          lifecycle: 'whileEnabled'
        },
        {
          id: 'wind-steer-2x2',
          title: 'Wind Steer',
          type: 'iframe',
          url: skipWidgetUrl(WIND_STEER_TYPE),
          size: '2x2',
          configPanel: WIND_STEER_CONFIG_PANEL,
          lifecycle: 'whileEnabled'
        }
      ],
      panels: [
        {
          id: 'skip-panel',
          title: 'Skip',
          type: 'iframe',
          url: SKIP_PANEL_URL,
          lifecycle: 'keepAlive'
        },
        {
          id: WIND_STEER_CONFIG_PANEL,
          title: 'Wind Steer settings',
          type: 'iframe',
          url: skipWidgetConfigUrl(WIND_STEER_TYPE),
          lifecycle: 'onOpen'
        }
      ],
      buttons: [
        {
          id: 'skip-open',
          title: 'Skip',
          slot: 'mapToolbar',
          icon: 'insights',
          action: { type: 'togglePanel', panel: 'skip-panel' }
        }
      ]
    };
  }

  return {
    id: PLUGIN_ID,
    name: 'Skip Freeboard Panel',
    description: 'Registers Skip as a Freeboard-SK plotter-extension panel.',
    schema: { type: 'object', properties: {} },
    start() {
      app.registerResourceProvider({
        type: 'plotterExtensions',
        methods: {
          listResources: async () => (running ? { [PLUGIN_ID]: buildManifest() } : {}),
          getResource: async (id) => {
            if (!running || id !== PLUGIN_ID) {
              throw new Error(`No such plotterExtensions resource: ${id}`);
            }
            return buildManifest();
          },
          setResource: async () => {
            throw new Error(`${PLUGIN_ID} is a read-only provider`);
          },
          deleteResource: async () => {
            throw new Error(`${PLUGIN_ID} is a read-only provider`);
          }
        }
      });
      running = true;
      app.setPluginStatus(`Skip panel registered at ${SKIP_PANEL_URL}`);
    },
    stop() {
      running = false;
    }
  };
};
