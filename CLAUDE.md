# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Skip — an Angular 21 (zoneless, signals, new control flow) Signal K marine instrument panel, `@halos-org/skip`. It's a Signal K webapp the SK server serves at the path `/@halos-org/skip/` (its own npm package name). Skip **originated as a fork of `mxtommy/kip`** (never a GitHub fork object) but is now an **independent project** — KIP is not an upstream we track, sync with, or treat as authoritative. What set Skip apart from the start was its auth + profiles work (below), which KIP did not accept; it has diverged further since.

**KIP is not "upstream."** There is no goal of staying rebaseable on or in sync with `mxtommy/kip`, and no obligation to mirror its structure. If a specific KIP change is ever worth having, treat it as borrowing an idea from a separate project (reimplement it to fit Skip), not as merging from an upstream. Design decisions weigh only correctness and our own maintenance cost.

## Commands

- `npm run dev` — dev server (serve-path `/@halos-org/skip/`).
- `npm run build:prod` / `npm run build:dev` — Angular app build (output → `public/`).
- `npm test` — full unit suite, headless (vitest via `@angular/build:unit-test`). `npm run test:interactive` for watch mode.
- `npm run lint` — ESLint (flat config). `@typescript-eslint/no-explicit-any` is an **error**, and `no-unused-vars` does **not** ignore `_`-prefixed params — drop unused params, don't underscore them.
- `npm run generate:widget` — schematic that scaffolds a Host2 widget (preferred over hand-writing one).
- `./run` — standard HaLOS dispatcher (`./run help` for commands): `build`, `test`, `lint`, `ci` (lint + snc + tests, the CI gate), `bumpversion patch|minor|major`.

Node: the app builds on Node 20+, but only **Node 24 is CI-verified** (`run-tests` and the npm-publish job run Node 24 — the 20/22/24 matrix was dropped when the bespoke `ci.yml` was replaced).

CI is the standard HaLOS triad: `pr.yml` → shared `pr-checks` (with `skip-lintian`), `main.yml` → shared `build-release` in npm-only mode (`build-deb: false`; cuts a draft stable release), `release.yml` → `npm publish` when that release is published. `VERSION` is the source of truth, synced to `package.json` by `./run bumpversion`. In npm-only mode a `+N`-only merge (no `VERSION` change) cuts a GitHub release that publishes nothing to npm — bump `VERSION` to ship a new version.

## strictNullChecks (enabled)

