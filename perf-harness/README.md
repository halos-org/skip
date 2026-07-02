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
# compare two result files (by label):
node report.mjs --a pre-fix --b main
```

`--branch` builds live in `perf-harness/worktrees/` (gitignored) and persist
for reuse; they stay registered in the parent clone's `git worktree list`.
`git worktree prune` alone does not deregister them while the directories
exist — `git worktree remove` each one, or delete `perf-harness/worktrees/`
and then run `git worktree prune`.

`screenshot.mjs` renders the AIS radar with a fixed deterministic scene for
visual before/after; `verify-click.mjs` checks radar hit-testing (overlapping
targets under view rotation) end-to-end.

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
- The mock restarts live per-connection stream timers when a scenario changes
  `rateHz`: Skip opens its WS once at `APP_INITIALIZER` and keeps it, so
  upstream's connect-time rate snapshot would stream every scenario at the
  boot-time default rate.
- Determinism hardening (fork-authored): gstatic probe answered locally, and
  `waitForBoot` asserts the rendered widget count (see Honesty safeguards).
- Upstream's `results/` baselines are not carried over — they measure Kip
  builds. Skip baselines are captured separately.
