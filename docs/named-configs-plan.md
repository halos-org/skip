---
title: "feat: Profile support (named configs) for KIP"
type: feat
status: active
date: 2026-06-23
deepened: 2026-06-23
---

# Profile support (named configs) for KIP

> Design + implementation plan. Lives on the `named_configs` branch. Conventions aim at
> upstreamability (`mxtommy/kip`); not a hard constraint.
>
> Revised twice (2026-06-23) after two multi-persona document-review passes. Pass 1 caught two
> correctness P0s (degraded-boot slot corruption; undefined import target) and a per-profile
> remote-control side effect. Pass 2 verified the fixes against source and corrected the
> remote-control migration (ordering + version baseline), the write-guard scope, the recovery
> path, rename sequencing, and import safety. All findings are folded in below.

## Overview

Let a user keep several independent **profiles** — each owning its own dashboards, layouts, and
theme — and switch between them at runtime, **without creating a separate Signal K user per
screen set** (today's workaround). A profile maps onto KIP's existing *named config slot* in the
Signal K `applicationData` store. The active profile is remembered **per device**, so a cabin,
mast, and cockpit display can each show a different profile from the same single Signal K login.

The storage substrate is mostly present: `getConfig` / `setConfig` / `listConfigs` / `removeItem`
are already parameterized by config name, and the active slot name (`sharedConfigName`) already
drives both config load and every incremental save. The core work is (1) making that slot name
runtime-mutable instead of boot-frozen, (2) a management UI, and (3) hardening the failure paths
the current single-slot code never had to handle (a missing/renamed slot; a write before the slot
name is known). No `IConfig` schema change is required.

## Glossary (device vs profile)

- **Device** — one browser/screen running KIP. Its `connectionConfig` lives in that browser's
  localStorage and is never shared: server URL, credentials, `useSharedConfig`, `sharedConfigName`
  (*which profile this screen shows*), `kipUUID` (per-device id that identifies this screen to
  remote controllers). Two tablets = two devices, even on one Signal K login.
- **Profile** — a named bundle of `{app, theme, dashboards}` stored server-side under the Signal K
  user, shared across that user's devices. A device points at one profile via its own
  `sharedConfigName`.

## Problem Frame

KIP stores one active configuration. When logged in (`useSharedConfig = true`) it persists to
`…/applicationData/user/kip/{fileVersion}/{configName}`. Per-user isolation is a property of
Signal K's `user` scope keyed by the bearer JWT — not of KIP. The config name is pinned to
`default`, so the only lever for "a different set of screens" is a different Signal K login. KIP's
README frames multi-config mostly around different *people*; this feature extends it to one person
(or boat) wanting different screen sets per display. The "separate logins" workaround is the
assumed motivation; it is a hypothesis, not a measured pain point (see Open Questions).

The named-slot dimension exists but is frozen: `sharedConfigName` is read once at boot and never
changed at runtime. The existing "Configurations" tab can list named slots, but its "Restore"
copies a chosen slot back into the fixed `user/default` and hard-reloads — a backup/restore flow,
not a profile selector.

## Requirements Trace

- **R1.** A user can see all their profiles and which one is active (logged in, remote storage).
- **R2.** A user can switch the active profile; remembered for *this device only*.
- **R3.** A user can create a profile, seeded from the current profile (clone) or blank.
- **R4.** A user can rename, duplicate, and delete profiles, with guard rails that prevent an
  unbootable or data-losing state.
- **R5.** Each profile owns its own dashboards, layouts, theme, **and unit defaults** (a profile is
  a whole `IConfig` slot; see Scope Boundaries for the no-enforced-shared-units tradeoff).
- **R6.** Existing single-config users migrate transparently: their `user/default` *is* profile #1;
  nothing in `IConfig` is rewritten.
- **R7.** A profile can be exported to / imported from a JSON file **without destroying another
  profile** (import creates a new profile).
- **R8.** A display's remote-control identity (`isRemoteControl`, `instanceName`) stays stable
  across profile switches — it is a property of the device, not the profile.

## Scope Boundaries (non-goals for v1)

- **No local-only (logged-out) profiles.** `useSharedConfig = false` stays single-profile.
  *Tradeoff (accepted, documented):* installs running without Signal K security are effectively
  logged-out and won't see profiles; this excludes a real slice of out-of-box installs. The
  device-token → `global` scope path is a possible later route, out of scope now.
- **No hot-swap.** Switching uses a full page reload (reuses the proven reload path).
- **No enforced shared units across profiles.** A profile is a whole `IConfig` slot, so
  `unitDefaults` is per-profile. Clone-on-create carries units forward, but a later edit to one
  profile's units does **not** propagate — displays can silently diverge. Mitigation: an edit-time
  notice (Unit 4) and help wording (Unit 7); enforced shared units is deferred.
- **No profile metadata registry** (icons, ordering, descriptions). Profiles are identified by slot
  name only. See Future Considerations for the trajectory risk.
- **No quick-switch in the main app chrome.** Management/switching live in Options only.
- **No `IConfig`/`IAppConfig.configVersion` bump for dashboards/theme.** Unit 5 *does* remove two
  fields from `IAppConfig` (`isRemoteControl`, `instanceName`) and bumps **`IConnectionConfig`'s**
  version (12 → 13). The `IAppConfig` removal is forward-compatible (old slots carry ignored
  fields); consumers update in lockstep (Unit 5).

## Context & Research

### Relevant code and patterns

- `src/app/core/interfaces/app-settings.interfaces.ts` — `IConfig {app, theme, dashboards}`;
  `IAppConfig` (currently holds `isRemoteControl`, `instanceName` — Unit 5 moves these, and has its
  own `configVersion`); `IConnectionConfig` (`useSharedConfig`, `sharedConfigName`, `kipUUID`, its
  own `configVersion`, currently 12).
- `src/app/core/services/storage.service.ts` — named-slot CRUD: `listConfigs` (`?keys=true`),
  `getConfig`, `setConfig` ("if name exists, replaced; else created"; returns awaitable
  `Promise<null>`), `removeItem` (delete; returns `void`), `patchConfig` (paths all
  `/{sharedConfigName}/…`). **`StorageService.sharedConfigName` is assigned only inside
  `bootstrapRemoteContext`** — the degraded-boot hazard. `removeItem`/`patchConfig` post to a
  fire-and-forget sequential `patchQueue$` with **no exposed completion**; `patchConfig` uses
  JSON-Patch `replace` (needs the slot to pre-exist). The storage URL is raw string concat with
  **no `encodeURIComponent`**.
- `src/app/core/services/settings.service.ts` — owns the private `sharedConfigName` (loaded from
  `connectionConfig`, **defaults to `'default'`, never `undefined`**); persists via
  `buildConnectionStorageObject`; `latestConfigVersion = 12`; `loadConnectionConfig` accepts only
  versions {11,12} then `resetConnection()` (which wipes per-device state). `reloadApp()` is
  `location.replace("./")`, a **no-op under `__KIP_TEST__`**. `startup()` early-returns before
  `pushSettings()` when not bootstrapped (in-memory getters empty on the degraded path).
  `resetSettings()` writes a blank default into the *current* `sharedConfigName` (gated on
  `storageServiceReady$`); `loadDemoConfig()` calls `setConfig` **without** a readiness gate.
  `pushSettings`/`buildAppStorageObject` read `app.isRemoteControl`/`app.instanceName`.
- `src/app/core/services/app-initNetwork.service.ts` — `loadLocalStorageConfig()` runs first
  (upgrades connectionConfig 9→10→11→12 **in place, before** the profile is fetched); `getConfig`
  + `bootstrapRemoteContext` come later, both inside the `try`; a 404 is caught and
  `bootstrapRemoteContext` is skipped → storage slot name stays unset. Emits
  `bootstrapIssue 'missing-shared-config'`; distinguishes status 0 / 401 / 404.
- `src/app/app.component.ts` — `missing-shared-config` degraded UX; its recovery action calls
  `settings.resetSettings()` (recreates the *current* name blank, not a fallback to `default`).
- `src/app/core/components/options/configuration/config.component.ts` + `.html` — the
  "Configurations" tab. Hides `user/default` and **blocks overwriting it** (in `saveConfig`, not
  just the list filter); chooses scope by token type (device → `global`, user → `user`); the
  `if (this.storageSvc.setConfig(...))` check is a bug (treats a `Promise` as a sync boolean →
  always reports success). Import does `JSON.parse` → write to `user/default` with no validation.
  `config.component.spec.ts` exists.
- `src/app/core/components/dashboards-editor/dashboards-editor.component.ts` (+ bottom sheet) — CRUD
  UI pattern to mirror. `src/app/core/services/dialog.service.ts` — `openNameDialog` (name only) +
  `openConfirmationDialog`.
- `src/app/core/services/remote-dashboards.service.ts` — drives remote participation off
  `isRemoteControl` + display name; `displayId` is `kipUUID` (per-device), so two displays never
  collide — but `isRemoteControl`/`instanceName` are per-profile today (the R8 / Unit 5 driver).
  The setter UI for these lives in `display.component`.

### Conventions to honor (`.github/instructions/`)

New app-internal types → `src/app/core/interfaces`. Service-centric; signal-based state. Tests:
**Vitest** (`@angular/build:unit-test` + `vitest.config.ts`, jsdom, `TestBed` + `describe/it/expect`,
co-located `*.spec.ts`). Theme via KIP theme roles / CSS variables.

## Key Technical Decisions

- **Profile == named `user`-scope config slot, holding a full `IConfig`.** Per-profile theme falls
  out for free.
- **All `ProfileService` storage ops hardcode `scope: 'user'`** — do not inherit the component's
  token-type scope selection. Device-token sessions cannot use the user scope, so profiles are
  unavailable for them (consistent with the "requires login" gating); never silently `global`.
- **Active profile is per-device** via the always-local `connectionConfig.sharedConfigName`, made
  runtime-mutable. *Tradeoff (accepted):* a per-device choice doesn't follow the user to a new
  browser/device and is reset by a localStorage clear. Documented in help.
- **Switch = drain pending writes (bounded), persist the new name, then `reloadApp()`.** After
  reload the bootstrap loads the chosen slot and re-syncs the slot name — reliable **only on the
  authenticated, storage-ready path**. The degraded path is covered by the write-safety guard
  (Unit 2) and recovery (Unit 6), not by assuming re-sync.
- **Create = `setConfig('user', name, seed)` first (awaited; creates the slot), then optionally
  switch.** Order matters: `patchConfig` `replace` and the bootstrap both assume the slot exists.
  `seed` = a guarded clone (only when settings are loaded) or a blank default.
- **Write-safety is a `StorageService`-boundary invariant (Unit 2).** Every mutating call validates
  its effective slot name and refuses to write to an empty/undefined target.
- **Profile-name validation is a security invariant (Unit 3).** Names are URL path segments *and*
  JSON-Patch keys (`/{name}/…`) *and* must avoid the `::` list-key separator. Allow-list charset
  (e.g. `[A-Za-z0-9 _-]`), bound length, reject empty / `default` / `/` / `..` / `~` / `::`. Apply
  `encodeURIComponent` **inside `StorageService`** so all callers (not just `ProfileService`) are
  covered. Imported-profile names run through the identical validation. Server acceptance probed in
  Unit 1.
- **`default` is the reserved fallback profile name.** `useSharedConfig` defaults to `false`, so a
  fresh device boots into local mode and the `user/default` *slot* is not created until the first
  shared write — not guaranteed to exist or appear in `listConfigs` for a brand-new shared user.
  v1 treats `default` as reserved: cannot create another named `default`, cannot delete/rename it,
  and recovery/fallback must **create** it (blank `IConfig`) when genuinely absent.
- **Remote-control identity is per-device (R8).** `isRemoteControl` + `instanceName` move from
  `IAppConfig` to `IConnectionConfig`, beside `kipUUID`, so switching profiles never changes a
  screen's remote role or advertised name (Unit 5).
- **Logic lives in a new `ProfileService`** (mirrors `DashboardService`), orchestrating
  `StorageService` + `SettingsService`. Could fold into `SettingsService`; kept separate for
  cohesion.
- **User-facing term: "Profiles."** Internally/storage they remain named configs.

## Open Questions

### Resolved during planning / review

- Profile = `user`-scope named `IConfig` slot; active per-device; switch = persist + reload; no
  `IConfig` migration; local mode out of scope; logic in `ProfileService`; `default` reserved.
- Multi-display per-login does **not** collide on remote-control id (`displayId` = per-device
  `kipUUID`); but `isRemoteControl`/`instanceName` were per-profile → R8 hoist (Unit 5).
- Name validation pinned as a Unit 3 invariant.
- Import creates a new profile (R7); never silently overwrites.

### Deferred to implementation

- The queue-drain (Unit 2) and the awaitable delete (Unit 3) share one missing capability —
  `patchQueue$` exposes no completion. Build **one `StorageService` completion primitive** with a
  **bounded timeout**; both consume it. Plus the double-switch re-entrancy guard.
- Exact `ProfileService`/`SettingsService` method names and signatures.
- Exact recovery affordance wording reused/extended from `app.component`.

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

**Model mapping**

```
Signal K applicationData (per Signal K user, JWT-gated)
  user/kip/{fileVersion}/
    ├── default     ← reserved fallback profile (created on first shared write)  ┐
    ├── cabin       ← profile                                                    ├ each = full IConfig
    └── cockpit     ← profile                                                    ┘   {app, theme, dashboards}

Per device (localStorage connectionConfig):
  sharedConfigName  → which profile this screen shows
  kipUUID           → this screen's remote-control identity
  isRemoteControl   → this screen participates in remote control   (moved here in Unit 5)
  instanceName      → this screen's advertised name                (moved here in Unit 5)
```

**Switch flow (reload-based, write-safe)**

```mermaid
sequenceDiagram
  participant UI as Profiles UI
  participant PS as ProfileService
  participant SET as SettingsService
  participant ST as StorageService
  participant LS as localStorage(connectionConfig)
  participant BOOT as app-initNetwork (next load)

  UI->>PS: switchProfile("cockpit")
  PS->>ST: await completion-primitive (bounded timeout) for pending writes
  PS->>SET: setActiveProfile("cockpit")
  SET->>LS: persist sharedConfigName="cockpit"
  SET->>SET: reloadApp()  (location.replace; no-op under __KIP_TEST__)
  Note over BOOT,ST: on reload
  BOOT->>ST: getConfig('user',"cockpit")
  alt slot exists
    BOOT->>ST: bootstrapRemoteContext(sharedConfigName="cockpit")
    Note over ST: patchConfig writes target /cockpit/... ; write-safe
  else 404 (deleted elsewhere)
    Note over BOOT: missing-shared-config → recovery (Unit 6), NOT a /undefined write
  end
```

## Implementation Units

- [ ] **Unit 1: Pre-flight — verify named-slot behavior on a live Signal K server**

**Goal:** Confirm the external assumptions before building. Lightweight probe, not a build unit, but
a hard gate.

**Requirements:** R1–R4 (foundational). **Dependencies:** None. **Files:** none persistent.

**Approach:** Against a real server (Signal K demo or `halosdev.local`): create/list/get/delete
arbitrary user-scope names; confirm `listConfigs` returns them; **confirm read-after-write
consistency** (create then immediately get); probe name charset (`/`, `..`, `~`, spaces, unicode,
long); confirm `patchConfig`-style `replace` fails on a missing slot; confirm whether the server
auto-creates on first `patch` to a missing name or needs explicit `setConfig`; **probe whether the
server ever returns a transient 404 for an existing name** (feeds Unit 6).

**Test expectation:** none (probe). Output: go/no-go + charset rule (Unit 3) + auto-create + transient-404 answers (Unit 6).

**Verification:** Documented confirmation of arbitrary-name round-trip with read-after-write
consistency, plus charset / auto-create / transient-404 answers.

---

- [ ] **Unit 2: `SettingsService` + `StorageService` — runtime-mutable active profile, write-safety**

**Goal:** Make the slot name runtime-settable, expose a guarded config snapshot, and ensure no write
can target an unset slot.

**Requirements:** R2, R3, R6. **Dependencies:** Unit 1.

**Files:**
- Modify: `src/app/core/services/settings.service.ts`, `src/app/core/services/storage.service.ts`
- Test: `src/app/core/services/settings.service.spec.ts`, `src/app/core/services/storage.service.spec.ts`

**Approach:**
- Active-profile read accessor (current `sharedConfigName`) and a setter that sets the private
  name, persists `connectionConfig` to localStorage, and triggers `reloadApp()`.
- **Write-safety guard (P0) at the `StorageService` boundary, not one method:** every mutating call
  validates its effective slot name (the explicit arg for `setConfig`/`removeItem`/`patchGlobal`;
  `this.sharedConfigName` for `patchConfig`) and refuses/throws on empty/undefined rather than
  POSTing to `/undefined/…`. (The genuine `/undefined` risk is `patchConfig`, which reads the
  bootstrap-set `StorageService.sharedConfigName`; the `setConfig` callers pass explicit names — but
  the guard is uniform.) Also **gate `loadDemoConfig` on `storageServiceReady$`** (today it isn't);
  gate ProfileService/UI mutations on `isRemoteContextBootstrapped()` / `storageServiceReady$`, not
  merely `hasToken`.
- **Completion primitive:** add a `StorageService` way to await `patchQueue$` settling (none exists
  today) with a **bounded timeout**, so a switch awaits pending writes to the leaving profile but a
  stuck write degrades to best-effort rather than hanging the UI. Same primitive backs the awaitable
  delete (Unit 3).
- **Config snapshot** for clone, assembled from `getAppConfig`/`getDashboardConfig`/`getThemeConfig`.
  **Guard:** these are populated only by `pushSettings()`, skipped on the degraded path — only offer
  "clone current" when settings are actually loaded; else disable clone / fall back to blank.

**Patterns to follow:** existing setter→persist pattern; `reloadApp()`'s `__KIP_TEST__` guard.

**Test scenarios:**
- Happy: setting the active profile persists the new name to `connectionConfig` and invokes reload
  (no-op under test; assert the persisted value); getter returns the boot name; snapshot matches
  current settings when loaded.
- Edge: snapshot/clone while not bootstrapped → clone unavailable / blank fallback.
- Error (P0): each mutating call (`patchConfig`, `setConfig`, `removeItem`) with an unset slot name
  does NOT issue a request to `/undefined/…`.
- Edge: switch with a pending queued write awaits the completion primitive (bounded) — write not
  silently dropped; a stuck write times out to best-effort.

**Verification:** Active profile runtime-settable and durable; no write path targets an unset slot;
clone never seeds from an empty snapshot; switch drains within a bounded time.

---

- [ ] **Unit 3: `ProfileService` — profile CRUD + switch orchestration**

**Goal:** One service owning list / switch / create / rename / duplicate / delete with guard rails,
name validation, and clone seeding.

**Requirements:** R1, R2, R3, R4, R5, R6. **Dependencies:** Unit 2.

**Files:**
- Create: `src/app/core/services/profile.service.ts`, `src/app/core/services/profile.service.spec.ts`
- Modify (only if a summary type helps): `src/app/core/interfaces/app-settings.interfaces.ts`.

**Approach:**
- **List:** `listConfigs()` filtered to `user`; **include `default`** (creatable entry if absent);
  mark the active one; expose as a signal.
- **Switch:** delegate to `SettingsService.setActiveProfile` (drain → persist → reload).
- **Create:** validate name (charset invariant; reject empty / `default` / existing / invalid);
  seed = guarded clone or blank; `await setConfig('user', name, seed)`; refresh. Offer switch only
  after `setConfig` resolves.
- **Duplicate:** `getConfig` source → `setConfig` new name.
- **Rename:** create new slot (awaited). For the **active** profile, strictly sequence
  **delete old (awaited via the completion primitive, bounded timeout) → persist new name →
  `reloadApp()`** — never fire the delete concurrently with `location.replace`. On delete
  timeout/failure, proceed with the switch and record the orphan for cleanup (a hung switch is worse
  than a leaked slot). Non-active rename: create new → delete old (awaited), no reload.
- **Delete:** guard — refuse active, `default`, or the last remaining profile; else `removeItem`.
- **Do not replicate** `config.component`'s `if (this.storageSvc.setConfig(...))` pattern
  (`setConfig` returns an always-truthy `Promise`, so its success branch always fires). `await` in
  `try/catch`; gate success toast / refresh / switch on resolution; surface `HttpErrorResponse`;
  never change the active name on a failed mutation.
- **Hardcode `scope: 'user'`** for all operations.

**Patterns to follow:** `DashboardService` CRUD; `dialog.service` naming/confirmation.

**Test scenarios:**
- Happy: list includes `default`, active flagged; create (blank/clone), duplicate, switch delegate
  correctly.
- Edge/Error: create with empty / `default` / existing / invalid-charset → rejected, no `setConfig`,
  error surfaced.
- Edge/Error: delete active / `default` / last → blocked; no `removeItem`.
- Error: `setConfig`/`getConfig` rejects → error surfaced, no success toast, no switch, active name
  unchanged.
- Integration: create-then-switch proceeds only after `setConfig` resolves; rename-of-active awaits
  the delete before reload (no orphan when it flushes); rename-non-active does not reload.

**Verification:** Full CRUD with guards; no operation leaves a missing slot or accumulates orphans;
failed writes never report success.

---

- [ ] **Unit 4: Profiles UI in the Configurations tab**

**Goal:** Replace the backup/restore framing with a Profiles experience. (Import/export, R7, is an
independently-trackable sub-task within this unit.)

**Requirements:** R1, R2, R3, R4, R5, R7. **Dependencies:** Unit 3.

**Files:**
- Modify: `src/app/core/components/options/configuration/config.component.ts` / `.html` / `.scss`
- Test: `src/app/core/components/options/configuration/config.component.spec.ts` (extend the existing
  spec)

**Approach:**
- Render the profile list (from `ProfileService`); mirror the `dashboards-editor` interaction.
- **Remove the `user/default` special-casing** (hide filter + the save block in
  `config.component.saveConfig`, not just the list filter) so `default` appears as a normal
  (protected) profile. Keep `default` non-deletable via guards, and **enforce a controlled-write
  invariant at a single chokepoint**: `ProfileService.create`/import are the only callers permitted
  to issue a full-`IConfig` write to a slot, each gated by a target-named confirm — this replaces
  the protection the removed save block gave.
- **Specify these interactions (don't leave to the implementer):**
  - *Switch:* confirmation dialog naming the target + a blocking progress affordance during the
    ~1–2s reload.
  - *Create:* surface clone-vs-blank explicitly (extend the name dialog with a selector, or two
    entry points "New from current" / "New blank"); state the default and what clone carries over
    (dashboards + theme + units).
  - *Active marker + per-device cue:* mark the active profile (leading check; switch suppressed on
    the active row) and label it "Active on this device."
  - *State content:* copy for logged-out ("Profiles require Signal K login"), blocked-delete
    (default / active / last — disabled with reason), name-collision and invalid-charset (inline
    dialog validation, not a post-submit toast), and the missing-slot recovery offer (Unit 6).
- **Import (R7): create a new profile, do not auto-switch into it.** Prompt for a name (run it
  through the Unit 3 validation), validate the uploaded JSON against the `IConfig` shape, and
  normalize/reject its `configVersion` (route through `ConfigurationUpgradeService` or reject
  unsupported); then `setConfig` under the new name and **let the user switch deliberately** — so a
  shape-valid-but-unbootable import can't become the persisted active slot and boot-loop. Shape
  validation is structural only, not content sanitization; confirm no imported string reaches a
  non-default-escaped DOM sink. Any "import into active" path needs a target-named confirm (replace
  the generic "overwrite active configuration" warning, also on the Demo/Default buttons).
- **Export:** serializes `IConfig` only; note it intentionally excludes `IConnectionConfig`
  (credentials, server URL, and — after Unit 5 — `isRemoteControl`/`instanceName`).
- **Returning-user migration:** pre-existing user-scope backups appear as profiles; one-time
  onboarding note + keep an export affordance so the backup workflow isn't lost.
- Theme via CSS variables.

**Patterns to follow:** `dashboards-editor.component.ts` (+ bottom sheet); `dialog.service`.

**Test scenarios:**
- Happy: list renders with active marked; switching a non-active profile calls `switchProfile`;
  "New profile" opens the create flow with the chosen seed; rename/duplicate/delete call the service
  with confirmation.
- Edge: delete affordance absent/disabled for `default`, active, and last; logged-out shows the
  notice.
- Error: import of malformed JSON (bad shape or unsupported `configVersion`) is rejected with a
  toast; a failing service call surfaces a toast and leaves the list intact.
- Integration: import creates a *new* profile and does NOT auto-switch into it.

**Verification:** Full lifecycle from Options; active obvious; no destructive action lacks a
target-named confirm; import never clobbers another profile or boot-loops the device.

---

- [ ] **Unit 5: Hoist remote-control identity to per-device (R8)**

**Goal:** Move `isRemoteControl` + `instanceName` from `IAppConfig` (profile) to `IConnectionConfig`
(device) so a profile switch never changes a screen's remote role or advertised name.

**Requirements:** R8. **Dependencies:** Unit 2 (same config plumbing); independent of Units 3/4.

**Files:**
- Modify: `src/app/core/interfaces/app-settings.interfaces.ts` (add both to `IConnectionConfig`,
  remove from `IAppConfig`)
- Modify: `src/app/core/services/settings.service.ts` (read/persist from connectionConfig; setters
  route there not `patchConfig`; bump `latestConfigVersion`; add the `loadConnectionConfig` `case 13`
  and the `!== latestConfigVersion` gate; remove the fields from `pushSettings`/`buildAppStorageObject`)
- Modify: `src/app/core/services/app-initNetwork.service.ts` (connectionConfig `12 → 13` step;
  deferred one-time field-lift after `getConfig`)
- Modify: `src/default-config/config.blank.const.ts` (`DefaultConnectionConfig.configVersion` and
  default field values)
- Modify consumers: `src/app/core/services/remote-dashboards.service.ts`, the `display.component`
  setter UI, and any reader of `getIsRemoteControl*/getInstanceName*` (verify via grep)
- Test: `settings.service.spec.ts`, `app-initNetwork.service.spec.ts`, `remote-dashboards.service.spec.ts`

**Approach:**
- **Version bump:** `IConnectionConfig.configVersion` **12 → 13**, updating *every* gate — the
  `loadConnectionConfig` switch (`case 13`), the `!== latestConfigVersion` check, the
  `latestConfigVersion` constant, and a new `12 → 13` step in `app-initNetwork.loadLocalStorageConfig`.
  Missing a gate trips `resetConnection()` and wipes per-device state (incl. the active profile name).
- **Migration ordering (critical):** `loadLocalStorageConfig` runs *before* the profile is fetched,
  so it cannot read the old `IAppConfig` values there. Do the version bump in `loadLocalStorageConfig`
  but **defer the field-lift until after `getConfig` resolves** (in the bootstrap handoff /
  `settings.startup`, where `initConfig.app` exists), guarded to run once. On the degraded/404 boot,
  **do not finalize** the lift (so it completes on a later successful boot) rather than defaulting to
  `false`/`''` and losing the user's setting.
- Remove the two fields from `IAppConfig`; update consumers in lockstep (`pushSettings`,
  `buildAppStorageObject`, the `patchConfig 'IAppConfig'` path, the `display.component` setters). The
  setters now route to `connectionConfig`. The `IAppConfig` removal is forward-compatible — old slots
  carry the now-ignored fields.
- Repoint `RemoteDashboardsService` to the connectionConfig-backed values.

**Patterns to follow:** the existing connectionConfig version-upgrade steps; per-device handling of
`kipUUID`.

**Test scenarios:**
- Happy: setting `isRemoteControl`/`instanceName` persists to connectionConfig (per-device), not the
  profile slot; a profile switch leaves them unchanged.
- Integration: `RemoteDashboardsService` participation reflects the device value before and after a
  switch (no toggle).
- Migration: the lift runs **after** the profile loads, exactly once, **preserving** the user's
  existing values; a degraded/404 boot does **not** finalize the lift (no setting loss) and it
  completes on a later good boot.
- Version gate: a `v13` connectionConfig is accepted (not reset); the `12 → 13` step runs once.

**Verification:** Switching profiles never changes remote participation or advertised name; existing
settings survive the upgrade; two screens on one profile can hold distinct names.

---

- [ ] **Unit 6: Bootstrap & degraded-path recovery**

**Goal:** Per-device active profile loads at boot; a missing/deleted active slot recovers gracefully
without data-loss surprises or `/undefined` writes.

**Requirements:** R2, R4, R6. **Dependencies:** Unit 2 (boundary guard), Unit 3 (list/create).

**Files:**
- Modify: `src/app/core/services/app-initNetwork.service.ts`, `src/app/app.component.ts`
- Test: `app-initNetwork.service.spec.ts`, `app.component.spec.ts`

**Approach:**
- Confirm boot honors a non-`default` `sharedConfigName` (it does) — assert via test.
- **Actively replace** `app.component`'s recovery action (today `settings.resetSettings()`, which
  rewrites the *current* — now dead — name as blank). The Unit 2 boundary guard does **not** cover
  this: the name is defined-but-deleted, not unset, so the protection here is behavioral.
- New recovery offers: (a) switch to the protected `default` profile; (b) pick from `listConfigs` of
  survivors. Make the action and resulting active name explicit.
- **Before creating `default`, re-verify absence** (re-fetch / `listConfigs`) to distinguish real
  deletion from a transient 404 (server restart, scope not yet provisioned); use create-if-absent so
  a blank create never clobbers a real `default` that reappears.
- In any degraded state, the Unit 2 boundary guard prevents `/undefined` writes.

**Test scenarios:**
- Happy: boot with `sharedConfigName="cockpit"` loads that slot and bootstraps storage with it.
- Edge/Error: boot when the remembered slot 404s → `missing-shared-config`; recovery offers
  fall-back-to-default (creating it if absent) or pick-from-list; the resulting active name is
  asserted; no write targets `/undefined`.
- Edge: a transient 404 (slot re-appears on re-check) does NOT overwrite the real slot with a blank
  one (create-if-absent re-verifies before writing).

**Verification:** A device whose profile was deleted elsewhere recovers to a usable, explicitly
chosen state; no silent data loss; no corrupt slot.

---

- [ ] **Unit 7: Documentation & changelog**

**Goal:** Explain profiles and record the change.

**Requirements:** R1–R8. **Dependencies:** Units 2–6.

**Files:** the Login & Configuration help doc under `src/assets/help-docs/` (`/help/configuration`);
`CHANGELOG.md`.

**Approach:** Document: what a profile is; per-device active selection (and that it doesn't follow
the user across browsers / survives a localStorage clear); clone-on-create; per-profile theme; the
per-profile **units** caveat (divergence after edit); the `default` fallback; remote-control identity
now per-device (R8); the remote-only v1 limitation; and that prior backups now appear as profiles.

**Test expectation:** none — docs only.

**Verification:** Help matches shipped behavior; CHANGELOG entry present.

## System-Wide Impact

- **Interaction graph:** a switch is a full reload → re-runs `app-initNetwork` → storage bootstrap →
  `settings.startup` → `pushSettings` → dashboards signal → widgets; `RemoteDashboardsService`
  re-broadcasts. After Unit 5, remote participation is device-bound and unaffected by the switch.
- **Error propagation:** storage ops throw `HttpErrorResponse`; `ProfileService` surfaces via toast
  and leaves active state unchanged on failure (await + try/catch).
- **State lifecycle risks:** `patchQueue$` is fire-and-forget; switch and rename-of-active use the
  bounded completion primitive; `StorageService` boundary refuses unset slot names.
- **API surface parity:** two `sharedConfigName` fields (`SettingsService` private +
  `StorageService` public). The reload re-syncs both **only on the authenticated, storage-ready
  path**; the degraded path is covered by the boundary guard (Unit 2) and recovery (Unit 6).
  `SettingsService`'s private copy defaults to `'default'` and is never `undefined`; only
  `StorageService.sharedConfigName` is unset pre-bootstrap — that is the `/undefined` risk the guard
  targets. The active-profile setter must keep both coherent across a switch.
- **Integration coverage:** the reload is a no-op under `__KIP_TEST__`; assert pre-reload side effects
  in unit tests, and cover the post-reload load path with a focused integration test that drives
  `AppNetworkInitService.initNetworkServices` with a non-`default` `sharedConfigName` and asserts
  `bootstrapRemoteContext` is called with that name.
- **Unchanged invariants:** `IConfig` schema; `configFileVersion` (11); `IAppConfig.configVersion`
  (intentionally NOT bumped — removing `isRemoteControl`/`instanceName` is forward-compatible);
  `ConfigurationUpgradeService`; local-mode single-config behavior; the Signal K `applicationData`
  endpoint contract; widget/dataset/history pipelines. *(`IConnectionConfig.configVersion` **is**
  bumped 12 → 13 in Unit 5; two fields move out of `IAppConfig` into `IConnectionConfig`.)*

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Degraded boot leaves the storage slot name unset → writes corrupt a `/undefined` slot | Unit 2 `StorageService`-boundary guard; mutations gated on `isRemoteContextBootstrapped()`. |
| Import silently overwrites the wrong profile, or imports an unbootable config | R7/Unit 4: import creates a new profile, shape- + `configVersion`-validated, no auto-switch. |
| Missing-slot recovery recreates the dead name blank (silent data loss) | Unit 6: actively replace `resetSettings()` recovery; fall back to / pick a real profile. |
| Recovery blank-clobbers a real `default` on a transient 404 | Unit 6 re-verifies absence (re-fetch/`listConfigs`) and uses create-if-absent. |
| Unit 5 migration runs before the profile loads → loses remote-control setting | Unit 5: defer the field-lift until after `getConfig`; don't finalize on a degraded boot. |
| connectionConfig bump misses a gate → `resetConnection()` wipes device state | Unit 5: bump 12 → 13 and update all four gates; test a `v13` config is accepted. |
| Queue-drain / awaitable-delete hang the switch | One `StorageService` completion primitive with a bounded timeout; degrade to best-effort. |
| Switching toggles remote-control role/name | Unit 5: hoist `isRemoteControl`/`instanceName` to per-device. |
| Profile name path/JSON-Patch injection | Unit 3 validation invariant + `encodeURIComponent` inside `StorageService`; Unit 1 probes the server. |
| `setConfig` truthy-Promise success-on-failure | Unit 3: await in try/catch; don't port the existing pattern. |
| Server rejects arbitrary names / lacks read-after-write consistency | Unit 1 pre-flight gates the work. |
| `default` slot assumed to exist but doesn't (fresh shared user) | Treat `default` as creatable-if-absent; never assume `listConfigs` includes it. |
| Per-profile units diverge after edit | Edit-time notice + help wording (Units 4/7); enforced shared units deferred. |
| Returning users' backups surface as profiles | Onboarding note + retained export affordance (Units 4/7). |
| Clone seeds from a hollow snapshot in degraded state | Unit 2: clone only when settings loaded; else blank. |

## Future Considerations

- **Slot-name-as-identity is a path dependency.** The display name doubles as the storage key, so the
  deferred metadata registry (icons, ordering, friendly names decoupled from keys) would be a
  *breaking* change to the identity model, not additive — and renaming already needs
  create-new + delete-old. If a registry looks likely, consider a thin stable id (generated key +
  separate display name) sooner.
- **Local-mode and device-token (`global` scope) profiles** are the natural next scope expansions.

## Sources & References

- Grounding exploration + two multi-persona document-review passes (2026-06-23), verified against
  `storage.service.ts`, `settings.service.ts`, `app-initNetwork.service.ts`, `app.component.ts`,
  `config.component.*`, `remote-dashboards.service.ts`, `dashboards-editor.component.ts`,
  `dialog.service.ts`, `app-settings.interfaces.ts`, `config.blank.const.ts`.
- Conventions: `.github/instructions/project.instructions.md`,
  `.github/instructions/best-practices.instructions.md`, `COPILOT.md`.
- Upstream: `mxtommy/kip` (this is the `mairas/Kip` fork, `named_configs` branch).
