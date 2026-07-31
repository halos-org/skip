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
// (survives in-app navigation); the widget type is the hash route param. Read-only, bus-silent —
// no per-instance config in this version.
const skipWidgetUrl = (widgetType) => `${SKIP_URL}?embed=1#/widget/${widgetType}`;
// Skip's widget type id is the component selector used in dashboard configs and the widget route.
const WIND_STEER_TYPE = 'widget-wind-steer';

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
      optional: [],
      widgets: [
        {
          id: 'wind-steer-1x1',
          title: 'Wind Steer',
          type: 'iframe',
          url: skipWidgetUrl(WIND_STEER_TYPE),
          size: '1x1',
          lifecycle: 'whileEnabled'
        },
        {
          id: 'wind-steer-2x2',
          title: 'Wind Steer',
          type: 'iframe',
          url: skipWidgetUrl(WIND_STEER_TYPE),
          size: '2x2',
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
