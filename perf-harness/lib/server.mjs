/*
 * Combined server for the harness: serves the built Skip app under `base`
 * AND acts as the mock Signal K server (/skServer/loginStatus session,
 * applicationData config, /plugins, /signalk/ discovery, WS delta stream,
 * v2 history) on the SAME origin — so signalKUrl is same-origin (no CORS) and
 * the app talks to a fully controllable data source. Skip is SSO/session-only
 * and always persists config server-side, so the mock must answer the auth
 * probe and serve/absorb the applicationData document — a localStorage-only
 * bootstrap (upstream Kip's approach) boots Skip into a degraded empty app.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { SELF_URN } from './skip-config.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json',
};

const iso = (t) => new Date(t).toISOString();

function genSelfValue(path, t) {
  switch (path) {
    case 'navigation.speedOverGround': return 5 + 2 * Math.sin(t / 1000);
    case 'navigation.headingTrue':
    case 'navigation.courseOverGroundTrue': return ((t / 40) % 360) * Math.PI / 180;
    case 'navigation.position': return { latitude: 47.6 + 0.001 * Math.sin(t / 4000), longitude: -122.33 + 0.001 * Math.cos(t / 4000) };
    case 'environment.depth.belowTransducer': return 12 + 3 * Math.sin(t / 2000);
    case 'environment.wind.angleApparent': return Math.sin(t / 1000);
    case 'environment.wind.speedApparent': return 8 + 3 * Math.sin(t / 1500);
    default: return Math.sin(t / 1000) * 100;
  }
}

function selfDelta(paths, t) {
  return JSON.stringify({ context: SELF_URN, updates: [{ $source: 'mock.0', timestamp: iso(t), values: paths.map((p) => ({ path: p, value: genSelfValue(p, t) })) }] });
}

function aisDelta(mmsi, i, t) {
  return JSON.stringify({
    context: `vessels.urn:mrn:imo:mmsi:${mmsi}`,
    updates: [{ $source: 'mock.ais', timestamp: iso(t), values: [
      { path: 'navigation.position', value: { latitude: 47.6 + 0.02 * Math.sin(t / 3000 + i), longitude: -122.33 + 0.02 * Math.cos(t / 3000 + i) } },
      { path: 'navigation.headingTrue', value: ((i * 11 + t / 50) % 360) * Math.PI / 180 },
      { path: 'navigation.courseOverGroundTrue', value: ((i * 11) % 360) * Math.PI / 180 },
      { path: 'navigation.speedOverGround', value: 3 + (i % 6) },
      { path: 'mmsi', value: String(mmsi) },
    ] }],
  });
}

// Deterministic scene deltas (for reproducible before/after radar screenshots).
function selfSceneDelta(o, t) {
  return JSON.stringify({ context: SELF_URN, updates: [{ $source: 'mock.0', timestamp: iso(t), values: [
    { path: 'navigation.position', value: { latitude: o.lat, longitude: o.lon } },
    { path: 'navigation.headingTrue', value: (o.heading ?? 0) * Math.PI / 180 },
    { path: 'navigation.courseOverGroundTrue', value: (o.cog ?? o.heading ?? 0) * Math.PI / 180 },
    { path: 'navigation.speedOverGround', value: o.sog ?? 5 },
  ] }] });
}
function targetSceneDelta(tg, t) {
  return JSON.stringify({ context: `vessels.urn:mrn:imo:mmsi:${tg.mmsi}`, updates: [{ $source: 'mock.ais', timestamp: iso(t), values: [
    { path: 'navigation.position', value: { latitude: tg.lat, longitude: tg.lon } },
    { path: 'navigation.headingTrue', value: (tg.heading ?? 0) * Math.PI / 180 },
    { path: 'navigation.courseOverGroundTrue', value: (tg.cog ?? tg.heading ?? 0) * Math.PI / 180 },
    { path: 'navigation.speedOverGround', value: tg.sog ?? 4 },
    { path: 'name', value: tg.name ?? `T${tg.mmsi}` },
    { path: 'mmsi', value: String(tg.mmsi) },
  ] }] });
}

// Skip gates widget history on server.version >= 2.22.1 (settings.service.ts).
const SERVER_VERSION = '2.24.0';

function helloMsg() {
  return JSON.stringify({ name: 'skip-mock', version: SERVER_VERSION, self: SELF_URN, roles: ['master', 'main'], timestamp: iso(Date.now()) });
}

// Raw /plugins list entry (IRawPluginInformation). getPlugin() reads plugin
// configuration from the LIST response, not the /plugins/kip detail, so
// historySeriesServiceEnabled:false must live here to suppress the
// series-reconcile POST that otherwise fires ~750ms after boot.
const KIP_PLUGIN_LIST = [{
  id: 'kip', name: 'KIP', packageName: 'kip', keywords: [], version: '0.0.0',
  description: 'mock', schema: null,
  data: { configuration: { historySeriesServiceEnabled: false, registerAsHistoryApiProvider: false }, enabled: true, enableLogging: false, enableDebug: false },
}];
// IRawPluginDetail for GET /plugins/kip.
const KIP_PLUGIN_DETAIL = { id: 'kip', name: 'KIP', version: '0.0.0', enabled: true };

function historyResponse(paths, rows, stepSec) {
  const base = Date.parse('2026-06-30T00:00:00.000Z');
  const values = paths.flatMap((p) => [{ path: p, method: 'sma' }, { path: p, method: 'avg' }, { path: p, method: 'min' }, { path: p, method: 'max' }]);
  const data = [];
  for (let i = 0; i < rows; i++) {
    const row = [iso(base + i * stepSec * 1000)];
    for (let k = 0; k < values.length; k++) row.push(5 + Math.sin((i + k) / 10));
    data.push(row);
  }
  return { context: 'vessels.self', range: { from: iso(base), to: iso(base + rows * stepSec * 1000) }, values, data };
}

/**
 * @param {object} o { publicDir, base, port }
 * Returns { origin, appUrl, setControl(c), blast(n), streamCount(), stop() }.
 * control: { streaming:bool, rateHz, selfPaths:[], ais:{count, churnPerSec} }
 */