`strictNullChecks` is **enabled** for the whole app in `tsconfig.json` (issue #6, closed). The TypeScript compiler and Angular's `strictTemplates` now enforce null-safety across sources, component templates, and specs — a null-safety regression fails the build directly.

- `npm run snc` — the deterministic type-check gate: `tsc -p tsconfig.strict.json` (production `src/**/*.ts`) **and** `tsc --noEmit -p src/tsconfig.spec.json` (specs). Specs are checked here explicitly because the vitest builder's own spec type-checking is cache-sensitive and not reliable in CI.
- The CI gate is `npm run ci` = `lint` → `snc` → `test:headless` → `test:mcp-schema`. `snc` enforces null-safety in production sources and specs; the app/test build (Angular `strictTemplates`) enforces it in component templates. All three surfaces are covered.

The former **betterer ratchet** that migrated the codebase to zero file-by-file was retired at the flip; `.betterer.*` and `tsconfig.betterer.json` are gone — do not reintroduce them. The remaining `strict`-family flags (`strictPropertyInitialization`, `strictFunctionTypes`, `noImplicitAny`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, …) are **not** yet enabled; their measured error count is tracked in the rest-of-strict follow-up issue.

## TypeScript only

Skip strives to be **100% TypeScript**. No new JavaScript source files are allowed, and any existing JavaScript source that a change touches must be converted to TypeScript as part of that same change — not left as JS with a follow-up promise. The one exception is tool/build config that is conventionally JavaScript (e.g. `eslint.config.js`); those may stay JS.

## Webapp-only (no bundled server plugin)

The Skip package must remain **webapp-only** — the `signalk-webapp` keyword only, no `signalk-node-server-plugin`, no `main`, no bundled server plugin. Bundling an in-process server plugin forces a Signal K server restart on every webapp update (the server loads plugin code into its process at boot). The Freeboard-SK integration lives in the separate `@halos-org/skip-freeboard-panel` package, pulled in as a runtime dependency. This is machine-enforced by the `run-tests` CI action, which fails if the publish tarball ships any `plugin/`.

## Performance and freeze measurement (perf-harness/)

Self-contained freeze/jank harness (own `package.json`, never touches app deps): builds the **real production bundle**, drives it in headless Chromium at **10× CPU throttle** (Pi-class HaLOS target) against a **mock Signal K server** on one origin. Use it for perf-sensitive changes to widgets, rendering, or the data pipeline, and for before/after numbers on freeze/jank fixes. Full operator docs: `perf-harness/README.md`.

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
- **Chart.js is a shim, aliased not mocked.** `vitest.config.ts` aliases `chart.js`, `chartjs-plugin-annotation`, `chartjs-adapter-date-fns` and `@aziham/chartjs-plugin-streaming` to `src/test-shims/chartjs-*`, the same way gridstack and canvas-gauges are aliased. **Do not add a per-file `vi.mock('chart.js')`** — that is what #544 was: a per-file mock only wins when its spec is the first in the worker to load the module, and `widget-numeric` reaches chart.js through `MinichartComponent` without mocking, so the real library was sometimes cached first. The real library cannot acquire a 2D context under jsdom, so `chart.ctx` comes out falsy and components silently drop everything they feed the chart — a live subscription plotting nothing, which reads as a flake rather than a wiring error. The shims are imported from `src/test.ts` so their chunks resolve during setup; a spec that first reaches one lazily can otherwise request it after its worker's environment is torn down (`EnvironmentTeardownError`, which fails the suite file while every test passes).
- **Local runs work.** The whole suite runs locally via `npm test` (~90s, build-dominated), and a single spec via `ng test --include='<path/to/file.spec.ts>'`; plain `npx vitest run <file>` fails (`@angular/compiler is not available`) because it bypasses the builder. **CI on Node 24 is the authoritative gate** (`npm run ci` = `lint` + `snc` + `test:headless` + `test:mcp-schema`).
- CI uses **`npm ci`** (the `run-tests` action and `release.yml`) against a lockfile that is in sync. If `npm ci` ever fails on missing optional platform deps, regenerate the lockfile (`rm package-lock.json && npm install`) and commit it — don't switch CI back to `npm install`.

## Architecture (the parts that need several files to grasp)

**Runtime data pipeline** (`src/app/core/services/`): `SignalKConnectionService` (endpoint discovery) → `ConnectionStateMachine` (explicit connection lifecycle; registers callbacks so it carries no upward deps) → `SignalKDeltaService` (parses SK delta messages) → `DataService` (central hub mapping deltas to per-path observables; every value is written to both a `default` bucket and a per-`$source` bucket) → widgets. The DI graph is intentionally acyclic: `connection ← auth ← storage ← settings`, `data ← delta ← connection`.

**Widgets** (`src/app/widgets/`, ~46) are standalone components composed with three **host directives** that own runtime concerns: `WidgetRuntimeDirective` (config merge), `WidgetStreamsDirective` (diff-based path subscriptions), `WidgetMetadataDirective` (zones/meta). `WidgetService` is the registry — `kipWidgets` is a getter over the `_widgetDefinition` array; the full electrical family (bms, solar-charger, charger, alternator, inverter, ac) is registered and live.

**Config & persistence**: `SettingsService` holds in-memory config plus sync getters and observable getters. `StorageService` persists through the SK server's **applicationData REST API**, which has exactly two scopes — `user` (the authenticated user's private store) and `global` (a single shared bucket). All writes go through a **sequential JSON-Patch queue** because SK can't handle concurrent applicationData writes. `ConfigurationUpgradeService` migrates older config file versions (preserve the stored version on write).

**Auth & profiles**: `AuthenticationService` authenticates **only** through the same-origin Signal K server session (SSO behind the reverse proxy). The httpOnly session cookie is the sole credential — the HTTP interceptor sends it on same-origin requests, session state derives from `GET /skServer/loginStatus`, and `SsoRedirectService` owns the sign-in redirect. Skip never collects, stores, or transmits raw credentials or tokens. `ProfileService` adds **named configuration profiles decoupled from user accounts** (multiple dashboards/layouts under one identity), stored as user-scope applicationData slots. Write capability is gated on the session's `userLevel`, not on a read-only flag.

