/*
 * #245 unit-display-symbol render probe. Renders a numeric widget per convertUnitTo
 * across a spread of units and screenshots the grid, so the rendered unit labels can
 * be checked against the display symbols units.service resolves (getUnitDisplaySymbol):
 * the explicit symbol when one exists (kn, km/h, °C, gal, L, Ω...), else the measure
 * key (mph, V, psi) — and NEVER the spelled-out description ("Celsius", "Gallons").
 *
 *   CHROME_BIN=/usr/bin/chromium node shot-units.mjs --public ../public
 *
 * The numeric widget canvas-renders its unit label, so this is a visual check: each
 * tile's displayName is set to the measure key and the expected symbol is printed
 * alongside for eyeballing the screenshot. The symbol resolves from convertUnitTo
 * independent of the (unstreamed) value, so no live data is needed.
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { numericWidget, buildDashboards, localStorageBundle, serverConfigDocument, initScriptContent } from './lib/skip-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

const publicDir = arg('public', join(HERE, '..', 'public'));
const port = Number(arg('port', '4424'));
const VIEWPORT = { width: 1290, height: 900 }; // 12-col grid, 4-wide tiles -> 3 per row

// [measure (convertUnitTo), expected rendered symbol]. Covers the #245 transforms:
// km/h rename, the gal/L/gal-per-min disambiguation, °C/°F, the ohm glyph, and a few
// symbol-less units that must fall back to the measure key (not a spelled-out word).
const UNITS = [
  ['knots', 'kn'], ['kph', 'km/h'], ['mph', 'mph'],
  ['celsius', '°C'], ['fahrenheit', '°F'], ['K', 'K'],
  ['gallon', 'gal'], ['liter', 'L'], ['g/min', 'gal/min'],
  ['ohm', 'Ω'], ['V', 'V'], ['psi', 'psi'],
];

const server = await startServer({ publicDir, base: '/@halos-org/skip/', port });
server.setConfigDocument(serverConfigDocument({
  dashboards: buildDashboards(UNITS.map(([measure]) => numericWidget({ unit: measure, displayName: measure }))),
}));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const outDir = join(HERE, 'results', 'shots', 'units');
await mkdir(outDir, { recursive: true });

const bundle = localStorageBundle({ origin: server.origin, subscribeAll: false });
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await ctx.addInitScript({ content: initScriptContent(bundle) });
const page = await ctx.newPage();
await page.goto('about:blank');
await page.goto(`${server.appUrl}#/page/0`, { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('widget-numeric', { timeout: 20000 });
await page.waitForTimeout(1000); // let all canvases draw
const count = await page.evaluate(() => document.querySelectorAll('widget-numeric').length);
await page.screenshot({ path: join(outDir, 'units-grid.png'), fullPage: true });
await ctx.close();
await browser.close();
await server.stop();

console.log(`\n=== #245 unit symbols — expect each tile (labeled by measure) to render its symbol ===`);
console.log('measure'.padEnd(12), 'expected symbol');
for (const [measure, symbol] of UNITS) console.log(String(measure).padEnd(12), symbol);
console.log(`\nrendered ${count}/${UNITS.length} numeric tiles -> results/shots/units/units-grid.png`);
if (count !== UNITS.length) { console.error(`boot check failed: expected ${UNITS.length} tiles, got ${count}`); process.exit(1); }
