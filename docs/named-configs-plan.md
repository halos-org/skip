---
title: "feat: Profile support (named configs) for KIP"
type: feat
status: active
date: 2026-06-23
deepened: 2026-06-23
---

# Profile support (named configs) for KIP

> Design + implementation plan. Lives on the `named_configs` branch. Conventions aim at
> upstreamability (`mxtommy/kip`); they are not a hard constraint and may change if they
> prove counter‑productive.
>
> Revised 2026-06-23 after a multi‑persona document review (coherence, feasibility, product,
> design, security, scope, adversarial). The review verified claims against the actual source and
> caught two correctness P0s (degraded‑boot slot corruption; undefined import target), a per‑profile
> remote‑control side effect, and several UX/security gaps now folded in below.

## Overview

Let a user keep several independent **profiles** — each owning its own dashboards, layouts,
and theme — and switch between them at runtime, **without creating a separate Signal K user
per screen set** (today's workaround). A profile maps onto KIP's existing *named config slot*
in the Signal K `applicationData` store. The active profile is remembered **per device**, so a
cabin display, a mast display, and a cockpit display can each show a different profile from the
same single Signal K login.

The storage substrate is mostly present: `getConfig` / `setConfig` / `listConfigs` / `removeItem`
are already parameterized by config name, and the active slot name (`sharedConfigName`) already
drives both config load (`app-initNetwork.service.ts`) and every incremental save
(`storage.service.ts` `patchConfig`). The core work is (1) making that slot name runtime‑mutable
instead of boot‑frozen, (2) a management UI, (3) hardening the failure paths the current
single‑slot code never had to handle (a missing/renamed slot, a write before the slot name is
known). No `IConfig` schema change and no migration of dashboards are required.

## Glossary (device vs profile)

- **Device** — one browser/screen running KIP. Its `connectionConfig` lives in that browser's
  localStorage and is never shared: server URL, credentials, `useSharedConfig`, `sharedConfigName`
  (*which profile this screen shows*), `kipUUID` (a per‑device id that identifies this screen to
  remote controllers). Two tablets = two devices, even on one Signal K login.
- **Profile** — a named bundle of `{app, theme, dashboards}` stored server‑side under the Signal K
  user, shared across that user's devices. A device points at one profile via its own
  `sharedConfigName`.

## Problem Frame

KIP stores one active configuration. When logged in (`useSharedConfig = true`) it persists to
`…/applicationData/user/kip/{fileVersion}/{configName}`. Per‑user isolation is a property of
Signal K's `user` scope keyed by the bearer JWT — not of KIP. The config name is effectively
pinned to `default`. So the only lever for "a different set of screens" is a different Signal K
login. KIP's README frames the multi‑config story mostly around different *people* (captain,
navigator); this feature extends it to one person (or one boat) wanting different screen sets per
display. The "separate logins" workaround is the assumed motivation; it is a hypothesis, not a
measured pain point (see Open Questions).

Today the named‑slot dimension exists but is frozen: `sharedConfigName` is read once at boot
(`settings.service.ts` `loadConnectionConfig`, `app-initNetwork.service.ts`) and never changed
at runtime. The existing "Configurations" tab can already list named slots, but its "Restore"
action copies a chosen slot back into the fixed `user/default` slot and hard‑reloads — a
backup/restore flow, not a profile selector.

## Requirements Trace

- **R1.** A user can see all their profiles and which one is active (logged in, remote storage).
- **R2.** A user can switch the active profile; the switch is remembered for *this device only*.
- **R3.** A user can create a profile, seeded either from the current profile (clone) or blank.
- **R4.** A user can rename, duplicate, and delete profiles, with guard rails that prevent
  leaving the device in an unbootable or data‑losing state.
- **R5.** Each profile owns its own dashboards, layouts, **and theme** (per‑display theming:
  cabin vs. mast vs. cockpit).
- **R6.** Existing single‑config users migrate transparently: their current `user/default`
  *is* profile #1; nothing in `IConfig` is rewritten.
- **R7.** A profile can be exported to / imported from a JSON file **without destroying another
  profile** (import creates a new profile by default).
- **R8.** A display's remote‑control identity (`isRemoteControl`, `instanceName`) stays stable
  across profile switches — it is a property of the device, not the profile.

## Scope Boundaries (non‑goals for v1)

