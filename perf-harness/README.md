# Skip freeze-audit measurement harness

Reproducible, honest before/after measurement of main-thread **freezes**
("randomly unresponsive; can't exit fullscreen"). Self-contained — its deps live
in `perf-harness/package.json` and never touch the app's `package.json`.

Adopted from upstream [mxtommy/Kip#1101](https://github.com/mxtommy/Kip/pull/1101)
and ported to Skip; see *Divergences from upstream* below.

## What it measures (the symptom, not proxies)

The same probe (`probe.js`) is injected into every build under test via Playwright
`addInitScript`, so measurement code is identical across branches:

| Metric | Meaning |
|---|---|
| `longTaskMaxMs` / `blockingTimeMs` | Longest single main-thread task, and total blocking time (Σ max(0, dur−50)). The browser's own "the main thread was stuck" signal. |
| `taskLatencyMaxMs` / `p95` | A 16 ms self-rescheduling timer's lateness = **how long a queued handler (e.g. the exit-fullscreen keydown) waits**. The honest "frozen" proxy. |
| `frameMaxGapMs` / `framesDropped` | rAF inter-frame gaps → dropped frames. |
| `heapGrowthMB` / `heapSlopeKBps` | `usedJSHeapSize` slope over time (unbounded-growth findings). |

## How it works

`run.mjs` builds a ref's **production** bundle in an isolated git worktree
(`lib/build-serve.mjs`), serves it plus a **mock Signal K server** on one origin
(`lib/server.mjs` — no CORS), throttles CPU via CDP to emulate low-power marine
hardware (Skip's Pi-class HaLOS target), runs each scenario K times, and writes
`results/<label>.json` (raw + median/p95).

Skip's boot config is split across two tiers (`lib/kip-config.mjs`):

- **localStorage** gets only `skip.connectionConfig` — the sole key Skip reads at
  boot — pointing `signalKUrl` at the mock's origin.
- **Everything else** (app/theme/dashboards) is an `IConfig` document the mock
  serves from `applicationData/user/skip/<ver>/default`. Skip always persists
  config server-side; there is no anonymous localStorage mode to bootstrap into.

**Mock auth:** Skip is session-cookie SSO-only. The mock answers
`GET /skServer/loginStatus` with a logged-in admin session, absorbs the boot
Dashboards JSON-Patch/autosave POSTs with 200 (a failure would park an error
snackbar inside the measurement), reports the KIP history-series plugin as
disabled (suppressing the series-reconcile POST ~750 ms after boot), and
advertises server version 2.24.0 (Skip gates widget history on ≥ 2.22.1).

## Scenarios → audit findings (`scenarios.mjs`)

| Scenario | Reproduces |
|---|---|
| `resize-storm` | Rank 1 — shared ResizeObserver reallocates every canvas in one task (the fullscreen enter/exit storm). |
| `delta-storm-30x10` / `reconnect-backlog` | Rank 2 — delta ingestion / reconnect snapshot fan-out. |
| `ais-radar-150` | Ranks 4/5 — AIS radar full re-render loops. |
| `gauges-16` | Rank 7 — ng-canvas-gauge animation duty cycle. |
| `ais-growth-churn` | Ranks 8/9 — unbounded AIS/track growth (heap slope). |

## Run

```bash
cd perf-harness && npm install
node smoke.mjs                       # probe sanity check (no app build needed)
# baseline a ref (throttle defaults to 10x CPU):
node run.mjs --branch main --label main
node run.mjs --branch 11f3fbd0 --label pre-fix   # pre-#119/#120/#121/#122/#135 baseline
# fast iteration against an already-built ../public (the app's build output):
node run.mjs --public ../public --label dev --scenarios ais-radar-150 --repeats 2
# long suites can be chunked: per-scenario runs under one label accumulate
# into the same results/<label>.json (--no-rebuild reuses the built worktree):
node run.mjs --branch main --label main --no-rebuild --scenarios gauges-16
# compare two result files (by label):
node report.mjs --a pre-fix --b main
```

`--branch` builds live in `perf-harness/worktrees/` (gitignored) and persist
for reuse; they stay registered in the parent clone's `git worktree list`.
`git worktree prune` alone does not deregister them while the directories
exist — `git worktree remove` each one, or delete `perf-harness/worktrees/`
and then run `git worktree prune`.

Label reuse hazard: because scenario results merge into any existing
`results/<label>.json`, re-pointing a label at a different ref keeps the old
build's scenario entries under the new `branch` field. Delete the file before
reusing a label for a different build.

`screenshot.mjs` renders the AIS radar with a fixed deterministic scene for
visual before/after; `verify-click.mjs` checks radar hit-testing (overlapping
targets under view rotation) end-to-end.

`shot-boolean.mjs` renders the boolean-switch (Switch Panel) widget across a
control-count × label-length × tile-size matrix (day + light themes), writes
`results/shots/boolean/<name>.png` per tile, and prints per-control shared height
with a 44px tap-target flag — the #318 long-label panel-shrink probe. It boot-asserts
that each tile rendered its seeded control count (exits non-zero otherwise). Invoke
with `CHROME_BIN=/usr/bin/chromium node shot-boolean.mjs --public ../public` after a
`../public` build.

`shot-embed.mjs` boots Skip with and without the `?embed` pre-hash query flag and
asserts the #216 chromeless contract: the toolbar (`<app-toolbar>`) is present
normally but unmounted under embed, while all seeded dashboard widgets still render;
an unknown `?profile` falls back to the default dashboard. Exits non-zero on any
failure; writes `results/shots/embed/<label>.png`. It verifies the Skip-side embed
behavior, not rendering inside the actual Freeboard-SK drawer, and covers only the
profile-fallback (not positive profile-switching, which needs a second seeded slot).

`shot-units.mjs` renders a numeric widget per `convertUnitTo` across a unit spread
and screenshots the grid to `results/shots/units/units-grid.png` — the #245 display-
symbol probe (kn, km/h, °C, gal, gal/min, Ω, …). The unit label is canvas-drawn, so
the machine step boot-asserts only the tile count; **symbol correctness is a human
eyeball of the screenshot** (each tile is labelled by its measure key). The symbol
resolution itself is unit-tested in `units.service.spec.ts`.

Both invoke as `CHROME_BIN=/usr/bin/chromium node <probe> --public ../public` after a
`../public` build.

## Interpreting the numbers

| Question | Metric | Caveat |
|---|---|---|
| Would a queued handler (e.g. the exit-fullscreen keydown) have hung? | `taskLatencyMaxMs` / `taskLatencyP95Ms` | Max is one worst sample; p95 is the more stable signal. |
| Is there a single monster task? | `longTaskMaxMs` | — |
| How much total jank over the scenario? | `blockingTimeMs` | Raw sum over the probe window, which self-extends under load — compare the labels' median window lengths (report context row) before trusting small deltas. |
| Are animations dropping frames? | `frameMaxGapMs` / `framesDropped` | — |
| Is memory growing without bound? | `heapGrowthMB` / `heapSlopeKBps` | Weakest metrics: no forced GC, `usedJSHeapSize` includes uncollected garbage; same-ref spreads of 5–21 MB observed. |

Claims the data cannot support:

- Small blocking-time deltas between labels whose median windows differ —
  normalize to a common window or dismiss.
- Leak conclusions from heap deltas inside the same-ref spread.
- Anything from a single AIS-scenario rep: `results/diag-pre-variance.json`
  (the same build measured twice) spans blocking 7.8–9.7 s on `ais-radar-150`.
- Comparisons across machines, Chrome versions, or throttle factors. Both are
  recorded in every results JSON — compare like for like only.

## Adding a scenario

1. Append an entry to `scenarios` in `scenarios.mjs`: `label`, `note`,
   `subscribeAll`, `durationMs`, `warmupMs`, `dashboards()` returning
   `buildDashboards([...])` from widget factories, and `control`
   (`rateHz`, `selfPaths`, `ais: { count, churnPerSec }`). Add an
   `action(page, server, durationMs)` only when the scenario needs interaction
   (viewport resizes, `blastBig`); otherwise the runner just waits `durationMs`.
2. Widget factories live in `lib/kip-config.mjs` (`numericWidget`,
   `radialGaugeWidget`, `aisRadarWidget`). For a new widget type, add a factory
   whose `config` shape is taken verbatim from the widget's current schema — a
   mis-shaped config silently renders defaults instead of erroring.
3. The boot assertion expects exactly `dashboards[0].configuration.length`
   rendered `widget-host2` elements: one factory, one widget host. A widget that
   fails to render fails the run.
4. Verify solo against a prebuilt bundle:

   ```bash
   node run.mjs --public ../public --label dev --scenarios <label> --repeats 2
   ```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `boot check failed: 0 widget-host2 rendered, expected N` | The build rejected or ignored the seeded config — config-version drift (three distinct version spaces; see the `lib/kip-config.mjs` header) or widget-schema drift — and booted the default empty dashboard | Diff `lib/kip-config.mjs` version constants and widget config shapes against the ref's `src/`; rerun with `--headed` to watch the boot |
| App boots degraded or lands on the sign-in flow | The build probes a session/config endpoint the mock doesn't answer (`loginStatus`, `applicationData`, `/plugins`, discovery) | Cover the endpoint in `lib/server.mjs`; find the missing call with `--headed` and devtools |
| Console shows `Unexpected token '<'` / an API response is HTML | An extensionless request fell through to the SPA `index.html` fallback — an unmocked API route | Same as above: add the route to `lib/server.mjs` |
| `ENOENT … results/<label>.json` from `report.mjs` | Label typo, or the run never completed a scenario | `ls results/`; report labels must match `run.mjs --label` exactly |
| `EADDRINUSE` at startup | A previous run's server still listening (default port 4399) | Kill the stray `node` process or pass `--port` |
| Chromium launch fails: executable not found | Non-macOS host; the default Chrome path is the macOS app bundle | Set `CHROME_BIN` to the local Chrome/Chromium binary |

## Honesty safeguards

- Identical probe + scenarios + fixed CPU throttle across all refs; Chrome
  version recorded in each result.
- K repeats reported as **median and p95**, with every raw run kept in the JSON.
- Boot is asserted, not assumed: each repeat must render exactly the scenario's
  widget count or the run fails — a mis-seeded config would otherwise boot a
  plausible-looking empty dashboard and silently measure the wrong thing.
- The one external request Skip makes (the `gstatic.com/generate_204`
  reachability probe, re-fired on connection changes and every 60 s) is answered
  locally via a Playwright route, so no real network noise lands in the window.
- Negative results are reported too (upstream found the delta fan-out is *not* a
  measurable freeze at realistic rates — the rendering loops are).

## Divergences from upstream Kip#1101

- Serving base is `/@halos-org/skip/` (Skip's `baseHref`), not `/@mxtommy/kip/`.
- Mock adds Skip's session/config/plugin surface: `loginStatus`,
  `applicationData` GET/POST (config file version path segment matched
  per-request), `/plugins` + `/plugins/kip` (+ reconcile absorb), and a modern
  `server.version` in the discovery document.
- `lib/kip-config.mjs` (name kept for upstream-reconcile friendliness): only
  `skip.connectionConfig` is seeded into localStorage (upstream's bare
  `connectionConfig`/`appConfig`/`dashboardsConfig`/`themeConfig` keys are dead
  in Skip); a new `serverConfigDocument()` feeds the mock; the radial-gauge
  factory sets `displayScale` (upstream's top-level `minValue`/`maxValue` are
  dead in Skip and silently rendered a default 0–100 scale); dashboards drop
  Kip's `collapseSplitShell`.
- `report.mjs` prints each label's median probe-window length per scenario: the
  window self-extends while the throttled main thread is busy, so raw window
  sums (blocking time) drift with it and small deltas need the window context.
- The mock restarts live per-connection stream timers when a scenario changes
  `rateHz`: Skip opens its WS once at `APP_INITIALIZER` and keeps it, so
  upstream's connect-time rate snapshot would stream every scenario at the
  boot-time default rate.
- Determinism hardening (fork-authored): gstatic probe answered locally, and
  `waitForBoot` asserts the rendered widget count (see Honesty safeguards).
- Upstream's `results/` baselines are not carried over — they measure Kip
  builds. Skip baselines are captured separately.
