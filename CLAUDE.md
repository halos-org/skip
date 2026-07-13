# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Skip — an Angular 21 (zoneless, signals, new control flow) Signal K marine multi-function display. A **standalone fork** of `mxtommy/kip` (not a GitHub fork object), rebranded `@halos-org/skip`, maintained for HaLOS. It's a Signal K webapp the SK server serves at the path `/@halos-org/skip/` (its own npm package name). The `upstream` remote points at `mxtommy/kip` for occasional cherry-picking. The fork's reason to exist is its auth + profiles work (below), which upstream did not accept.

**Staying rebaseable on upstream is an explicit non-goal.** Pulling an upstream feature in may mean partially reimplementing it. Design decisions weigh correctness and our own maintenance cost — never rebase risk or whether code is upstream-maintained vs. fork-added. When upstream *is* pulled in, the CI re-apply notes (see "Testing reality" and "Fork-specific gotchas") still apply opportunistically, but they never constrain what we choose to change or remove.

## Commands

- `npm run dev` — dev server (serve-path `/@halos-org/skip/`).
- `npm run build:prod` / `npm run build:dev` — Angular app build (output → `public/`).
- `npm test` — full unit suite, headless (vitest via `@angular/build:unit-test`). `npm run test:interactive` for watch mode.
- `npm run lint` — ESLint (flat config). `@typescript-eslint/no-explicit-any` is an **error**, and `no-unused-vars` does **not** ignore `_`-prefixed params — drop unused params, don't underscore them.
- `npm run generate:widget` — schematic that scaffolds a Host2 widget (preferred over hand-writing one).
- `./run` — standard HaLOS dispatcher (`./run help` for commands): `build`, `test`, `lint`, `ci` (lint + betterer:ci + tests, the CI gate), `bumpversion patch|minor|major`.

Node: the app builds on Node 20+, but only **Node 24 is CI-verified** (`run-tests` and the npm-publish job run Node 24 — the 20/22/24 matrix was dropped when the bespoke `ci.yml` was replaced).

CI is the standard HaLOS triad: `pr.yml` → shared `pr-checks` (with `skip-lintian`), `main.yml` → shared `build-release` in npm-only mode (`build-deb: false`; cuts a draft stable release), `release.yml` → `npm publish` when that release is published. `VERSION` is the source of truth, synced to `package.json` by `./run bumpversion`. In npm-only mode a `+N`-only merge (no `VERSION` change) cuts a GitHub release that publishes nothing to npm — bump `VERSION` to ship a new version.

## strictNullChecks ratchet (betterer)