export async function startServer({ publicDir, base, port }) {
  const control = { streaming: false, rateHz: 10, selfPaths: ['navigation.speedOverGround'], ais: { count: 0, churnPerSec: 0 } };
  let history = { rows: 0, stepSec: 1, paths: ['navigation.speedOverGround'] };
  let configDoc = null; // IConfig served from applicationData (set per scenario by the runner)
  let sent = 0;
  let mmsiBase = 100000000;

  const json = (res, body) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    // --- Signal K endpoints (origin root) ---
    if (p === '/signalk' || p === '/signalk/') {
      return json(res, {
        endpoints: { v1: { version: SERVER_VERSION, 'signalk-http': `http://localhost:${port}/signalk/v1/api/`, 'signalk-ws': `ws://localhost:${port}/signalk/v1/stream` } },
        server: { id: 'skip-mock', version: SERVER_VERSION },
      });
    }
    // Session probe: Skip is session-cookie SSO-only; a loggedIn answer with a
    // write-capable userLevel unlocks the server-side config bootstrap.
    if (p === '/skServer/loginStatus') {
      return json(res, { status: 'loggedIn', username: 'harness', userLevel: 'admin' });
    }
    // applicationData: config document + slot listing; POSTs (the boot Dashboards
    // JSON-Patch and autosaves) are absorbed with 200 — any non-2xx would put a
    // persistent error snackbar into the measurement.
    if (p.startsWith('/signalk/v1/applicationData/')) {
      if (req.method === 'POST') { req.resume(); return req.on('end', () => json(res, {})); }
      const m = p.match(/^\/signalk\/v1\/applicationData\/(user|global)\/skip\/\d+\/(.*)$/);
      if (m && url.searchParams.get('keys') === 'true') return json(res, m[1] === 'user' ? ['default'] : []);
      if (m && m[2] === 'default' && m[1] === 'user') return json(res, configDoc ?? {});
      return json(res, {}); // SK answers never-created slots with 200 {}
    }
    // Plugin surface: disable the KIP history-series service so the dashboard
    // sync's reconcile POST (~750ms after boot) is skipped.
    if (p === '/plugins' || p === '/plugins/') return json(res, KIP_PLUGIN_LIST);
    if (p === '/plugins/kip') return json(res, KIP_PLUGIN_DETAIL);
    if (p === '/plugins/kip/series/reconcile' && req.method === 'POST') {
      req.resume();
      return req.on('end', () => json(res, { created: 0, updated: 0, deleted: 0, total: 0 }));
    }
    if (p.startsWith('/signalk/v2/api/history/values')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(historyResponse(history.paths, history.rows, history.stepSec)));
    }
    if (p.startsWith('/signalk/v1/api')) { // snapshot / misc — empty model
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end('{}');
    }
    // --- static app ---
    let rel = p.startsWith(base) ? p.slice(base.length) : p.replace(/^\//, '');
    if (p === '/') { res.writeHead(302, { Location: base }); return res.end(); }
    rel = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    let file = join(publicDir, rel);
    try { if (!(await stat(file)).isFile()) throw 0; } catch {
      if (!extname(rel)) file = join(publicDir, 'index.html'); else { res.writeHead(404); return res.end('nf'); }
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end('nf'); }
  });

  const wss = new WebSocketServer({ server, path: '/signalk/v1/stream' });
  // Skip opens its WS once during APP_INITIALIZER (before the scenario's
  // setControl) and keeps it — so a connection-time snapshot of rateHz (as
  // upstream Kip could afford) would stream every scenario at the boot-time
  // default. Timers restart on rateHz changes instead.
  const timerRestarts = new Set();
  wss.on('connection', (ws) => {
    ws.send(helloMsg());
    const sendTick = () => {
      if (!control.streaming || ws.readyState !== ws.OPEN) return;
      const t = Date.now();
      // Deterministic scene: fixed own-ship + fixed targets (reproducible screenshots).
      if (control.staticScene) {
        ws.send(selfSceneDelta(control.staticScene.ownShip, t)); sent++;
        for (const tg of control.staticScene.targets) { ws.send(targetSceneDelta(tg, t)); sent++; }
        return;
      }
      ws.send(selfDelta(control.selfPaths, t)); sent++;
      const n = control.ais.count | 0;
      for (let i = 0; i < n; i++) { ws.send(aisDelta(mmsiBase + i, i, t)); sent++; }
      // churn: introduce brand-new MMSIs over time (unbounded-growth scenario)
      const churn = control.ais.churnPerSec | 0;
      if (churn) {
        const per = Math.max(1, Math.round(churn / control.rateHz));
        for (let c = 0; c < per; c++) { mmsiBase++; ws.send(aisDelta(mmsiBase + n, n + c, t)); sent++; }
      }
    };
    let timer = null;
    const startTimer = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(sendTick, Math.max(1, Math.round(1000 / control.rateHz)));
    };
    startTimer();
    timerRestarts.add(startTimer);
    ws.on('close', () => { clearInterval(timer); timerRestarts.delete(startTimer); });
    // Many separate frames (sustained flood) — each is its own onmessage task.
    ws._blast = (count) => { const t = Date.now(); for (let i = 0; i < count; i++) { ws.send(selfDelta(control.selfPaths, t + i)); sent++; } };
    // ONE frame carrying many values (reconnect snapshot) — a single synchronous
    // parse + fan-out, i.e. the worst-case long task that coalescing must bound.
    ws._blastBig = (nValues) => {
      const t = Date.now();
      const values = [];
      for (let i = 0; i < nValues; i++) values.push({ path: `sensors.mock.n${i}.value`, value: Math.sin((t + i) / 1000) });
      ws.send(JSON.stringify({ context: SELF_URN, updates: [{ $source: 'mock.0', timestamp: iso(t), values }] }));
      sent++;
    };
  });

  await new Promise((r) => server.listen(port, r));
  const origin = `http://localhost:${port}`;
  return {
    origin, appUrl: `${origin}${base}`,
    setControl(c) {
      const rateChanged = c.rateHz !== undefined && c.rateHz !== control.rateHz;
      Object.assign(control, c);
      if (c.history) history = { ...history, ...c.history };
      if (rateChanged) for (const restart of timerRestarts) restart();
    },
    setConfigDocument(doc) { configDoc = doc; },
    blast(count) { for (const ws of wss.clients) if (ws._blast) ws._blast(count); },
    blastBig(nValues) { for (const ws of wss.clients) if (ws._blastBig) ws._blastBig(nValues); },
    streamCount() { return sent; },
    stop() { return new Promise((r) => { for (const ws of wss.clients) ws.terminate(); server.close(() => r()); }); },
  };
}
