# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Skip — an Angular 21 (zoneless, signals, new control flow) Signal K marine multi-function display. A **standalone fork** of `mxtommy/kip` (not a GitHub fork object), rebranded `@halos-org/skip`, maintained for HaLOS. It's a Signal K webapp the SK server serves at the path `/@halos-org/skip/` (its own npm package name). The `upstream` remote points at `mxtommy/kip` for occasional cherry-picking. The fork's reason to exist is its auth + profiles work (below), which upstream did not accept.

**Staying rebaseable on upstream is an explicit non-goal.** Pulling an upstream feature in may mean partially reimplementing it. Design decisions weigh correctness and our own maintenance cost — never rebase risk or whether code is upstream-maintained vs. fork-added. When upstream *is* pulled in, the CI re-apply notes (see "Testing reality" and "Fork-specific gotchas") still apply opportunistically, but they never constrain what we choose to change or remove.

## Commands

- `npm run dev` — dev server (serve-path `/@halos-org/skip/`).
- `npm run build:prod` / `npm run build:dev` — Angular app build (output → `public/`). `npm run build:all` also builds the plugin.
- `npm test` — full unit suite, headless (vitest via `@angular/build:unit-test`). `npm run test:interactive` for watch mode.
- `npm run lint` — ESLint (flat config). `@typescript-eslint/no-explicit-any` is an **error**, and `no-unused-vars` does **not** ignore `_`-prefixed params — drop unused params, don't underscore them.
- `npm run build:plugin` then `npm run test:plugin` — the server-side `kip-plugin/` (Node `--test`).
- `npm run generate:widget` — schematic that scaffolds a Host2 widget (preferred over hand-writing one).

Node: the app builds on Node 20+; the kip-plugin's built-in history provider needs Node ≥22.5 (`node:sqlite`). CI runs the matrix 20/22/24.

## Performance and freeze measurement (perf-harness/)

Self-contained freeze/jank harness (own `package.json`, never touches app deps): builds the **real production bundle**, drives it in headless Chromium at **10× CPU throttle** (Pi-class HaLOS target) against a **mock Signal K server** on one origin. Use it for perf-sensitive changes to widgets, rendering, or the data pipeline, and for before/after numbers when replicating upstream perf work. Full operator docs: `perf-harness/README.md`.

The three commands (from `perf-harness/`, after `npm install` there):

```bash
node run.mjs --public ../public --label dev --scenarios resize-storm --repeats 2  # quick, prebuilt ../public
node run.mjs --branch main --label main       # full 7-scenario suite against any git ref
node report.mjs --a pre-freeze-fixes --b main-freeze-fixes   # compare two labels
```

Traps that cost real time:

- **Results accumulate per label**: scenarios merge into any existing `results/<label>.json`. Reusing a label for a different ref keeps the old ref's scenario entries under the new `branch` field — delete the file first.
- **Blocking time and delta counts are raw sums over the probe window**, and the window self-extends while the throttled main thread is busy. Check the report's window-ms context row before claiming a regression from a small delta.
- **Heap metrics are noise-dominated** (no forced GC; same-ref spreads of 5–21 MB observed). No leak claims from them without a sustained slope across repeats.
- **AIS scenarios have large run-to-run variance** (same-build blocking spread 7.8–9.7 s observed) — never conclude from a single rep; compare against a same-build re-run (`results/diag-*.json` are committed examples).
- **A boot-assertion failure** (`boot check failed: N widget-host2 rendered, expected M`) means the seeded config is wrong for that build (version or widget-schema drift) — not a flake. A mis-seeded config boots a plausible empty dashboard; the assert exists to catch exactly that.
- `--branch` builds register **nested git worktrees** under `perf-harness/worktrees/`; `git worktree prune` alone does not deregister them — `git worktree remove` each one, or delete `perf-harness/worktrees/` and then prune.
- Chrome path defaults to the macOS app bundle; set `CHROME_BIN` on other platforms.

The mock serves Skip's full session/config surface (`loginStatus`, `applicationData`, `/plugins`) because Skip is session-SSO-only with server-side config — a localStorage-only bootstrap boots a degraded app; see the README. Committed baselines: `pre-freeze-fixes` (11f3fbd0, before the #119/#120/#121/#122/#135 freeze fixes) and `main-freeze-fixes` (2e358f17).

## Testing reality (read before touching specs)

