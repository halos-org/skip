/*
 * #318 boolean-switch (Switch Panel) rendering probe. Renders the widget headless
 * across a control-count x label-length x tile-size matrix and screenshots each
 * tile, so the long-label panel-shrink risk can be judged from real pixels instead
 * of an eyeball on the boat.
 *
 *   CHROME_BIN=/usr/bin/chromium node shot-boolean.mjs --public ../public
 *
 * The #318 mechanism (boolean-control-layout.util.ts): every control in a panel
 * shares ONE height, the largest at which EVERY label fits its scaled lane. One
 * long label therefore drives the shared control height (and font) down for all
 * controls -- so a mixed panel with one very-long label is the exact repro.
 *
 * Writes results/shots/boolean/<name>.png and prints per-tile control geometry.
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { appConfig, booleanControlWidget, localStorageBundle } from './lib/kip-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

const publicDir = arg('public', join(HERE, '..', 'public'));
const port = Number(arg('port', '4422'));
const VIEWPORT = { width: 1280, height: 800 }; // 24-col grid -> col ~53px, row ~33px

const SHORT = 'Nav';
const MED = 'Anchor Light';
const LONG = 'Emergency Bilge Pump Override Switch';
// control types: '1' switch, '2' button, '3' light
const sw = (label, extra = {}) => ({ label, type: '1', ...extra });
const btn = (label, extra = {}) => ({ label, type: '2', ...extra });
const lt = (label, extra = {}) => ({ label, type: '3', ...extra });

// Tile presets (grid cells). narrow width is the #318-binding constraint.
const NARROW = { w: 4, h: 8 };   // ~213 x 267 px
const XNARROW = { w: 3, h: 8 };  // ~160 x 267 px
const LARGE = { w: 14, h: 14 };  // ~747 x 467 px
const SMALL1 = { w: 4, h: 6 };   // single-control small
const LARGE1 = { w: 14, h: 10 };

const scenarios = [
  // --- single control: short vs very-long, small vs large ---
  { name: 'c1-short-switch-small', ...SMALL1, controls: [sw(SHORT, { value: true, color: 'green' })] },
  { name: 'c1-short-switch-large', ...LARGE1, controls: [sw(SHORT, { value: true, color: 'green' })] },
  { name: 'c1-long-switch-small', ...SMALL1, controls: [sw(LONG)] },
  { name: 'c1-long-switch-large', ...LARGE1, controls: [sw(LONG)] },
  { name: 'c1-long-button-small', ...SMALL1, controls: [btn(LONG)] },
  { name: 'c1-long-light-small', ...SMALL1, controls: [lt(LONG)] },

  // --- 3 controls (switch/light/button mix) across label lengths ---
  { name: 'c3-short-narrow', ...NARROW, controls: [sw(SHORT, { value: true, color: 'green' }), lt('Aux', { color: 'blue' }), btn('Bilge', { color: 'orange' })] },
  { name: 'c3-short-large', ...LARGE, controls: [sw(SHORT, { value: true, color: 'green' }), lt('Aux', { color: 'blue' }), btn('Bilge', { color: 'orange' })] },
  { name: 'c3-medium-narrow', ...NARROW, controls: [sw(MED, { color: 'green' }), lt('Steaming Light', { color: 'blue' }), btn('Nav Lights', { color: 'orange' })] },
  { name: 'c3-long-all-narrow', ...NARROW, controls: [sw(LONG, { color: 'green' }), lt(LONG, { color: 'blue' }), btn(LONG, { color: 'orange' })] },

  // --- #318 repro: 3 controls, ONE very-long label, the rest short ---
  { name: 'c3-mixed-repro-narrow', ...NARROW, controls: [sw(LONG, { color: 'green' }), lt('Aux', { value: true, color: 'blue' }), btn('Bilge', { color: 'orange' })] },
  { name: 'c3-mixed-repro-large', ...LARGE, controls: [sw(LONG, { color: 'green' }), lt('Aux', { value: true, color: 'blue' }), btn('Bilge', { color: 'orange' })] },
  { name: 'c3-mixed-repro-xnarrow', ...XNARROW, controls: [sw(LONG, { color: 'green' }), lt('Aux', { value: true, color: 'blue' }), btn('Bilge', { color: 'orange' })] },

  // --- 4 controls: short vs #318 mixed-long repro ---
  { name: 'c4-short-narrow', ...NARROW, controls: [sw(SHORT, { value: true, color: 'green' }), lt('Aux', { color: 'blue' }), btn('Bilge', { color: 'orange' }), sw('Deck', { color: 'purple' })] },
  { name: 'c4-short-large', ...LARGE, controls: [sw(SHORT, { value: true, color: 'green' }), lt('Aux', { color: 'blue' }), btn('Bilge', { color: 'orange' }), sw('Deck', { color: 'purple' })] },
  { name: 'c4-mixed-repro-narrow', ...NARROW, controls: [sw(LONG, { color: 'green' }), lt('Aux', { value: true, color: 'blue' }), btn('Bilge', { color: 'orange' }), sw('Deck', { color: 'purple' })] },
  { name: 'c4-mixed-repro-large', ...LARGE, controls: [sw(LONG, { color: 'green' }), lt('Aux', { value: true, color: 'blue' }), btn('Bilge', { color: 'orange' }), sw('Deck', { color: 'purple' })] },
];

// Second theme axis: config-driven light theme (faithful, colors recompute at boot).
// Night mode is a runtime brightness/sepia filter, not an appConfig field, and is
// geometrically inert -- see report notes.
const lightScenarios = [
  { name: 'c3-mixed-repro-narrow-light', ...NARROW, controls: [sw(LONG, { color: 'green' }), lt('Aux', { value: true, color: 'blue' }), btn('Bilge', { color: 'orange' })] },
  { name: 'c3-mixed-repro-large-light', ...LARGE, controls: [sw(LONG, { color: 'green' }), lt('Aux', { value: true, color: 'blue' }), btn('Bilge', { color: 'orange' })] },
  { name: 'c3-short-narrow-light', ...NARROW, controls: [sw(SHORT, { value: true, color: 'green' }), lt('Aux', { color: 'blue' }), btn('Bilge', { color: 'orange' })] },
];

let dseq = 0;
function dashboardsFor(list) {
  return list.map((s) => ({
    id: `dash-0000-0000-0000-${String(++dseq).padStart(12, '0')}`,
    name: s.name, icon: 'dashboard-dashboard',
    configuration: [booleanControlWidget({ controls: s.controls, w: s.w, h: s.h, displayName: s.name })(0, 0)],
  }));
}

const MIN_TAP = 44; // px accessibility floor (iOS 44 / Material 48)

async function measure(page) {
  return page.evaluate(() => {
    const w = document.querySelector('widget-boolean-switch');
    if (!w) return { ok: false };
    const wr = w.getBoundingClientRect();
    const svgs = [...w.querySelectorAll('.svg-widget svg')].map((s) => {
      const r = s.getBoundingClientRect();
      return {
        type: (s.parentElement?.tagName || '').toLowerCase().replace('app-svg-boolean-', ''),
        hAttr: Number(s.getAttribute('height')),
        rectH: Math.round(r.height), rectW: Math.round(r.width),
      };
    });
    return { ok: true, widget: { w: Math.round(wr.width), h: Math.round(wr.height) }, count: svgs.length, svgs };
  });
}

async function runTheme({ ctx, url, list, dir }) {
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const page = await ctx.newPage();
    await page.goto('about:blank');
    await page.goto(`${url}#/page/${i}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('widget-boolean-switch', { timeout: 20000 });
    await page.waitForSelector('.svg-widget svg', { timeout: 20000 });
    await page.waitForTimeout(700); // let ResizeObserver + measure effect settle
    const m = await measure(page);
    const out = join(dir, `${s.name}.png`);
    await page.locator('widget-boolean-switch').screenshot({ path: out });
    const h = m.ok ? m.svgs[0]?.hAttr ?? 0 : 0;
    const painted = m.ok ? Math.round((m.svgs.reduce((a, x) => a + x.rectH, 0))) : 0;
    const flag = !m.ok ? 'NO-WIDGET' : (h < 8 ? 'SLIVER' : h < MIN_TAP ? 'sub-tap' : 'ok');
    rows.push({ name: s.name, tile: m.ok ? `${m.widget.w}x${m.widget.h}` : '-', ctrls: m.ok ? m.count : 0, ctrlH: h, paintedSum: painted, flag });
    console.log(`[shot] ${out}`);
    await page.close();
  }
  return rows;
}

const server = await startServer({ publicDir, base: '/@halos-org/skip/', port });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const outDir = join(HERE, 'results', 'shots', 'boolean');
await mkdir(outDir, { recursive: true });

const bundle = localStorageBundle({ origin: server.origin, subscribeAll: false });
const initScript = { content: `window.__KIP_TEST__=true;` + Object.entries(bundle).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('') };

// Pin to the current app-config schema (LATEST_APP_CONFIG_VERSION=13) so the boot
// skips ConfigurationUpgradeService's v12->v13 migration toast/reload. That migration
// only strips dataSets/datasetUUID/chartEngine, none of which touch the boolean widget.
const appV13 = () => { const a = appConfig({ configVersion: 13 }); delete a.dataSets; return a; };

// --- day / default dark theme: full matrix ---
server.setConfigDocument({ app: appV13(), theme: { themeName: '' }, dashboards: dashboardsFor(scenarios) });
const dayCtx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await dayCtx.addInitScript(initScript);
const dayRows = await runTheme({ ctx: dayCtx, url: server.appUrl, list: scenarios, dir: outDir });
await dayCtx.close();

// --- config-driven light theme: key repros ---
dseq = 0;
server.setConfigDocument({ app: appV13(), theme: { themeName: 'light-theme' }, dashboards: dashboardsFor(lightScenarios) });
const lightCtx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await lightCtx.addInitScript(initScript);
const lightRows = await runTheme({ ctx: lightCtx, url: server.appUrl, list: lightScenarios, dir: outDir });
await lightCtx.close();

const all = [...dayRows, ...lightRows];
console.log('\n=== control geometry (ctrlH = shared per-control height in px; MIN_TAP=44) ===');
console.log('name'.padEnd(30), 'tile'.padEnd(11), 'ctrls', 'ctrlH', 'paintedSum', 'flag');
for (const r of all) {
  console.log(String(r.name).padEnd(30), String(r.tile).padEnd(11), String(r.ctrls).padEnd(5), String(r.ctrlH).padEnd(5), String(r.paintedSum).padEnd(10), r.flag);
}

await browser.close();
await server.stop();
