/*
 * Visual verification of the shipped DefaultDashboard seed and the New-profile dialog.
 *   node shot-default-seed.mjs --public ../public --label seed
 * Boots the real bundle against an empty-dashboards profile, so DashboardService
 * seeds DefaultDashboard exactly as it does on a fresh install, then shoots every
 * seeded page plus the New-profile dialog. Writes results/shots/<label>-*.png.
 */
import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { localStorageBundle, serverConfigDocument, initScriptContent } from './lib/skip-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

const publicDir = arg('public', join(HERE, '..', 'public'));
const label = arg('label', 'seed');
const port = Number(arg('port', '4430'));
// Dense pages need a beat before every gauge has painted its first value; a shot
// taken too early shows a zeroed needle that looks like a seed defect.
const settleMs = Number(arg('settle', '5000'));

/** Parse the seed straight out of its TS source — the expected page and widget
 *  counts have to come from the thing under test, not from a flag that silently
 *  goes stale the next time the seed is re-exported. */
async function readSeed() {
  const src = await readFile(join(HERE, '..', 'src', 'default-config', 'config.blank.dashboard.ts'), 'utf8');
  const body = src.split('export const DefaultDashboard: Dashboard[] = ')[1];
  if (!body) throw new Error('could not locate the DefaultDashboard array in its source file');
  return JSON.parse(body.trimEnd().replace(/;$/, ''));
}

// Default: an empty-dashboards profile, so DashboardService seeds the bundled
// DefaultDashboard exactly as on a fresh install. --dashboards serves a given
// array instead, which lets an older seed be rendered by the same bundle.
const dashboardsFile = arg('dashboards', null);
const expected = dashboardsFile ? JSON.parse(await readFile(dashboardsFile, 'utf8')) : await readSeed();
const dashboards = dashboardsFile ? expected : [];

// Realistic SI values for every path the seed subscribes to. A dataless run is
// worthless as verification: a display scale calibrated for one boat, or a slot
// left on the wrong unit, only shows up against a plausible reading. Values are
// SI as Signal K publishes them — the widgets do the conversion.
//
// Expect the data-chart widgets to label their axis 'unitless' and plot raw SI
// here. That is this mock, not the seed: widget-data-chart resolves its measure
// from server path metadata and ignores the stored convertUnitTo by design, and
// the mock publishes no metadata. A real server labels them properly.
const SEED_VALUES = {
  'environment.current.drift': 0.4,
  'environment.current.setTrue': 1.9,
  'environment.depth.belowSurface': 14.2,
  'environment.inside.mainCabin.temperature': 294.2,      // 21 C
  'environment.inside.refridgerator.temperature': 278.2,  // 5 C
  'environment.outside.pressure': 101_300,                // 1013 hPa
  'environment.outside.temperature': 287.2,               // 14 C
  'environment.water.temperature': 285.2,                 // 12 C
  'environment.wind.angleApparent': 0.68,
  'environment.wind.angleTrueWater': 1.05,
  'environment.wind.directionTrue': 3.6,
  'environment.wind.speedApparent': 8.4,
  'environment.wind.speedOverGround': 7.1,
  'environment.wind.speedTrue': 7.4,
  'navigation.attitude': { roll: 0.16, pitch: 0.04, yaw: 1.2 },
  'navigation.course.calcValues.bearingTrue': 3.0,        // ~172 deg
  'navigation.course.calcValues.crossTrackError': 24.5,
  'navigation.course.calcValues.distance': 4820,
  'navigation.courseOverGroundTrue': 1.21,
  'navigation.headingMagnetic': 1.16,
  'navigation.headingTrue': 1.2,
  'navigation.position': { latitude: 60.16, longitude: 24.94 },
  'navigation.speedOverGround': 3.6,
  'navigation.speedThroughWater': 3.4,
  'navigation.state': 'sailing',
  'performance.velocityMadeGood': 2.4,
  'propulsion.main.coolantTemperature': 353.2,            // 80 C
  'propulsion.main.oilTemperature': 363.2,                // 90 C
  'propulsion.main.revolutions': 30,                      // Hz == 1800 rpm
  'propulsion.main.state': 'started',
  'steering.autopilot.engaged': false,
  'steering.autopilot.mode': 'compass',
  'steering.autopilot.state': 'standby',
  'steering.autopilot.target.headingMagnetic': 1.16,
  'steering.rudderAngle': 0.09,
  'tanks.fuel.main.currentLevel': 0.62,                   // ratio, not litres
};

const server = await startServer({ publicDir, base: '/@halos-org/skip/', port });
server.setConfigDocument(serverConfigDocument({ dashboards }));
server.setControl({ streaming: true, rateHz: 4, selfPaths: Object.keys(SEED_VALUES), selfValues: SEED_VALUES });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await ctx.route('https://www.gstatic.com/generate_204', (route) => route.fulfill({ status: 204, body: '' }));
await ctx.addInitScript({ content: initScriptContent(localStorageBundle({ origin: server.origin, subscribeAll: true })) });
const page = await ctx.newPage();

const shots = join(HERE, 'results', 'shots');
await mkdir(shots, { recursive: true });

await page.goto(server.appUrl + '#/dashboard/0', { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('widget-host2', { timeout: 20000 });

const failures = [];
for (const [i, expectedPage] of expected.entries()) {
  await page.goto(server.appUrl + `#/dashboard/${i}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('widget-host2', { timeout: 20000 });
  await page.waitForTimeout(settleMs);
  const count = await page.locator('widget-host2').count();
  const want = (expectedPage.configuration ?? []).length;
  const out = join(shots, `${label}-page${i}.png`);
  await page.screenshot({ path: out });
  // A mis-seeded page boots a plausible near-empty dashboard, which reads as fine
  // in a screenshot — the count is the only thing that catches it.
  if (count !== want) failures.push(`page ${i} (${expectedPage.name}): ${count} widget-host2 rendered, expected ${want}`);
  console.log(`[shot] ${out}  widgets: ${count}/${want}  ${expectedPage.name}`);
}

// New-profile dialog: Settings -> Configurations tab -> New.
await page.goto(server.appUrl + '#/settings', { waitUntil: 'load', timeout: 30000 });
await page.getByRole('tab', { name: 'Configurations' }).click();
await page.getByRole('button', { name: 'New', exact: true }).click();
await page.waitForSelector('dialog-name', { timeout: 10000 });
await page.waitForTimeout(600);
const dialogOut = join(shots, `${label}-new-profile-dialog.png`);
await page.locator('mat-dialog-container').screenshot({ path: dialogOut });
console.log(`[shot] ${dialogOut}`);

await browser.close();
await server.stop();

if (failures.length) {
  console.error(`boot check failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