- The runner is **vitest** (`vitest.config.ts`, `environment: jsdom`) driven by `@angular/build:unit-test`. `src/test.ts` is the setup file and **monkey-patches `TestBed.configureTestingModule`** to inject a large set of global stubs/providers (SettingsService, AuthenticationService, SignalKConnectionService, ConnectionStateMachine, MatDialog refs, the widget host directives, etc.). Specs override these by listing their own local providers (local wins; globals are prepended).
- **CI is the source of truth for tests, not local runs.** The local jsdom environment often lacks a usable `localStorage`, so services that read it at construction (Settings/Auth/Storage) crash locally in ways that do not occur in CI. `npm run lint` is reliable locally.
- Run a **single spec** with `ng test --include='<path/to/file.spec.ts>'` — it goes through the `@angular/build:unit-test` builder (Angular linker + JIT). Plain `npx vitest run <file>` fails with `@angular/compiler is not available` / JIT errors because it bypasses that builder. Specs that don't touch `localStorage` at construction (e.g. the delta/requests parsers) run cleanly this way locally; Settings/Auth/Storage still need CI.
- Use **`npm install`**, not `npm ci` — the committed lockfile is out of sync (npm ci errors on missing optional platform deps). CI also uses `npm install`.
- The most common spec failure is **stub drift**: a real service gained a method/observable that the global stub in `src/test.ts` (or a spec's own local mock) doesn't expose, yielding "X is not a function" or `.subscribe`/`.pipe` of undefined at construction. Fix the stub/mock, not app code. Services subscribe to `conn.serverServiceEndpoint$` and `conn.serverVersion$` at construction, so partial `SignalKConnectionService` mocks must provide them.

## Architecture (the parts that need several files to grasp)

**Runtime data pipeline** (`src/app/core/services/`): `SignalKConnectionService` (endpoint discovery) → `ConnectionStateMachine` (explicit connection lifecycle; registers callbacks so it carries no upward deps) → `SignalKDeltaService` (parses SK delta messages) → `DataService` (central hub mapping deltas to per-path observables; every value is written to both a `default` bucket and a per-`$source` bucket) → widgets. The DI graph is intentionally acyclic: `connection ← auth ← storage ← settings`, `data ← delta ← connection`.

**Widgets** (`src/app/widgets/`, ~46) are standalone components composed with three **host directives** that own runtime concerns: `WidgetRuntimeDirective` (config merge), `WidgetStreamsDirective` (diff-based path subscriptions), `WidgetMetadataDirective` (zones/meta). `WidgetService` is the registry — `kipWidgets` is a getter over the `_widgetDefinition` array; the full electrical family (bms, solar-charger, charger, alternator, inverter, ac) is registered and live.

**Config & persistence**: `SettingsService` holds in-memory config plus sync getters and observable getters. `StorageService` persists through the SK server's **applicationData REST API**, which has exactly two scopes — `user` (the authenticated user's private store) and `global` (a single shared bucket). All writes go through a **sequential JSON-Patch queue** because SK can't handle concurrent applicationData writes. `ConfigurationUpgradeService` migrates older config file versions (preserve the stored version on write).

**Auth & profiles** (the fork's additions): `AuthenticationService` authenticates **only** through the same-origin Signal K server session (SSO behind the reverse proxy). The httpOnly session cookie is the sole credential — the HTTP interceptor sends it on same-origin requests, session state derives from `GET /skServer/loginStatus`, and `SsoRedirectService` owns the sign-in redirect. SKip never collects, stores, or transmits raw credentials or tokens. `ProfileService` adds **named configuration profiles decoupled from user accounts** (multiple dashboards/layouts under one identity), stored as user-scope applicationData slots. Write capability is gated on the session's `userLevel`, not on a read-only flag.

**History & charts**: the SK **v2 History API** is consumed by `HistoryApiClientService` / `KipSeriesApiClientService`; `HistoryToChartMapperService` adapts history values to chart datapoints; `DashboardHistorySeriesSyncService` reconciles series; `HistoryChartStreamService` feeds the trend-chart widgets (History-API backfill plus a thin delta-stream live tail). `kip-plugin/` is an optional server-side history provider backed by `node:sqlite`.

## Fork-specific gotchas

- **The package name is the serving path.** `angular.json` `baseHref`, the `dev` serve-path, and `src/manifest.json` `id`/`scope`/`start_url` must all stay `/@halos-org/skip/`. Branding lives in `brand/` (vector master, repo-only), `src/assets/` (favicon/icon set), `src/manifest.json`, and `signalk.displayName` in `package.json`.
- **`gh` defaults PRs to the `upstream` remote.** Always pass `--repo halos-org/skip` to `gh pr create` / `gh pr merge`. (The clone is set up with `gh repo set-default halos-org/skip` and a disabled upstream push URL, but pass it explicitly anyway.)
- **Upstream's own vitest CI is red**; a rebase onto `mxtommy/kip` can re-introduce test failures. The fork's fixes are small and live in `src/test.ts` stubs plus a few specs — re-apply them rather than disabling tests.
- Not published to npm (publishing would list it in the Signal K app store). Deploy by placing the built `public/` output where the SK server serves the webapp.

## Inherited upstream docs — treat skeptically

`COPILOT.md` and `.github/instructions/*.instructions.md` are upstream Kip's AI-guidance files, not ours. They are unverified and partly stale — e.g. they tell you to run `npm run test:all`, which is **not** a script in this repo. Use them at most as loose architecture hints, and verify any command or claim against `package.json` and the actual code before relying on it.
