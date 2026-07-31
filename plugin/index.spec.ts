import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

interface PluginManifest {
  name: string;
  description: string;
  version: string;
  apiVersion: string;
  requires: string[];
  optional: string[];
  widgets: { id: string; title: string; type: string; url: string; size: string; lifecycle: string }[];
  panels: { id: string; title: string; type: string; url: string; lifecycle: string }[];
  buttons: {
    id: string;
    title: string;
    slot: string;
    icon: string;
    action: { type: string; panel: string };
  }[];
}

interface ResourceMethods {
  listResources: () => Promise<Record<string, PluginManifest>>;
  getResource: (id: string) => Promise<PluginManifest>;
  setResource: (id: string, value: unknown) => Promise<void>;
  deleteResource: (id: string) => Promise<void>;
}

interface ResourceProvider {
  type: string;
  methods: ResourceMethods;
}

interface Plugin {
  id: string;
  name: string;
  description: string;
  schema: unknown;
  start: () => void;
  stop: () => void;
}

interface PluginApp {
  registerResourceProvider: (provider: ResourceProvider) => void;
  setPluginStatus: (message: string) => void;
}

type PluginFactory = (app: PluginApp) => Plugin;

const requireCjs = createRequire(import.meta.url);
const createSkipPanelPlugin = requireCjs('./index.js') as PluginFactory;

const PLUGIN_ID = 'skip-plotter-panel';
const SKIP_URL = '/@halos-org/skip/';

interface Harness {
  provider: ResourceProvider | null;
  statuses: string[];
}

function makeApp(): { app: PluginApp; harness: Harness } {
  const harness: Harness = { provider: null, statuses: [] };
  const app: PluginApp = {
    registerResourceProvider: (provider) => {
      harness.provider = provider;
    },
    setPluginStatus: (message) => {
      harness.statuses.push(message);
    },
  };
  return { app, harness };
}

function methodsOf(harness: Harness): ResourceMethods {
  const provider = harness.provider;
  if (!provider) {
    throw new Error('resource provider was not registered');
  }
  return provider.methods;
}

describe('Skip Freeboard panel plugin', () => {
  it('exposes the Signal K plugin id and metadata', () => {
    const { app } = makeApp();
    const plugin = createSkipPanelPlugin(app);
    expect(plugin.id).toBe(PLUGIN_ID);
    expect(plugin.name).toBe('Skip Freeboard Panel');
  });

  it('registers the plotterExtensions provider only when started', () => {
    const { app, harness } = makeApp();
    const plugin = createSkipPanelPlugin(app);
    expect(harness.provider).toBeNull();
    plugin.start();
    expect(harness.provider?.type).toBe('plotterExtensions');
  });

  it('gates resource listing on the running state', async () => {
    const { app, harness } = makeApp();
    const plugin = createSkipPanelPlugin(app);
    plugin.start();
    const methods = methodsOf(harness);
    expect(Object.keys(await methods.listResources())).toEqual([PLUGIN_ID]);

    plugin.stop();
    expect(await methods.listResources()).toEqual({});
    await expect(methods.getResource(PLUGIN_ID)).rejects.toThrow();
  });

  it('serves the manifest for its own id and rejects unknown ids', async () => {
    const { app, harness } = makeApp();
    const plugin = createSkipPanelPlugin(app);
    plugin.start();
    const methods = methodsOf(harness);
    const manifest = await methods.getResource(PLUGIN_ID);
    expect(manifest.name).toBe('Skip');
    await expect(methods.getResource('other')).rejects.toThrow();
  });

  it('is read-only: rejects writes and deletes', async () => {
    const { app, harness } = makeApp();
    const plugin = createSkipPanelPlugin(app);
    plugin.start();
    const methods = methodsOf(harness);
    await expect(methods.setResource(PLUGIN_ID, {})).rejects.toThrow(/read-only/);
    await expect(methods.deleteResource(PLUGIN_ID)).rejects.toThrow(/read-only/);
  });

  it('declares the Freeboard-SK host capabilities it uses', async () => {
    const { app, harness } = makeApp();
    const plugin = createSkipPanelPlugin(app);
    plugin.start();
    const methods = methodsOf(harness);
    const manifest = await methods.getResource(PLUGIN_ID);
    // 'widgets' is deliberately NOT required: the panel is the extension's primary contribution, and
    // requiring widget support would drop the whole extension (panel included) on hosts that lack it.
    // Widget-capable hosts render the additive widgets[] section; others silently omit it.
    expect(manifest.requires).toEqual(['panels.iframe', 'buttons']);
    expect(manifest.optional).toEqual([]);
    expect(manifest.apiVersion).toBe('1');
  });

  it('contributes Wind Steer as always-on chart widgets in small and large sizes', async () => {
    const { app, harness } = makeApp();
    const plugin = createSkipPanelPlugin(app);
    plugin.start();
    const methods = methodsOf(harness);
    const manifest = await methods.getResource(PLUGIN_ID);
    expect(manifest.widgets.map((w) => w.id)).toEqual(['wind-steer-1x1', 'wind-steer-2x2']);
    expect(manifest.widgets.map((w) => w.size)).toEqual(['1x1', '2x2']);
    for (const widget of manifest.widgets) {
      expect(widget.type).toBe('iframe');
      expect(widget.title).toBe('Wind Steer');
      expect(widget.lifecycle).toBe('whileEnabled');
      // Boots Skip chromeless via the pre-hash query flag, on the single-widget hash route for the
      // Wind Steer widget type; the hash survives the app's in-app navigation like the panel's does.
      expect(widget.url).toBe(`${SKIP_URL}?embed=1#/widget/widget-wind-steer`);
    }
  });

  it('opens Skip in an iframe panel from a map-toolbar button', async () => {
    const { app, harness } = makeApp();
    const plugin = createSkipPanelPlugin(app);
    plugin.start();
    const methods = methodsOf(harness);
    const manifest = await methods.getResource(PLUGIN_ID);
    const [panel] = manifest.panels;
    expect(panel.type).toBe('iframe');
    // The panel boots Skip in chromeless embed mode via the pre-hash query flag; no profile is baked in.
    expect(panel.url).toBe(`${SKIP_URL}?embed=1`);
    expect(panel.lifecycle).toBe('keepAlive');
    const [button] = manifest.buttons;
    expect(button.slot).toBe('mapToolbar');
    expect(button.action.type).toBe('togglePanel');
    expect(button.action.panel).toBe(panel.id);
  });
});
