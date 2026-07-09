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

module.exports = function (app) {
  let running = false;

  function buildManifest() {
    return {
      name: 'Skip',
      description: 'Opens the Skip instrument panel inside Freeboard-SK.',
      version,
      apiVersion: '1',
      requires: [],
      optional: [],
      panels: [
        {
          id: 'skip-panel',
          title: 'Skip',
          type: 'iframe',
          url: SKIP_URL,
          lifecycle: 'keepAlive'
        }
      ],
      buttons: [
        {
          id: 'skip-open',
          title: 'Skip',
          slot: 'primary',
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
      app.setPluginStatus(`Skip panel registered at ${SKIP_URL}`);
    },
    stop() {
      running = false;
    }
  };
};