`strictNullChecks` is not yet enabled in the app build — the codebase still has hundreds of latent null-safety issues, migrated file-by-file (issue #6). A [betterer](https://phenomnomnominal.github.io/betterer/) ratchet holds the line: the count can only go down.

- `npm run snc` — `tsc -p tsconfig.strict.json`, lists your remaining `strictNullChecks` errors. `tsconfig.strict.json` is the single source of the strict compiler options and the checked file scope (all `src/**/*.ts`, no specs, no `test.ts`).
- `npm run betterer` — **regenerates** `.betterer.results` (the committed baseline). Run and commit this whenever you fix a file **or merge/rebase main into your branch**.
- `npm run betterer:ci` — the ratchet check CI runs (inside `npm run ci` in the `run-tests` action); fails on any new issue.

The baseline is keyed by file **content hash**, so any content change to a tracked file — a real fix, or just merging main — invalidates its key and makes `betterer:ci` fail with "unexpected changes" until you regenerate. If CI reports the same count but "unexpected changes", that's the tell: run `npm run betterer` and commit the result. The check runs on Node 24; the baseline is Node-portable (Node 20/22/24 produce identical results). `tsconfig.betterer.json` is only the ts-node loader config for `.betterer.ts`, not a check config.

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

- The runner is **vitest** (`vitest.config.ts`, `environment: jsdom`) driven by `@angular/build:unit-test`. `src/test.ts` is the setup file and **monkey-patches `TestBed.configureTestingModule`** to prepend a small set of global providers to every spec.
- **Specs run against the REAL app services, by design.** Under this runner the setup file's classes are *different module instances* than the app bundle's, so **any** `{ provide: AppClass, … }` in `src/test.ts` — a stub **or** the real class — is **DI-inert** (proven in #159). A component that injects a **`providedIn: 'root'`** service still gets its real root instance regardless; a **non-root** service (e.g. `UnitsService`, a plain `@Injectable()`) must be provided by the spec that needs it. So `src/test.ts` provides **only** what actually takes effect: framework tokens (`MAT_DIALOG_DATA`, `MatDialogRef`, `MatBottomSheetRef`, `ActivatedRoute`, `FormGroupDirective`, zoneless CD, `HttpClientTesting`, `NoopAnimations`), env/DOM shims (canvas, `ResizeObserver`, `matchMedia`, fonts, media), and icon registration. It provides **no** app services — not `SettingsService` / `AuthenticationService` / `SignalKConnectionService` / `ConnectionStateMachine` / `UnitsService` / the widget host directives.
- **A spec that needs a fake declares it locally.** Add a local provider in that spec's `configureTestingModule` (globals are prepended, so a local `{ provide: X, useValue: … }` wins). That is the whole mocking model — there is no shared app-service stub to extend. A local `SignalKConnectionService` fake must still expose `serverServiceEndpoint$` and `serverVersion$` (services subscribe to them at construction).
- **The failure mode is real-service construction, not stub drift.** Because components receive the real services, a service that throws at construction (missing dependency, a `requireSync`/NG0601 hazard) fails the spec directly — construction-time resilience of the real services is load-bearing for ~30 spec files. Fix the app code or add a local fake; do **not** re-add a global app-service stub (it is inert anyway).
- **Local runs work.** The whole suite runs locally via `npm test` (~90s, build-dominated), and a single spec via `ng test --include='<path/to/file.spec.ts>'`; plain `npx vitest run <file>` fails (`@angular/compiler is not available`) because it bypasses the builder. **CI on Node 24 is the authoritative gate** (`npm run ci` = `lint` + `betterer:ci` + `test:headless` + `test:plugin`).
- CI uses **`npm ci`** (the `run-tests` action and `release.yml`) against a lockfile that is in sync. If `npm ci` ever fails on missing optional platform deps, regenerate the lockfile (`rm package-lock.json && npm install`) and commit it — don't switch CI back to `npm install`.

## Architecture (the parts that need several files to grasp)

**Runtime data pipeline** (`src/app/core/services/`): `SignalKConnectionService` (endpoint discovery) → `ConnectionStateMachine` (explicit connection lifecycle; registers callbacks so it carries no upward deps) → `SignalKDeltaService` (parses SK delta messages) → `DataService` (central hub mapping deltas to per-path observables; every value is written to both a `default` bucket and a per-`$source` bucket) → widgets. The DI graph is intentionally acyclic: `connection ← auth ← storage ← settings`, `data ← delta ← connection`.

**Widgets** (`src/app/widgets/`, ~46) are standalone components composed with three **host directives** that own runtime concerns: `WidgetRuntimeDirective` (config merge), `WidgetStreamsDirective` (diff-based path subscriptions), `WidgetMetadataDirective` (zones/meta). `WidgetService` is the registry — `kipWidgets` is a getter over the `_widgetDefinition` array; the full electrical family (bms, solar-charger, charger, alternator, inverter, ac) is registered and live.

**Config & persistence**: `SettingsService` holds in-memory config plus sync getters and observable getters. `StorageService` persists through the SK server's **applicationData REST API**, which has exactly two scopes — `user` (the authenticated user's private store) and `global` (a single shared bucket). All writes go through a **sequential JSON-Patch queue** because SK can't handle concurrent applicationData writes. `ConfigurationUpgradeService` migrates older config file versions (preserve the stored version on write).

**Auth & profiles** (the fork's additions): `AuthenticationService` authenticates **only** through the same-origin Signal K server session (SSO behind the reverse proxy). The httpOnly session cookie is the sole credential — the HTTP interceptor sends it on same-origin requests, session state derives from `GET /skServer/loginStatus`, and `SsoRedirectService` owns the sign-in redirect. Skip never collects, stores, or transmits raw credentials or tokens. `ProfileService` adds **named configuration profiles decoupled from user accounts** (multiple dashboards/layouts under one identity), stored as user-scope applicationData slots. Write capability is gated on the session's `userLevel`, not on a read-only flag.

**History & charts**: the SK **v2 History API** is consumed by `HistoryApiClientService` / `KipSeriesApiClientService`; `HistoryToChartMapperService` adapts history values to chart datapoints; `DashboardHistorySeriesSyncService` reconciles series; `HistoryChartStreamService` feeds the trend-chart widgets (History-API backfill plus a thin delta-stream live tail). Skip ships no server-side history provider — the History API is served by an external provider (InfluxDB via `signalk-to-influxdb2`, or `signalk-parquet`), and charts render an empty state when none is present.

## Fork-specific gotchas

- **The package name is the serving path.** `angular.json` `baseHref`, the `dev` serve-path, `src/manifest.json` `id`/`scope`/`start_url`, and `SKIP_URL` in `plugin/index.js` must all stay `/@halos-org/skip/`. Branding lives in `brand/` (vector master, repo-only), `src/assets/` (favicon/icon set), `src/manifest.json`, and `signalk.displayName` in `package.json`.
- **`gh` defaults PRs to the `upstream` remote.** Always pass `--repo halos-org/skip` to `gh pr create` / `gh pr merge`. (The clone is set up with `gh repo set-default halos-org/skip` and a disabled upstream push URL, but pass it explicitly anyway.)
- **Upstream's own vitest CI is red**; a rebase onto `mxtommy/kip` can re-introduce test failures. The fork's fixes are small and live in `src/test.ts` (framework providers, env/DOM shims, the icon registration, and the `TestBed.configureTestingModule` patch) plus a few specs — re-apply them rather than disabling tests.
- Published to npm as `@halos-org/skip` — publishing a GitHub release triggers `release.yml` to `npm publish` (OIDC trusted publishing, no token). This also lists Skip in the Signal K app store, which is intended. The published package is the built `public/` output (the webapp) **and** `plugin/` (the bundled Freeboard-SK panel plugin, referenced by `main`) alongside `package.json`; a `public/`-only copy leaves `main` dangling and the plugin fails to load. For development, deploy an unreleased build with `./run deploy-halos <host>` (or `local` on the device itself): it installs the build as a declared `file:` dependency so a later `npm install` in the SK data dir won't prune it. Do **not** just copy `public/` + `plugin/` into the SK server's `node_modules` — an undeclared package there is *extraneous* and gets pruned the next time any plugin is installed (see workspace `CLAUDE.local.md`).

## Inherited upstream docs — treat skeptically

`COPILOT.md` and `.github/instructions/*.instructions.md` are upstream Kip's AI-guidance files, not ours. They are unverified and partly stale — e.g. they tell you to run `npm run test:all`, which is **not** a script in this repo. Use them at most as loose architecture hints, and verify any command or claim against `package.json` and the actual code before relying on it.