- **No local‑only (logged‑out) profiles.** `useSharedConfig = false` stays single‑profile.
  *Tradeoff (accepted, documented):* KIP installs that run without Signal K security enabled are
  effectively logged‑out and will not see profiles. This excludes a real slice of out‑of‑box
  installs; revisit if adoption signal warrants. The existing device‑token → `global` scope path
  is a possible later route and is explicitly out of scope now.
- **No hot‑swap.** Switching uses a full page reload (reuses the proven reload path).
- **No enforced shared units across profiles.** A profile is a whole `IConfig` slot, so
  `unitDefaults` is per‑profile. Clone‑on‑create carries units forward, but a later edit to one
  profile's units does **not** propagate — displays can silently diverge. Mitigation: an
  edit‑time notice (see Unit 4) and help‑doc wording; enforced shared units is deferred.
- **No profile metadata registry** (icons, ordering, descriptions). Profiles are identified by
  slot name only. See Future Considerations for the trajectory risk this creates.
- **No quick‑switch in the main app chrome.** Management and switching live in Options only.
  *Tradeoff:* switching a potentially frequent action is three levels deep; accepted for v1.
- **No `IConfig` schema/version bump.** (The connectionConfig version *is* bumped — see Unit 5.)

## Context & Research

### Relevant code and patterns

- `src/app/core/interfaces/app-settings.interfaces.ts` — `IConfig {app, theme, dashboards}`,
  `IAppConfig` (currently holds `isRemoteControl`, `instanceName` — Unit 5 moves these),
  `IConnectionConfig` (`useSharedConfig`, `sharedConfigName`, `kipUUID`).
- `src/app/core/services/storage.service.ts` — named‑slot CRUD exists: `listConfigs` (enumerates
  arbitrary names per scope via `?keys=true`), `getConfig(scope,name)`, `setConfig(scope,name,
  config)` ("if name exists, replaced; else created" — this *is* create; returns an awaitable
  `Promise<null>`), `removeItem(scope,name)` (delete), `patchConfig` whose JSON‑Patch paths are
  all `/{sharedConfigName}/…`. **`StorageService.sharedConfigName` is assigned only inside
  `bootstrapRemoteContext`** — the single source of the degraded‑boot hazard (see Risks).
  `removeItem`/`patchConfig` post to a fire‑and‑forget sequential `patchQueue$` and return `void`;
  `patchConfig` uses JSON‑Patch `replace`, which requires the slot to pre‑exist. The storage URL
  is built by raw string concat with **no `encodeURIComponent`**.
- `src/app/core/services/settings.service.ts` — owns the private `sharedConfigName` (loaded from
  `connectionConfig`, persisted via `buildConnectionStorageObject`). `reloadApp()` is
  `location.replace("./")`, a **no‑op under `__KIP_TEST__`**. `setConnectionConfig` does *not*
  touch `sharedConfigName` today — there is no runtime setter. `startup()` early‑returns before
  `pushSettings()` when not bootstrapped (so in‑memory getters are empty on the degraded path).
  `resetSettings()` writes a blank default into the *current* `sharedConfigName` and no‑ops
  silently if storage isn't ready.
- `src/app/core/services/app-initNetwork.service.ts` — sole boot slot‑selection point: loads
  `getConfig('user', connectionConfig.sharedConfigName, …)` then `bootstrapRemoteContext`, **both
  inside the `try`**; a 404 is caught and `bootstrapRemoteContext` is skipped → storage slot name
  stays unset. Already emits `bootstrapIssue 'missing-shared-config'`. Upgrades connectionConfig
  versions in place (9→10→11→12).
- `src/app/app.component.ts` — the `missing-shared-config` degraded UX; its only recovery action
  calls `settings.resetSettings()` (which recreates the *current* name as blank, not a fallback
  to `default`).
- `src/app/core/components/options/configuration/config.component.ts` + `.html` — the
  "Configurations" tab to evolve. Hides `user/default` from its list and **blocks overwriting
  it**; chooses save scope by token type (device → `global`, user → `user`); the existing
  `if (this.storageSvc.setConfig(...))` check is a bug (treats a `Promise` as a sync boolean →
  always reports success). Has download/upload of a whole `IConfig`. `config.component.spec.ts`
  already exists.
- `src/app/core/components/dashboards-editor/dashboards-editor.component.ts` (+ bottom sheet) —
  CRUD UI pattern to mirror.