**History & charts**: the SK **v2 History API** is consumed by `HistoryApiClientService`; `HistoryToChartMapperService` adapts history values to chart datapoints; `DashboardHistorySeriesSyncService` resolves per-widget history series for the history dialog; `HistoryChartStreamService` feeds the trend-chart widgets (History-API backfill plus a thin delta-stream live tail). Skip ships no server-side history provider — the History API is served by an external provider (InfluxDB via `signalk-to-influxdb2`, or `signalk-parquet`), and charts render an empty state when none is present.

## Gotchas

- **The package name is the serving path.** `angular.json` `baseHref`, the `dev` serve-path, and `src/manifest.json` `id`/`scope`/`start_url` must all stay `/@halos-org/skip/`. This path is also a **cross-package contract**: the companion `@halos-org/skip-freeboard-panel` plugin hardcodes it (`SKIP_URL`) plus Skip's widget-type ids and `#/widget/:type` embed routes in its Freeboard manifest, so renaming any of them needs a coordinated release of that package **and** bumping its dependency floor here (an installed panel on an old caret-satisfied version would 404). Branding lives in `brand/` (vector master, repo-only), `src/assets/` (favicon/icon set), `src/manifest.json`, and `signalk.displayName` in `package.json`.
- **Freeboard-SK plotter extension** (the plugin now lives in the separate `@halos-org/skip-freeboard-panel` package, **not** this repo): it declares one `plotterExtensions` resource — a toolbar **panel** (opens the whole app in a drawer) and, additively, **widgets** (Wind Steer as 1x1/2x2 chart tiles). The **webapp side stays here**: a widget iframe is Skip chromeless on the `#/widget/:type` route (`SingleWidgetHostComponent`), which mounts one `widget-host2` full-bleed against the live SK session; `:type` is the widget's component selector. The widget route is embed-only (`embedRequiredGuard`); the dashboard is force-locked, so Host2's edit chrome never activates. Data comes from Skip's own session; the plotter-extension bus (`signalk-plotterext-bus`, via `WidgetHostBridge`) carries only two things: a long-press relayed to `ui.openConfigPanel` (a placed widget has no other host-side control — this opens the host dialog's Remove button and settings panel), and the per-instance config in host `state`, applied live to the tile via `widget-host2.reconfigure`. The **settings panel** is another embed route (`#/widget-config/:type`, `WidgetConfigPanelComponent`) that reuses the real widget-options UI (`RootModalWidgetConfigComponent`) via a shim `MatDialogRef` — so it is generic across widget types. In the plugin's manifest, `widgets` is deliberately absent from `requires` (only `optional`, with `state`) so hosts without widget support still get the panel. To expose another control as a widget, add its selector to the plugin package's manifest `widgets[]` (with a `configPanel`) **and** ensure the matching embed route exists here.
- Published to npm as `@halos-org/skip` — publishing a GitHub release triggers `release.yml` to `npm publish` (OIDC trusted publishing, no token). This also lists Skip in the Signal K app store, which is intended. The published package is **webapp-only**: the built `public/` output alongside `package.json` (no `plugin/`, no `main`). It declares a runtime dependency on `@halos-org/skip-freeboard-panel`, so an app-store/registry install pulls the Freeboard plugin automatically — that coupling does **not** fire on the `file:`-symlink deploy path (`deploy-halos`, and the image if it uses that route), where the plugin is deployed separately. For development, deploy an unreleased build with `./run deploy-halos <host>` (or `local` on the device itself): it ships `public/` + `package.json` as a declared `file:` dependency (so a later `npm install` in the SK data dir won't prune it) and restarts Signal K only on a first install, not when the webapp is already mounted. The Freeboard plugin has its own `deploy-halos` in `@halos-org/skip-freeboard-panel`. Do **not** just copy `public/` into the SK server's `node_modules` — an undeclared package there is *extraneous* and gets pruned the next time any plugin is installed (see workspace `CLAUDE.local.md`).