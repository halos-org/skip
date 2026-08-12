/*
 * #536 fuel-rate render probe. Streams `propulsion.0.fuel.rate` in SI (m3/s) with the meta the
 * Signal K server's metric preset sends for the volumeRate category, and screenshots a steel gauge,
 * a linear gauge and a numeric tile reading it.
 *
 *   CHROME_BIN=/usr/bin/chromium node shot-fuel-rate.mjs --public ../public
 *
 * The reported bug: Skip could not map the preset's `L/h` onto its own `l/h` measure, so the path
 * resolved to 'unitless' — the gauges printed the word "unitless" beside a raw m³/s reading of
 * 0.00. Expect each tile to read ~7.2 with an `l/h` label. The second page repeats the same path
 * with no displayUnits meta at all (a server running no unit preferences), which stays in SI: the
 * label must be blank there, never the word "unitless".
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { buildDashboards, localStorageBundle, serverConfigDocument, initScriptContent, numericWidget, steelGaugeWidget, simpleLinearWidget } from './lib/skip-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

const publicDir = arg('public', join(HERE, '..', 'public'));
const port = Number(arg('port', '4431'));
const VIEWPORT = { width: 1290, height: 640 };

const PATH = 'propulsion.0.fuel.rate';
const SELF_PATH = `self.${PATH}`;
// 2 µm³/s is 7.2 L/h — a plausible diesel burn, and unmistakable against the raw SI 0.000002.
const RATE_SI = 2e-6;

// Every tile carries the stored unit a widget gets when it is configured before any unit meta has
// resolved, so the probe also proves the server preference wins over it.
const tile = { path: SELF_PATH, displayName: 'Fuel rate', unit: 'unitless', scale: { lower: 0, upper: 20 } };
const tiles = () => [steelGaugeWidget(tile), simpleLinearWidget(tile), numericWidget({ ...tile, h: 8, unit: 'unitless', ignoreZones: true })];

const server = await startServer({ publicDir, base: '/@halos-org/skip/', port });
const pages = buildDashboards(tiles()).concat(buildDashboards(tiles()));
pages[0].name = 'Preference';
pages[1].name = 'SI only';
server.setConfigDocument(serverConfigDocument({ dashboards: pages }));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const outDir = join(HERE, 'results', 'shots', 'fuel-rate');
await mkdir(outDir, { recursive: true });

const bundle = localStorageBundle({ origin: server.origin, subscribeAll: false });
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await ctx.addInitScript({ content: initScriptContent(bundle) });
const page = await ctx.newPage();

// What the server's metric preset publishes for the volumeRate category (baseUnit m3/s -> L/h).
const withPreference = {
  [PATH]: {
    units: 'm3/s', description: 'Fuel rate of consumption',
    displayUnits: { category: 'volumeRate', targetUnit: 'L/h', formula: 'value * 3600000', inverseFormula: 'value / 3600000', symbol: 'L/h', displayFormat: '0.0' },
  },
};
const siOnly = { [PATH]: { units: 'm3/s', description: 'Fuel rate of consumption' } };

async function shoot(name, meta) {
  server.setControl({ streaming: true, rateHz: 4, selfPaths: [PATH], selfValues: { [PATH]: RATE_SI }, selfMeta: meta });
  await page.goto('about:blank');
  await page.goto(`${server.appUrl}#/page/${name === 'preference' ? 0 : 1}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('widget-gauge-steel', { timeout: 20000 });
  await page.waitForTimeout(2500); // canvases draw, then meta + a few value frames land
  const tiles = await page.evaluate(() => document.querySelectorAll('widget-host2').length);
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: false });
  if (tiles !== 3) { console.error(`boot check failed: ${tiles} tiles rendered, expected 3`); process.exit(1); }
}

await shoot('preference', withPreference);
await shoot('si-only', siOnly);

await ctx.close();
await browser.close();
await server.stop();

console.log(`\n=== #536 fuel rate (${RATE_SI} m³/s = ${RATE_SI * 3.6e6} L/h) ===`);
console.log('preference.png  expect ~7.2 with an "l/h" label on all three tiles');
console.log('si-only.png     expect the raw SI 0.00 with NO label (never the word "unitless")');
console.log(`-> ${outDir}`);