- `src/app/core/services/dialog.service.ts` — `openNameDialog` (name only — cannot express
  clone‑vs‑blank), `openConfirmationDialog` (destructive confirms).
- `src/app/core/services/remote-dashboards.service.ts` — drives remote display participation off
  `isRemoteControl` and the display name; `displayId` is `kipUUID` (per‑device `connectionConfig`),
  so two displays never collide — but `isRemoteControl`/`instanceName` are per‑profile today (the
  reason for Unit 5 / R8).

### Conventions to honor (`.github/instructions/`)

- New app‑internal types → `src/app/core/interfaces` (not `contracts`). Service‑centric
  architecture; signal‑based transient state. Test stack is **Vitest**
  (`@angular/build:unit-test` + `vitest.config.ts`, jsdom, `TestBed` + `describe/it/expect`,
  co‑located `*.spec.ts`). Theme/colors via KIP theme roles / CSS variables.

## Key Technical Decisions

- **Profile == named `user`‑scope config slot, holding a full `IConfig`.** Reuses existing
  storage; per‑profile theme falls out for free.
- **All `ProfileService` storage ops hardcode `scope: 'user'`** — do not inherit the
  component's token‑type scope selection. Device‑token sessions cannot use the user scope, so
  profiles are unavailable for them (consistent with the "Profiles require login" gating); never
  silently written to shared `global`.
- **Active profile is per‑device** via the always‑local `connectionConfig.sharedConfigName`, made
  runtime‑mutable. *Tradeoff (accepted):* a per‑device choice does not follow the user to a new
  browser/device and is reset by a localStorage clear. Documented in help.
- **Switch = persist the new name to `connectionConfig`, drain pending writes, then
  `reloadApp()`.** After reload the normal bootstrap loads the chosen slot and re‑syncs the slot
  name. The re‑sync is reliable **only on the authenticated, storage‑ready path**; the degraded
  path is handled explicitly (see write‑safety guard, Unit 2, and recovery, Unit 6).
- **Create = `setConfig('user', name, seed)` first (awaited; creates the slot), then optionally
  switch.** Order matters: `patchConfig` `replace` and the bootstrap both assume the slot exists.
  `seed` = a clone of the current active `IConfig` (only when settings are loaded) or a blank
  default.
- **Profile‑name validation is a security invariant (Unit 3), not a deferred detail.** Names are
  URL path segments *and* JSON‑Patch keys (`/{name}/…`) *and* must avoid the `::` list‑key
  separator. Enforce an allow‑list charset (e.g. `[A-Za-z0-9 _-]`), bound length, reject empty /
  `default` / `/` / `..` / `~` / `::`; `encodeURIComponent` at the storage boundary as
  defense‑in‑depth. Server‑side acceptance is probed in Unit 1.
- **`default` is the reserved fallback profile name.** `DefaultConnectionConfig.sharedConfigName
  = 'default'`, but `useSharedConfig` defaults to `false`, so a *fresh* device boots into local
  single‑config mode and the `user/default` *slot* is not created until the first shared‑config
  write — it is not guaranteed to exist or appear in `listConfigs` for a brand‑new shared user.
  v1 treats `default` as reserved: cannot create another profile named `default`, cannot delete
  or rename it, and recovery/fallback must **create** it (blank `IConfig`) when absent rather than
  assume a switch will find it.
- **Remote‑control identity is per‑device (R8).** `isRemoteControl` and `instanceName` move from
  `IAppConfig` (profile) to `IConnectionConfig` (device), beside `kipUUID`, so switching profiles
  never changes a screen's remote‑control role or advertised name, and two screens sharing one
  profile can still be named distinctly. (Unit 5.)
- **Logic lives in a new `ProfileService`** (mirrors `DashboardService` owning dashboard CRUD),
  orchestrating `StorageService` (slot CRUD) and `SettingsService` (active name + reload +
  snapshot). Could fold into `SettingsService` if maintainers prefer; kept separate for cohesion.
- **User‑facing term: "Profiles."** Internally/storage they remain named configs.

## Open Questions

### Resolved during planning / review

- *What is a profile?* A `user`‑scope named `IConfig` slot. *Active stored where?* Per‑device
  `connectionConfig.sharedConfigName`. *Switch?* Persist + reload. *Migration?* None for `IConfig`.
  *Local mode?* Out of scope v1. *Logic?* `ProfileService`. *`default`?* Reserved fallback.
