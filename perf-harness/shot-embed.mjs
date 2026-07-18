/*
 * #216 embed-mode render probe. Boots Skip headless with and without the `?embed`
 * pre-hash query flag and asserts the chromeless contract from E6/#216:
 *   - Normal boot renders the toolbar (<app-toolbar>) AND the dashboard widgets.
 *   - `?embed` unmounts the toolbar (the shell's `@if (dashboardVisible() && !embed())`)
 *     while the dashboard content still renders (read-only chromeless).
 *   - An unknown `?profile=<name>` boots gracefully (falls back to the user default,
 *     per the contract) rather than crashing.
 *
 *   CHROME_BIN=/usr/bin/chromium node shot-embed.mjs --public ../public
 *
 * The embed flag lives in the pre-hash query (EmbedModeService reads window.location.search
 * once at boot); the app routes with withHashLocation, so the URL is `<appUrl>?embed=1#/page/0`.
 * Writes results/shots/embed/<label>.png and exits non-zero if any assertion fails.
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { appConfig, numericWidget, buildDashboards, localStorageBundle, serverConfigDocument, initScriptContent } from './lib/skip-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

const publicDir = arg('public', join(HERE, '..', 'public'));
const port = Number(arg('port', '4423'));
const VIEWPORT = { width: 1280, height: 800 };

const server = await startServer({ publicDir, base: '/@halos-org/skip/', port });
const WIDGETS = [numericWidget(), numericWidget({ unit: 'celsius', path: 'self.environment.water.temperature' })];
server.setConfigDocument(serverConfigDocument({ dashboards: buildDashboards(WIDGETS) }));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const outDir = join(HERE, 'results', 'shots', 'embed');
await mkdir(outDir, { recursive: true });

const bundle = localStorageBundle({ origin: server.origin, subscribeAll: false });
const initScript = { content: initScriptContent(bundle) };

async function probe(label, query) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(`[${m.type()}] ${m.text()}`); });
  await page.goto('about:blank');
  await page.goto(`${server.appUrl}${query}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('widget-numeric', { timeout: 20000 }).catch(() => { /* asserted below */ });
  await page.waitForTimeout(900); // let the shell + toolbar gate settle
  const dom = await page.evaluate(() => ({
    toolbar: !!document.querySelector('app-toolbar'),
    widgets: document.querySelectorAll('widget-numeric').length,
  }));
  await page.screenshot({ path: join(outDir, `${label}.png`) });
  await ctx.close();
  return { label, ...dom, warnings };
}

const rows = [];
rows.push(await probe('normal', '#/page/0'));
rows.push(await probe('embed', '?embed=1#/page/0'));
rows.push(await probe('embed-unknown-profile', '?embed=1&profile=does-not-exist#/page/0'));

await browser.close();
await server.stop();

const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
console.log('\n=== embed-mode contract (#216) ===');
console.log('label'.padEnd(24), 'toolbar', 'widgets');
for (const r of rows) console.log(String(r.label).padEnd(24), String(r.toolbar).padEnd(7), r.widgets);

// Surface any console warnings/errors so a real boot problem is visible (the
// unknown-profile run legitimately warns about the missing slot).
for (const r of rows) if (r.warnings.length) { console.log(`\n[${r.label}] console:`); for (const w of r.warnings) console.log('  ' + w); }

// Assertions: toolbar present + ALL seeded widgets rendered normally; toolbar
// unmounted under embed while all widgets still render (chromeless, not a partial
// mis-seed); unknown profile falls back to the full default dashboard. Exact count
// (not >=1) so a dropped widget can't pass — mirrors shot-boolean/shot-units.
const checks = [
  ['normal renders the toolbar', byLabel.normal.toolbar === true],
  [`normal renders all ${WIDGETS.length} dashboard widgets`, byLabel.normal.widgets === WIDGETS.length],
  ['embed unmounts the toolbar', byLabel.embed.toolbar === false],
  [`embed still renders all ${WIDGETS.length} dashboard widgets (chromeless, not blank)`, byLabel.embed.widgets === WIDGETS.length],
  [`embed + unknown profile boots the full default dashboard`, byLabel['embed-unknown-profile'].widgets === WIDGETS.length],
];
console.log('');
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
if (failed) { console.error(`\n${failed} embed assertion(s) failed`); process.exit(1); }
console.log('\nall embed assertions passed');