- *Do per‑login multi‑display setups collide on remote‑control id?* No — `displayId` is the
  per‑device `kipUUID`. But `isRemoteControl`/`instanceName` were per‑profile → resolved by R8
  (hoist to per‑device).
- *Name validation?* Pinned as a Unit 3 security invariant (was deferred).
- *Import target?* Import creates a new profile by default (R7); never silently overwrites.

### Deferred to implementation

- Exact `ProfileService`/`SettingsService` method names and signatures.
- Whether the queued‑write drain before switch (Unit 2) is a new `StorageService` flush primitive
  or a best‑effort await; and the exact double‑switch re‑entrancy guard.
- Rename‑of‑active mechanism: committed to **awaitable delete** (Unit 3) to avoid the orphan; the
  precise awaitable‑delete shape is chosen against real code.
- Exact recovery affordance wording reused/extended from `app.component`.

## High‑Level Technical Design

> *Directional guidance for review, not implementation specification.*

**Model mapping**

```
Signal K applicationData (per Signal K user, JWT-gated)
  user/kip/{fileVersion}/
    ├── default     ← reserved fallback profile (created on first shared write)  ┐
    ├── cabin       ← profile                                                    ├ each value = full IConfig
    └── cockpit     ← profile                                                    ┘   {app, theme, dashboards}

Per device (localStorage connectionConfig):
  sharedConfigName  → which profile this screen shows
  kipUUID           → this screen's remote-control identity
  isRemoteControl   → this screen participates in remote control   (moved here in Unit 5)
  instanceName      → this screen's advertised name                (moved here in Unit 5)
```

**Switch flow (reload‑based, write‑safe)**

```mermaid
sequenceDiagram
  participant UI as Profiles UI
  participant PS as ProfileService
  participant SET as SettingsService
  participant ST as StorageService
  participant LS as localStorage(connectionConfig)
  participant BOOT as app-initNetwork (next load)

  UI->>PS: switchProfile("cockpit")
  PS->>ST: drain/await pending patchQueue writes for current profile
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

- [ ] **Unit 1: Pre‑flight — verify named‑slot behavior on a live Signal K server**

**Goal:** Confirm the one external assumption before building on it. Lightweight (a few `curl`s /
a throwaway probe), not a build unit — but a hard gate.

**Requirements:** R1–R4 (foundational).

**Dependencies:** None.

**Files:** none persistent. Record findings in this doc's Open Questions.

**Approach:** Against a real server (Signal K demo or `halosdev.local`): create/list/get/delete
arbitrary user‑scope names; confirm `listConfigs` returns new names; **confirm read‑after‑write
consistency** (create then immediately get the same name returns the slot — the create‑then‑switch
flow depends on it); probe name charset (spaces, unicode, `/`, `..`, `~`, very long); confirm
`patchConfig`‑style `replace` fails on a missing slot; confirm whether the server auto‑creates a
slot on first `patch` to a missing name or requires explicit `setConfig`.

**Test expectation:** none (probe). Output: go/no‑go + the allowed‑name rule (feeds Unit 3) +
the auto‑create answer (feeds Unit 6 / `default` handling).

**Verification:** Documented confirmation that arbitrary user‑scope names round‑trip with
read‑after‑write consistency, plus the charset and auto‑create answers.

---

- [ ] **Unit 2: `SettingsService` + `StorageService` — runtime‑mutable active profile, write‑safety**

**Goal:** Make the slot name runtime‑settable, expose a guarded config snapshot, and ensure no
config write can ever target an unset/`undefined` slot.

**Requirements:** R2, R3, R6.

**Dependencies:** Unit 1.

**Files:**
- Modify: `src/app/core/services/settings.service.ts`
- Modify: `src/app/core/services/storage.service.ts`
- Test: `src/app/core/services/settings.service.spec.ts`, `src/app/core/services/storage.service.spec.ts`

**Approach:**
- Active‑profile read accessor (current `sharedConfigName`) and a setter that sets the private
  name, persists `connectionConfig` to localStorage (`buildConnectionStorageObject` already
  includes the field), and triggers `reloadApp()`.
- **Write‑safety guard (P0):** `patchConfig` must refuse to write when its slot name is unset
  (e.g. `undefined`/empty) — throw or no‑op with a logged error rather than POST to `/undefined/…`.
  ProfileService/UI must gate mutations on `storage.isRemoteContextBootstrapped()` /
  `storageServiceReady$`, not merely on `hasToken`. This closes the degraded‑boot corruption path.
- **Queue drain before switch:** provide a way to await the `patchQueue$` settling (or a documented
  best‑effort) so a switch does not abandon a just‑made edit to the leaving profile.
- **Config snapshot** for clone: assemble an `IConfig` from `getAppConfig`/`getDashboardConfig`/
  `getThemeConfig`. **Guard:** these are populated only by `pushSettings()`, which `startup()`
  skips on the degraded path — only offer "clone current" when settings are actually loaded;
  otherwise disable clone / fall back to blank so a hollow snapshot can't seed a broken profile.

**Patterns to follow:** existing setter→persist pattern; `reloadApp()`'s `__KIP_TEST__` guard.

**Test scenarios:**
- Happy path: setting the active profile persists the new name into `connectionConfig` localStorage
  and invokes the reload primitive (reload is a no‑op under test; assert the persisted value).
- Happy path: active‑profile getter returns the boot‑loaded name.
- Happy path: snapshot returns an `IConfig` matching current settings when loaded.
- Edge: snapshot/clone requested while not bootstrapped → clone unavailable / blank fallback, no
  hollow slot written.
- Error (P0): `patchConfig` with an unset slot name does NOT POST to `/undefined/…` (assert no
  request / thrown guard).
- Edge: switch requested with a pending queued write → the write is drained/awaited (or documented
  best‑effort), not silently dropped.

**Verification:** Active profile is runtime‑settable and durable; no write path can target an
unset slot; clone never seeds from an empty snapshot.

---

- [ ] **Unit 3: `ProfileService` — profile CRUD + switch orchestration**

**Goal:** One service owning list / switch / create / rename / duplicate / delete, with guard
rails, name validation, and clone seeding.

**Requirements:** R1, R2, R3, R4, R5, R6.

**Dependencies:** Unit 2.

**Files:**
- Create: `src/app/core/services/profile.service.ts`, `src/app/core/services/profile.service.spec.ts`
- Modify (only if a summary type adds value): `src/app/core/interfaces/app-settings.interfaces.ts`
  (reuse `StorageService.Config {name, scope}` otherwise).

**Approach:**
- **List:** `listConfigs()` filtered to `user` scope; **include `default`**; mark the active one;
  expose as a signal. If `default` is absent (fresh shared user), surface it as a creatable entry.
- **Switch:** delegate to `SettingsService.setActiveProfile` (drain → persist → reload).
- **Create:** validate name (charset invariant above; reject empty / `default` / existing /
  invalid); seed = guarded clone or blank; `await setConfig('user', name, seed)`; refresh. Do not
  auto‑switch unless the UI asks, and only offer switch after `setConfig` resolves.
- **Duplicate:** `getConfig` source → `setConfig` new name.
- **Rename:** create new slot (awaited) → if renaming the **active** profile, switch to the new
  name → delete old via an **awaitable delete** (await before/around reload) so no orphan
  accumulates. Non‑active rename needs no reload.
- **Delete:** guard — refuse active, `default`, or the last remaining profile; else `removeItem`.
- **Do not replicate** `config.component.ts`'s `if (this.storageSvc.setConfig(...))` pattern:
  `setConfig` returns `Promise<null>` (always truthy) so that code's success branch always fires
  and its error branch is dead. `await` storage calls in `try/catch`; gate success toast / list
  refresh / switch on resolution; surface `HttpErrorResponse`; never change the active name on a
  failed mutation.
- **Hardcode `scope: 'user'`** for all operations.

**Patterns to follow:** `DashboardService` CRUD shape; `dialog.service` naming/confirmation.

**Test scenarios:**
- Happy: list includes `default`, active flagged; create (blank/clone), duplicate, switch delegate
  correctly.
- Edge/Error: create with empty / `default` / existing / invalid‑charset name → rejected, no
  `setConfig`, error surfaced.
- Edge/Error: delete active / `default` / last → blocked with a clear reason; no `removeItem`.
- Error: `setConfig`/`getConfig` rejects → error surfaced, no success toast, no switch offered,
  active name unchanged.
- Integration: create‑then‑switch only proceeds after `setConfig` resolves; rename‑of‑active
  awaits the delete (no orphan); rename‑non‑active does not reload.

**Verification:** Full CRUD with guards enforced; no operation leaves the device on a missing slot
or accumulates orphans; failed writes never report success.

---

- [ ] **Unit 4: Profiles UI in the Configurations tab**

**Goal:** Replace the backup/restore framing with a Profiles experience.

**Requirements:** R1, R2, R3, R4, R5, R7.

**Dependencies:** Unit 3.

**Files:**
- Modify: `src/app/core/components/options/configuration/config.component.ts` / `.html` / `.scss`
- Test: `src/app/core/components/options/configuration/config.component.spec.ts` (extend the
  existing spec)

**Approach:**
- Render the profile list (from `ProfileService`); mirror the `dashboards-editor` interaction.
- **Remove the `user/default` special‑casing** (hide filter + save block) so `default` appears as
  a normal (protected) profile. Keep `default` non‑deletable via `ProfileService` guards, and
  **preserve a controlled‑write invariant**: a full `IConfig` write to `default` only happens via
  create‑seed or an explicit, confirmed import — never an accidental clobber (this is what the
  removed save‑block used to prevent).
- **Specify these interactions (don't leave to the implementer):**
  - *Switch:* confirmation dialog naming the target + a blocking progress affordance during the
    ~1–2s reload so the blank boot reads as intentional.
  - *Create:* surface the clone‑vs‑blank choice explicitly (extend the name dialog with a
    selector, or two entry points "New from current" / "New blank"); state the default and what
    clone carries over (dashboards + theme + units).
  - *Active marker + per‑device cue:* mark the active profile (leading check; switch suppressed on
    the active row) and label it "Active on this device" so per‑device semantics are visible.
  - *State content:* define copy for logged‑out ("Profiles require Signal K login"),
    blocked‑delete (default / active / last — disabled with reason), name‑collision and
    invalid‑charset (inline dialog validation, not a post‑submit toast), and the missing‑slot
    recovery offer (Unit 6).
- **Import (R7): create a new profile by default** — prompt for a name, **validate the uploaded
  JSON against the `IConfig` shape** before writing, and `setConfig` under the new name; never
  silently overwrite. If an explicit "import into active" is offered, it must show a confirmation
  naming the exact target. Replace the generic "overwrite active configuration" warning (also on
  the Demo/Default reset buttons) with target‑named confirmations.
- **Export:** serializes `IConfig` only; note that it intentionally excludes `IConnectionConfig`
  (credentials, server URL) so a future inclusion is recognized as a credential‑handling change.
- **Returning‑user migration:** pre‑existing user‑scope named backups will appear as profiles;
  show a one‑time onboarding note and keep an export affordance so the backup workflow isn't lost.
- Theme via CSS variables; no hardcoded colors.

**Patterns to follow:** `dashboards-editor.component.ts` (+ bottom sheet), `dialog.service`.

**Test scenarios:**
- Happy: list renders with active marked; switching a non‑active profile calls `switchProfile`;
  "New profile" opens the create flow with the chosen seed; rename/duplicate/delete call the
  service with confirmation.
- Edge: delete affordance absent/disabled for `default`, active, and last; logged‑out shows the
  notice and no actions.
- Error: import of malformed JSON is rejected (shape validation) with a toast; a failing service
  call surfaces a toast and leaves the list intact.
- Integration: import creates a *new* profile (does not overwrite the active one).

**Verification:** A logged‑in user can complete the full lifecycle; active is obvious; no
destructive action lacks a target‑named confirm; import never clobbers another profile.

---

- [ ] **Unit 5: Hoist remote‑control identity to per‑device (R8)**

**Goal:** Move `isRemoteControl` and `instanceName` from `IAppConfig` (profile) to
`IConnectionConfig` (device) so a profile switch never changes a screen's remote‑control role or
advertised name.

**Requirements:** R8.

**Dependencies:** Unit 2 (touches the same config plumbing); independent of Unit 3/4.

**Files:**
- Modify: `src/app/core/interfaces/app-settings.interfaces.ts` (move both fields)
- Modify: `src/app/core/services/settings.service.ts` (read/persist from connectionConfig; their
  setters route to connectionConfig, not `patchConfig`)
- Modify: `src/app/core/services/app-initNetwork.service.ts` (connectionConfig version bump +
  one‑time migration: lift existing values from the loaded profile into connectionConfig)
- Modify consumers: `src/app/core/services/remote-dashboards.service.ts` and any reader of
  `getIsRemoteControl*/getInstanceName*` (verify via grep)
- Test: `settings.service.spec.ts`, `app-initNetwork.service.spec.ts`,
  `remote-dashboards.service.spec.ts`

**Approach:** Add the two fields to `IConnectionConfig`; bump its `configVersion` and add a
migration in the existing connectionConfig upgrade chain that, on first run, copies the values
from the active profile's `IAppConfig` into `connectionConfig` (default `isRemoteControl=false`,
`instanceName=''` if absent). Remove them from `IAppConfig` and the `patchConfig`/build paths.
Repoint `RemoteDashboardsService` to the connectionConfig‑backed values.

**Patterns to follow:** the existing connectionConfig version‑upgrade steps in
`app-initNetwork.service.ts`; the existing per‑device field handling for `kipUUID`.

**Test scenarios:**
- Happy: setting `isRemoteControl`/`instanceName` persists to connectionConfig (per‑device), not
  to the profile slot; a profile switch leaves them unchanged.
- Integration: `RemoteDashboardsService` participation reflects the device value before and after a
  profile switch (no toggle on switch).
- Migration: a pre‑existing config with these fields in `IAppConfig` lifts them into
  connectionConfig exactly once; absent values default safely.

**Verification:** Switching profiles never changes remote‑control participation or advertised
name; two screens on one profile can hold distinct names.

---

- [ ] **Unit 6: Bootstrap & degraded‑path recovery**

**Goal:** Per‑device active profile loads at boot; a missing/renamed/deleted active slot recovers
gracefully without data‑loss surprises and without `/undefined` writes.

**Requirements:** R2, R4, R6.

**Dependencies:** Unit 2 (write‑safety guard), Unit 3 (list/create), behavioral overlap with 4.

**Files:**
- Modify: `src/app/core/services/app-initNetwork.service.ts`, `src/app/app.component.ts`
- Test: `app-initNetwork.service.spec.ts`, `app.component.spec.ts`

**Approach:**
- Confirm boot honors a non‑`default` `sharedConfigName` (it does) — assert via test.
- Rework the `missing-shared-config` recovery so it does NOT blindly `resetSettings()` into the
  dead name (which recreates it blank, silently). Offer: (a) switch to the protected `default`
  profile, creating the `default` slot if absent; and/or (b) pick from `listConfigs` of surviving
  profiles. Make the offered action and resulting active name explicit.
- Ensure that in any degraded state, the Unit 2 write‑safety guard prevents `/undefined` writes.

**Test scenarios:**
- Happy: boot with `sharedConfigName="cockpit"` loads that slot and bootstraps storage with it.
- Edge/Error: boot when the remembered slot 404s → `missing-shared-config`; recovery offers
  fall‑back‑to‑default (creating it if absent) or pick‑from‑list; the resulting active name is
  asserted; no write targets `/undefined`.

**Verification:** A device whose profile was deleted elsewhere recovers to a usable, explicitly
chosen state; no silent data loss; no corrupt slot.

---

- [ ] **Unit 7: Documentation & changelog**

**Goal:** Explain profiles and record the change.

**Requirements:** R1–R8 (discoverability).

**Dependencies:** Units 2–6.

**Files:** the Login & Configuration help doc under `src/assets/help-docs/` (the
`/help/configuration` content); `CHANGELOG.md`.

**Approach:** Document: what a profile is; per‑device active selection (and that it doesn't follow
the user across browsers / survives a localStorage clear); clone‑on‑create; per‑profile theme;
the per‑profile **units** caveat (divergence after edit); the `default` fallback; remote‑control
identity now per‑device (R8); the remote‑only v1 limitation; and that prior backups now appear as
profiles. Consistent "Profiles" terminology.

**Test expectation:** none — docs only.

**Verification:** Help matches shipped behavior; CHANGELOG entry present.

## System‑Wide Impact

- **Interaction graph:** a switch is a full reload → re‑runs `app-initNetwork` → storage bootstrap
  → `settings.startup` → `pushSettings` → dashboards signal → widgets; `RemoteDashboardsService`
  re‑broadcasts. After Unit 5, remote‑control participation is device‑bound and unaffected by the
  profile change.
- **Error propagation:** storage ops throw `HttpErrorResponse`; `ProfileService` surfaces via
  toast and leaves active state unchanged on failure (await + try/catch, not the truthy‑Promise
  pattern).
- **State lifecycle risks:** `patchQueue$` is fire‑and‑forget; switch drains it; `patchConfig`
  refuses unset slot names; rename‑of‑active uses an awaitable delete to avoid orphans.
- **API surface parity:** two `sharedConfigName` fields (`SettingsService` private +
  `StorageService` public). The reload re‑syncs both **only on the authenticated, storage‑ready
  path**; the degraded path is covered by the write‑safety guard (Unit 2) and recovery (Unit 6),
  not by assuming re‑sync.
- **Integration coverage:** the reload is a no‑op under `__KIP_TEST__`; assert pre‑reload side
  effects in unit tests, and cover the post‑reload load path with a focused integration test that
  drives `AppNetworkInitService.initNetworkServices` with a non‑`default` `sharedConfigName` and
  asserts `bootstrapRemoteContext` is called with that name.
- **Unchanged invariants:** `IConfig` schema; `configFileVersion` (11) and `configVersion`
  semantics; `ConfigurationUpgradeService`; local‑mode single‑config behavior; the Signal K
  `applicationData` endpoint contract; widget/dataset/history pipelines. *(connectionConfig
  version IS bumped in Unit 5.)*

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Degraded boot leaves the storage slot name unset → writes corrupt a `/undefined` slot | Unit 2 write‑safety guard: `patchConfig` refuses unset names; mutations gated on `isRemoteContextBootstrapped()`. |
| Import silently overwrites the wrong profile | R7: import creates a new profile by default; JSON shape‑validated; target‑named confirm for any overwrite. |
| Missing‑slot recovery recreates the dead name blank (silent data loss) | Unit 6: recovery falls back to / creates `default` or lets the user pick; never blind `resetSettings()` into the dead name. |
| Switching toggles remote‑control role/name | Unit 5: hoist `isRemoteControl`/`instanceName` to per‑device. |
| `reloadApp()` abandons queued `patchConfig` writes (edit‑then‑switch loss) | Unit 2: drain/await the patch queue before reload; guard re‑entrant double‑switch. |
| Profile name path/JSON‑Patch injection | Unit 3 name‑validation invariant + `encodeURIComponent`; Unit 1 probes server acceptance. |
| `setConfig` truthy‑Promise success‑on‑failure | Unit 3: await in try/catch; don't port the existing pattern. |
| Server rejects arbitrary names / lacks read‑after‑write consistency | Unit 1 pre‑flight gates the work. |
| `default` slot assumed to exist but doesn't (fresh shared user) | Decisions/Unit 3/6: treat `default` as creatable‑if‑absent; never assume `listConfigs` includes it. |
| Per‑profile units diverge after edit | Edit‑time notice + help wording (Units 4/7); enforced shared units deferred. |
| Returning users' backups surface as switchable profiles | Onboarding note + retained export affordance (Unit 4/7). |
| Clone seeds from a hollow snapshot in degraded state | Unit 2: clone only when settings loaded; else blank. |

## Future Considerations

- **Slot‑name‑as‑identity is a path dependency.** Because the display name doubles as the storage
  key, the deferred metadata registry (icons, ordering, friendly names decoupled from keys) would
  be a *breaking* change to the identity model, not an additive layer — and renaming already needs
  create‑new + delete‑old. If a registry looks likely, consider introducing a thin stable id
  (generated key + separate display name) sooner to avoid a later migration.
- **Local‑mode and device‑token (`global` scope) profiles** are the natural next scope expansions.

## Sources & References

- Grounding exploration + a multi‑persona document review (2026‑06‑23) that verified claims
  against `storage.service.ts`, `settings.service.ts`, `app-initNetwork.service.ts`,
  `app.component.ts`, `config.component.*`, `remote-dashboards.service.ts`,
  `dashboards-editor.component.ts`, `dialog.service.ts`, `app-settings.interfaces.ts`.
- Conventions: `.github/instructions/project.instructions.md`,
  `.github/instructions/best-practices.instructions.md`, `COPILOT.md`.
- Upstream: `mxtommy/kip` (this is the `mairas/Kip` fork, `named_configs` branch).
