---
title: "feat: Standard Signal K authentication for KIP (cookie-session + OIDC redirect)"
type: feat
status: active
date: 2026-06-23
deepened: 2026-06-24
---

# Standard Signal K authentication for KIP

> **Plan location note:** This design doc lives on the `feat/signalk-standard-auth` branch (mirroring
> how `docs/named-configs-plan.md` is kept on `named_configs`). The auth branch bases off `master`
> (connectionConfig v12); `named_configs` (profiles, currently v13) rebases on top after auth merges.

> **Revised 2026-06-23/24 after two seven-persona document-review passes** (coherence, feasibility,
> security, adversarial, scope, product, design). Pass 1 found three P0 breaks (cookie mode
> unreachable out-of-box; profiles hidden in cookie mode; WS never reconnects). Pass 2 found a fourth
> P0 (storage-routing split-brain: auth decoupled from `useSharedConfig` but config *persistence* was
> not) plus read-only-session, Freeboard-iframe-proxy, and loop-recovery (`noAutoLogin`) P1s — all
> folded in below. User decisions: **auto-detect mode, no toggle**; **profiles stay paused and this
> plan owns the cookie-mode profiles fix**; **sign-out cut from scope**.

## Overview

KIP authenticates with a self-managed login: a modal credential form POSTs username/password to
`auth/login`, stores the returned JWT in `localStorage`, and attaches it as an
`authorization: JWT <token>` header and a WebSocket `&token=` query parameter. It never uses the SK
session cookie and has no OIDC awareness.

When KIP is served by a Signal K server that uses session/OIDC auth (the HaLOS deployment), this
forces a second SK-local login on top of the SSO the user already completed — and for
OIDC-provisioned users it is a dead end, because they have no SK-local password to type.

This plan replaces KIP's auth with the SK-documented embedded-webapp pattern, **auto-detected** by
how KIP is served:

- **Cookie mode (new, same-origin):** when KIP is served by the SK server (effective request origin
  equals the app origin), send requests with credentials so the httpOnly session cookie
  authenticates KIP; derive auth state from `/skServer/loginStatus`; when login is needed, redirect
  to the SK-advertised login URL (`oidcLoginUrl` when OIDC is enabled, otherwise the admin login),
  which drives Authelia SSO. Config persists to server `applicationData` (the path profiles use),
  decoupled from the stored `useSharedConfig` flag.
- **Standalone mode (kept):** when KIP runs cross-origin (a PWA/host pointed at a boat's SK server),
  keep the existing token / device-token model, because cookies cannot flow cross-origin. This
  umbrella covers the two cross-origin sub-modes (user-token and device-token) plus local-only.

Mode is auto-detected with no user-facing toggle (decision during review). A standalone security
fix rides along regardless of mode: stop persisting the login password in plaintext.

Auth is a **hard** prerequisite for the tabled profiles feature (`docs/named-configs-plan.md`) **for
OIDC-provisioned users only** — they have no SK-local password and cannot get a per-user identity via
the form. For SK-local-password users the form already yields a valid identity, so auth-first there
is a chosen ordering (the target HaLOS deployment is OIDC-only), not a structural dependency. This
plan **owns** the change that makes profiles visible and writable in cookie mode (Unit 8); profiles
otherwise stay paused and rebase on top.

## Problem Frame

The user hit KIP's "Sign in to Signal K" dialog while already authenticated to HaLOS via Authelia
SSO. Three real defects, in order of severity:

1. **No SSO participation / dead-end login.** The SK server (HaLOS) is itself an OIDC client of
   Authelia. After SSO the browser already holds SK's `JAUTHENTICATION` cookie, same-origin under
   `:4430` where KIP is served. KIP discards it and demands a separate SK-local login. OIDC users
   have no SK-local password (confirmed), so the form cannot be satisfied.
2. **Plaintext credential storage.** `connectionConfig.loginPassword` is persisted in plaintext and
   re-sent on token renewal.
3. **Token-in-JS exposure.** The JWT lives in `localStorage` and rides in the WebSocket query
   string — the exposure surface of SK advisory GHSA-fq56-hvg6-wvm5. The sanctioned pattern is the
   httpOnly session cookie.

"The custom form breaks OIDC" is imprecise: the SK OIDC flow keeps working; KIP refuses to
participate in it. The fix is "make KIP use the SK session like the SK docs say," not "make KIP
OIDC-aware" — KIP needs no OIDC code, only cookie + loginStatus + redirect.

## Requirements Trace

- **R1.** In cookie mode (same-origin) with an auth-requiring SK server, KIP must not show its own
  credential form; it authenticates via the SK session cookie.
- **R2.** Auth state in cookie mode is derived from `/skServer/loginStatus`, not token presence.
- **R3.** When login is needed in cookie mode, KIP redirects to the SK-advertised login
  (`oidcLoginUrl` when `oidcEnabled`, else admin login), participating in SSO; honor `oidcAutoLogin`.
- **R4.** Cookie-mode REST, WebSocket, and the embedded Freeboard-SK iframe carry the session cookie
  (`withCredentials` / same-origin handshake / origin-correct cookied iframe). No JWT in
  `localStorage`, no `&token=` on the WS, and no `?token=` on the iframe in cookie mode.
- **R5.** Standalone cross-origin mode keeps the existing user-token and device-token login. Mode is
  auto-detected from the effective request origin.
- **R6.** `loginPassword` is no longer persisted in either mode. Token-mode renewal no longer
  re-sends stored credentials; on expiry KIP surfaces re-login.
- **R7.** Cookie mode auto-engages for a fresh same-origin install of an auth-requiring SK server,
  without the user first enabling shared config.
- **R8.** Cookie-mode auth must not hide profiles: availability keys off the session signal, not
  token presence (this plan owns the fix; it lands in the profiles rebase — Unit 8).
- **R9.** The redirect-back target is validated as same-origin/relative-only, redirects are bounded
  across reloads (kiosk + `oidcAutoLogin` must not loop), and recovery uses `noAutoLogin` so a manual
  retry is not auto-bounced.
- **R10.** The CSRF posture for cookie-authenticated state-changing calls is verified (SameSite /
  Origin enforcement) as a gating acceptance check, not just recorded.
- **R11.** The change must not break standalone installs, and same-origin non-OIDC secured servers
  get a coherent admin-login redirect, not a regression.
- **R12.** In cookie mode, config **persistence** routes to server `applicationData` regardless of
  the stored `useSharedConfig` flag — the server-storage decision is derived from resolved cookie
  mode, the same way auth is.
- **R13.** Write affordances (profile create/rename/delete/switch, config save) are gated on a
  write-capable session; a logged-in but read-only session must not present editable controls that
  silently fail server-side.

## Scope Boundaries

- **Not** adding OIDC/OAuth client code to KIP. KIP delegates entirely to the SK server's login.
- **Not** implementing proxy-layer ForwardAuth (see Alternatives — SK does not trust forwarded
  identity headers).
- **Not** a user-facing mode toggle, and **not** a passive mode-explainer label. Mode is
  auto-detected and otherwise transparent (the identity block shows who you are, not which mode).
- **Not** a cookie-mode sign-out flow (cut during review). Session ends via SK/Authelia expiry. Known
  limitation: on a shared/helm display the next user resumes the prior session until expiry —
  acceptable for single-operator boats; revisit sign-out + SSO single-logout if multi-user-per
  -display deployments emerge.
- **Not** re-building the device-access-token acquisition UI (no live caller). The device-token
  plumbing stays intact as the cross-origin fallback.
- **Not** resuming the profiles feature; this plan only unblocks it and owns the availability fix.
- **Not** bumping the `connectionConfig` schema version (stay at 12; idempotent password purge).

## Context & Research

### Relevant code and patterns

- `src/app/core/services/authentication.service.ts` — `login()` POSTs `auth/login`; `setSession()` /
  `setDeviceAccessToken()` store `IAuthorizationToken` (`authorization_token`) and drive
  `_IsLoggedIn$` / `_authToken$`; the constructor **deletes a stored user token but re-emits a
  stored device token** synchronously; renewal timer re-POSTs stored `loginName`/`loginPassword`;
  URLs derived from `serverServiceEndpoint$` (post-discovery). `renewToken()` (`auth/validate`) is
  unused — and the endpoint **404s on the live server**.
- `src/app/core/services/settings.service.ts` — **`setConnectionConfig` couples
  `useDeviceToken = !useSharedConfig`** (not independent). In-memory `useSharedConfig` field
  initializes `true`, but `DefaultConnectionConfig` (config.blank.const.ts) sets it **false**, and a
  fresh install persists the const → false. **16 `if (this.useSharedConfig)` write branches** plus
  `startup()`'s shared-vs-local load route persistence; `buildConnectionStorageObject` persists
  `loginPassword`.
- `src/app/core/services/signalk-connection.service.ts` — `processEndpointResponse()` has a **proxy
  mode** that rewrites HTTP/WS endpoints to `window.location.origin`, but leaves `signalKURL`
  (the configured URL) unchanged. Discovery GET to `/signalk/` is unauthenticated.
- `src/app/core/services/app-initNetwork.service.ts` — `APP_INITIALIZER` bootstrap. `signalKUrl`
  defaults to `window.location.origin`. Bootstrap login gates on
  `useSharedConfig && loginName && loginPassword`; remote-profile bootstrap gates on
  `isLoggedIn && useSharedConfig`; three `router.navigate(['/login'])` sites. State keyed on
  `isLoggedIn` (token presence today).
- `src/app/core/interceptors/authentication-interceptor.ts` — adds the `JWT` header **whenever a
  token exists** (keys on token, not mode); no `withCredentials`.
- `src/app/core/services/signalk-delta.service.ts` — WS URL from `WsServiceUrl`; appends `&token=`
  only when a token exists; the **only** auth-driven reconnect is the `authToken$`-change
  subscription, guarded by `isFullyConnected()` (dead in cookie mode — token is permanently null).
  Initial connect is driven by the bootstrap `finally` (`startWebSocketConnection()` when
  `isHTTPConnected()`).
- `src/app/widgets/widget-freeboardsk/widget-freeboardsk.component.ts` — builds the iframe `src`
  from `appSettings.signalkUrl.url` (the **configured** URL) and appends `?token=` when a token
  exists; a **third token carrier** that also resolves to the configured origin, not the rewritten one.
- `src/app/core/services/storage.service.ts` — readiness gated on
  `networkStatus===connected && _isLoggedIn && serverEndpoint` (no `useSharedConfig` reference);
  user-scope `applicationData` path `user/kip/<ver>/<name>`; `isAppDataSupported` from version ≥
  1.27.0. Scope is resolved **server-side** from the session; no client-side username needed.
- `src/app/widgets/widget-login/widget-login.component.ts` — the `/login` route; **`ngOnInit` opens
  the credential dialog unconditionally** (renders no body of its own); writes `loginPassword` back
  via `setConnectionConfig`.
- `src/app/core/components/options/signalk/signalk.component.ts` — Connectivity tab; opens the
  credential dialog; `connectToServer` deletes the token only when
  `authToken && !useSharedConfig && !isDeviceAccessToken`; reloads after connect.
- `src/app/app.routes.ts` — `/login` → `WidgetLoginComponent`.
- **Profiles (on `named_configs`, not master):** `config.component.ts` computes
  `profilesAvailable = supportApplicationData && Boolean(authToken()?.token) && !isTokenTypeDevice`;
  `getActiveConfig()` keys off `useSharedConfig`. The gates Unit 8 must re-key. `config.component`
  already injects `AuthenticationService` and uses `toSignal(authToken$)`, so consuming a new signal
  is mechanically simple.

### Verified device + server facts (halosdev.hal, signalk-server v2.27.0)

- KIP is served at `https://halosdev.hal:4430/@mxtommy/kip/`, **same origin** as the SK API at
  `:4430`. The `/signalk-server/` Traefik path 302-redirects to `:4430`; KIP makes relative calls
  from `:4430`.
- `GET /skServer/loginStatus` at `:4430` → 200 JSON: `status:"notLoggedIn"`,
  `authenticationRequired:true`, `oidcEnabled:true`, `oidcAutoLogin:true`,
  `oidcLoginUrl:"/signalk/v1/auth/oidc/login"`, `oidcProviderName:"HaLOS SSO"`. Probed **without**
  credentials — re-verify behavior with `withCredentials` (deferred).
- `GET /signalk/v1/auth/oidc/login` → 302 to Authelia auth-code + PKCE; OIDC `redirect_uri` is the
  path form (`/signalk-server/.../callback`). SK's OIDC login accepts a `returnTo` param; local login
  is reachable at `/admin/#/login?noAutoLogin=true`.
- `POST /signalk/v1/auth/validate` → **404**. No token-refresh endpoint.
- OIDC-provisioned users have **no** SK-local password (user-confirmed).
- `connectionConfig` version is 12 on `master`; `named_configs` bumps to 13. `named_configs`'s
  merge-base with `master` is `master` HEAD, and `master` has **no** profiles code — so the
  auth-merges-before-Unit-8 window touches no production user (profiles ship only via the later rebase).

### External references

- SK embedded-webapp auth: https://demo.signalk.org/documentation/develop/webapps.html
- SK security / login + loginStatus + cookies: https://signalk.org/specification/1.7.0/doc/security.html
- `loginRedirect.ts` (validation: relative-only, reject `//`, control chars, self-route loop — **no
  budget**): https://github.com/SignalK/signalk-server/blob/master/packages/server-admin-ui/src/views/security/loginRedirect.ts
- SK OIDC (`returnTo`, `noAutoLogin`): https://raw.githubusercontent.com/SignalK/signalk-server/master/docs/oidc.md
- Token-theft advisory: GHSA-fq56-hvg6-wvm5
- KIP README (same-origin / bundled-with-SK is the primary distribution): https://github.com/mxtommy/Kip

## Key Technical Decisions

- **Mode detection is two-stage, origin-first, decoupled from `useSharedConfig`.** Stage 1
  (synchronous, pre-discovery, in the `AuthenticationService` constructor): cookie mode is a
  *candidate* when the effective request origin equals `window.location.origin` — true when
  `proxyEnabled` (endpoints rewrite to it) or when `connectionConfig.signalKUrl` parses same-origin
  (empty → app origin). Stage 2 (after `loginStatus`): if `authenticationRequired` and
  `applicationData` supported, full cookie mode engages, regardless of the stored flags. Resolves
  out-of-box reachability (R7) and the flag-coupling contradiction.
- **Two derived signals, both owned by Unit 3** (they need `loginStatus`): `isUserSession` =
  cookie-mode-logged-in OR (token present AND not device); `canWriteUserData` = `isUserSession` AND
  not `loginStatus.readOnlyAccess`. `isLoggedIn$` is set from `loginStatus` in cookie mode (no token).
  Storage readiness/bootstrap keep keying off `isLoggedIn$`; profiles availability off `isUserSession`;
  write affordances off `canWriteUserData`. Unit 2 exposes only synchronous `authMode`.
- **Storage routing decoupled from `useSharedConfig` (R12).** A resolved "use server storage" signal
  (true in cookie mode) re-keys the `settings.service` write branches and `startup()` load, the
  `app-initNetwork` remote-profile gates, and `config.component.getActiveConfig()`. Without this,
  cookie auth engages while config persists to localStorage (the pass-2 split-brain).
- **Three carriers branch on mode, not two:** the HTTP interceptor (`withCredentials`, no header),
  the WS (`&token=`), and the Freeboard-SK iframe (`?token=`). All branch on **mode first** and
  suppress any stored token in cookie mode. The iframe `src` is built from `window.location.origin`
  in cookie mode (proxy leaves `signalKUrl` cross-origin), else the cookie won't flow.
- **WS (re)connect in cookie mode is driven by `isLoggedIn$` transition**, not `authToken$` change
  (dead in cookie mode), reusing the existing `isFullyConnected()` guard to avoid a double-connect
  with the bootstrap's `startWebSocketConnection()`. A WS drop in cookie mode triggers a
  `loginStatus` re-check.
- **Stale-token suppression gated in the constructor.** The synchronous `authMode` gates the
  constructor's stored-token load: in cookie mode the device-token re-emit is skipped (keep
  `authToken$` null) rather than emit-then-clear, so early subscribers never latch a token.
  Same-origin device-token installs are not stranded — a device token is only dropped once a cookie
  session is actually obtainable.
- **Redirect safety is normative.** Validate the redirect-back target relative-only (single leading
  `/`, reject `//`, backslashes, control chars < 32, scheme, host, self-route login paths). Param is
  SK's `returnTo` (verify on v2.27.0). A reload-surviving sessionStorage budget caps attempts (kiosk
  + `oidcAutoLogin` defeats a single-shot guard), **resets on a confirmed `loginStatus==='loggedIn'`**,
  and is **bypassed by an explicit user Sign-in click**. The recovery screen's manual Sign in uses
  `noAutoLogin=true` so SK does not auto-bounce it.
- **CSRF is a gating check (R10), not just recorded.** The deploy-time test must confirm a cross-site
  forged profile/applicationData write is actually blocked. If SK enforces neither Origin/Referer nor
  a non-permissive SameSite on state-changing calls, this re-plans a client-side defense rather than
  silently accepting it.
- **No reliance on `auth/validate`** (404). Cookie lifetime owned by SK/Authelia; token mode (cross
  -origin only now) re-prompts on expiry.
- **`loginPassword` kept transient (in-memory), never persisted.** Cross-origin login collects it and
  passes it to `login()` in-memory.
- **Accepted residual:** token mode (cross-origin standalone + device-token) retains JWT-in
  -`localStorage` and WS `&token=` because cookies cannot cross origin; the GHSA exposure is bounded
  to cross-origin installs, not eliminated.

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

### Auth mode decision matrix

Detection is origin-first; the manual flags do not gate cookie mode. `useDeviceToken =
!useSharedConfig` is enforced by existing code, so they are one "cross-origin intent" axis.

| Effective origin vs app | loginStatus | Mode | Mechanism |
|---|---|---|---|
| same origin | authRequired, logged-in, write | **cookie (write)** | cookie auth (REST + WS + origin-correct iframe); server-side shared config; profiles + writes |
| same origin | authRequired, logged-in, read-only | **cookie (read-only)** | cookie auth; `canWriteUserData` false → write controls disabled with explanation |
| same origin | authRequired, not logged in | **cookie → redirect** | loginStatus-driven redirect (`returnTo`, budget-guarded, `noAutoLogin` on recovery) |
| same origin | auth not required | anonymous read (Unit 6 owns) | no auth; no redirect; "Connected (no sign-in required)"; profiles unavailable |
| cross origin, useSharedConfig true | — | user-token | form → JWT (header + `&token=`) — unchanged, minus plaintext password |
| cross origin, useSharedConfig false | — | device-token / local-only | stored device JWT if present, else local-only — unchanged |

### Cookie-mode bootstrap + SSO

```mermaid
sequenceDiagram
  participant KIP as KIP (APP_INITIALIZER)
  participant SK as Signal K server (same origin)
  participant IdP as Authelia (OIDC)

  Note over KIP: mode candidate = same effective origin (sync, pre-discovery)
  KIP->>SK: GET /signalk/ (discovery, withCredentials; unauthenticated, cookie harmless)
  KIP->>SK: GET /skServer/loginStatus (withCredentials)
  alt loggedIn (write or read-only per readOnlyAccess)
    SK-->>KIP: {loggedIn, userLevel, readOnlyAccess}
    KIP->>KIP: isLoggedIn$=true (no token); isUserSession=true; canWriteUserData=!readOnly; storage ready
    KIP->>SK: applicationData + WS + iframe (cookie carries auth)
  else notLoggedIn AND authenticationRequired
    SK-->>KIP: {notLoggedIn, oidcEnabled, oidcAutoLogin, oidcLoginUrl}
    KIP->>KIP: "Signing in via SSO…"; check budget
    KIP->>SK: redirect to oidcLoginUrl?returnTo=<relative-validated> (budget-guarded)
    SK->>IdP: auth-code + PKCE
    IdP-->>SK: callback -> sets JAUTHENTICATION cookie
    SK-->>KIP: redirect back; loginStatus -> loggedIn (budget reset)
  else notLoggedIn AND NOT authenticationRequired
    KIP->>KIP: anonymous read; "Connected (no sign-in required)"; no redirect
  else budget exhausted OR auth declined/cancelled
    KIP->>KIP: auth-blocked screen (per-cause copy; manual Sign in uses noAutoLogin; Connectivity link)
  end
```

## Open Questions

### Resolved during planning / review

- **Mode activation** — auto-detect, no toggle. Two-stage origin-first detection, decoupled from
  `useSharedConfig` for both auth and storage.
- **Same-origin detection** — compare the **effective** request origin (accounts for `proxyEnabled`
  + port) to `window.location.origin`. Synchronous, pre-discovery.
- **Profiles sequencing** — paused; this plan owns the cookie-mode availability/write fix (Unit 8),
  landing in the profiles rebase. The auth-merge window is benign (profiles not on master).
- **Sign-out** — cut (known shared-display limitation noted).
- **`loginStatus` base** — `new URL(effectiveOrigin).origin + '/skServer/loginStatus'`, synchronous.
- **`auth/validate`** — 404; token mode re-prompts on expiry.
- **`loginPassword`** — transient in-memory, never persisted.
- **`connectionConfig` version** — stay 12; idempotent purge.
- **`isUserSession`/`canWriteUserData`** — owned by Unit 3; profiles use the booleans, no username.
- **Read-only sessions** — captured via `loginStatus.readOnlyAccess`; write affordances gated.

### Deferred to implementation (deploy-time; not exercisable by `ng serve`)

- **WS / Freeboard-iframe cookie handshake** — confirm the same-origin upgrade/iframe authenticate
  via cookie with no token param.
- **withCredentials on discovery/loginStatus** — re-verify the already-probed GETs behave the same
  with `withCredentials`; for `proxyEnabled` + cross-origin `signalKUrl`, the discovery GET is cross
  -origin-with-credentials and depends on SK CORS allow-credentials.
- **OIDC redirect round-trip** — confirm the `returnTo` param name on v2.27.0 and that the callback
  returns to KIP at `:4430` without a loop.
- **CSRF / SameSite** — record the JAUTHENTICATION SameSite attribute, confirm a cross-site forged
  write is blocked, and that KIP's writes succeed (R10 gating check).
- **`userLevel`/`readOnlyAccess` values** — confirm the exact value set on v2.27.0 that maps to read
  -only so the write-gating is correct.
- **401 mid-session** — confirm the status/shape SK returns when the cookie expires (401 vs
  302-to-HTML) and that the no-reload re-check path re-establishes the WS.
- **Kiosk reload type** — confirm HaLOS displays reload in-page (sessionStorage budget survives) vs
  process-restart (budget resets each boot).

## Implementation Units

- [x] **Unit 1: Stop persisting the login password; fix the bootstrap gate**

**Goal:** Remove plaintext `loginPassword` persistence; keep it transient; ensure the bootstrap login
gate does not silently route every shared-config user to `/login` once the password is gone.

**Requirements:** R6 — **Dependencies:** None (independently shippable security fix).

**Approach (Option A — JWT becomes the persisted credential):** Implementation revealed the persisted
password is load-bearing for post-login: login stores a JWT then `reloadApp()`, and the constructor
*deletes* the user-session token on startup, so today the persisted password is what re-establishes
the session after reload. Removing the password without changing that would loop login→reload→login.
Fix: the constructor **keeps an unexpired user-session token** (mirroring device tokens), so the
expiring JWT — not the plaintext password — is the cross-reload credential (strictly more secure;
consistent with the token-mode accepted-residual). `connectToServer` must do an **in-memory
`auth.login()` before reload** (it currently relies on the persisted password + bootstrap re-login);
`widget-login`'s `serverLogin` already logs in in-memory. `app-initNetwork`'s password-gated bootstrap
login then self-disables (password never persisted) and needs no change. Tradeoff: a user JWT now
persists across browser restarts until expiry (session-residue on shared displays — same class as the
cookie-mode sign-out limitation).

**Files:** Modify `authentication.service.ts` (constructor keeps unexpired user token; renewal drops
stored-password re-login → `deleteToken()` on user-token expiry), `settings.service.ts`
(`buildConnectionStorageObject` excludes `loginPassword`; idempotent purge on load; no version bump),
`interfaces/app-settings.interfaces.ts` (`loginPassword` optional/transient),
`options/signalk/signalk.component.ts` (`connectToServer` logs in in-memory before reload). No change
needed in `app-initNetwork.service.ts` (login gate self-disables) or `widget-login.component.ts`
(already in-memory; prefill is now empty, expected). Test: `authentication.service.spec.ts`,
`settings.service.spec.ts`.

**Test scenarios:** serialized config has no `loginPassword`; legacy config with `loginPassword` is
stripped and re-persisted (no version change); renewal with no stored password/cookie does not POST
credentials and routes to re-login; a transient password completes a login without being persisted.

**Verification:** suites green; no password in persisted config; renewal references no stored password.

- [x] **Unit 2: Auth mode detection + constructor token suppression**

**Goal:** Synchronous origin-first `authMode` (pre-discovery); skip the constructor device-token
re-emit in cookie mode; conditional device-token clearing.

**Requirements:** R5, R7 — **Dependencies:** None (consumed by Units 3–8).

**Files:** Modify `authentication.service.ts` (synchronous `authMode` from a `connectionConfig` read;
`effectiveOriginIsSameAsApp` covering `proxyEnabled` + port; constructor skips device-token re-emit in
cookie mode; device token dropped only once a cookie session is obtainable). Test:
`authentication.service.spec.ts`.

**Approach:** `authMode` must be synchronous so the interceptor is in cookie mode for the very first
discovery GET. Unit 2 does **not** compute `isUserSession`/`canWriteUserData` (those need loginStatus
— Unit 3).

**Test scenarios:** empty/same-origin `signalKUrl` + auth-requiring → cookie candidate; cross-origin
`signalKUrl` → token; `proxyEnabled` + cross-origin `signalKUrl` → cookie candidate; same host
different port → per the effective-origin rule (define + test); stored device token + cookie candidate
→ not re-emitted, `authToken$` null; same-origin device-token install with no cookie session →
device token retained (not stranded).

**Verification:** matrix candidates covered; no token latched by early subscribers in cookie mode.

- [x] **Unit 3: loginStatus session state — isLoggedIn$, isUserSession, canWriteUserData**

**Goal:** In cookie mode, derive session state from `GET /skServer/loginStatus` (credentialed),
capturing `readOnlyAccess`/OIDC descriptors; fail closed.

**Requirements:** R2, R3, R13 — **Dependencies:** Unit 2.

**Files:** Modify `authentication.service.ts` (loginStatus query; base from effective origin,
synchronous, not the `/signalk/v1` base; set `isLoggedIn$`; own `isUserSession` and `canWriteUserData`;
capture `oidcEnabled`/`oidcAutoLogin`/`oidcLoginUrl`/`authenticationRequired`/`readOnlyAccess`). Test:
`authentication.service.spec.ts`.

**Approach:** `isLoggedIn$` true **only** on parsed `status==='loggedIn'`; any error, timeout, non
-JSON, or unexpected shape → not-logged-in. `canWriteUserData` = logged-in AND not `readOnlyAccess`.
Pick a consistent shape (Observable/signal) for the session signals so Units 6/7/8 consume uniformly.

**Test scenarios:** `loggedIn` write → `isLoggedIn$`/`isUserSession`/`canWriteUserData` true, no
token; `loggedIn` + `readOnlyAccess` → `isUserSession` true, `canWriteUserData` false; `notLoggedIn` →
all false, OIDC descriptors captured; unreachable/non-JSON/unexpected → not-logged-in, no throw; token
mode does not call loginStatus.

**Verification:** suite green; session state + write-capability reflect loginStatus, fail-closed.

- [ ] **Unit 4: Credential carriage — interceptor, WS, Freeboard iframe**

**Goal:** Carry the session cookie on all three same-origin carriers; suppress token params in cookie
mode; drive WS reconnect off session state.

**Requirements:** R4 — **Dependencies:** Units 2, 3.

**Files:** Modify `authentication-interceptor.ts` (branch on **mode first**: cookie →
`withCredentials`, no header, even with a token present), `signalk-delta.service.ts` (cookie → omit
`&token=`; add an `isLoggedIn$`-transition (re)connect reusing the `isFullyConnected()` guard; WS drop
→ loginStatus re-check), `widgets/widget-freeboardsk/widget-freeboardsk.component.ts` (cookie → build
`src` from `window.location.origin`, no `?token=`). Test: `authentication-interceptor.spec.ts`,
`signalk-delta.service.spec.ts` (extend existing).

**Test scenarios:** cookie request → `withCredentials`, no header; token request → header, no
`withCredentials`; cookie request with a stored token → still no header (mode wins); WS URL omits
`token=` in cookie mode; iframe `src` host == `window.location.origin` in cookie mode (incl.
`proxyEnabled` + cross-origin `signalKUrl`); `isLoggedIn$`→true triggers one WS connect, no
double-connect during bootstrap.

**Verification:** suites green; deploy-time test confirms live cookie on REST, WS, iframe.

- [ ] **Unit 5: Decouple config-storage routing from `useSharedConfig`**

**Goal:** Make config persistence honor cookie mode (server storage) independent of the stored
`useSharedConfig` flag — the pass-2 split-brain fix.

**Requirements:** R12 — **Dependencies:** Units 2, 3.

**Files:** Modify `settings.service.ts` (introduce an effective "use server storage" signal from
resolved cookie mode; re-key the 16 `if (useSharedConfig)` write branches and the `startup()` shared
-vs-local load), `app-initNetwork.service.ts` (remote-profile bootstrap gate keys off the effective
signal, not raw `useSharedConfig`), and the profiles `config.component.getActiveConfig()` (rebase-time,
keys off the effective signal). Test: `settings.service.spec.ts`.

**Approach:** the effective storage signal is true whenever resolved cookie mode is active. Keep
`useSharedConfig` semantics for cross-origin. Storage readiness already keys off `isLoggedIn$`, so the
profile CRUD engine and the settings persistence engine now agree in cookie mode.

**Test scenarios:** cookie mode + `useSharedConfig=false` → writes route to server applicationData,
`startup()` loads remote; cross-origin `useSharedConfig=true` → server storage (unchanged); cross
-origin `useSharedConfig=false` → localStorage (unchanged); a theme/dashboard edit in cookie mode
persists to the server slot and reloads from it.

**Verification:** in cookie mode, settings + profile CRUD both target the server; no localStorage
split-brain.

- [ ] **Unit 6: Bootstrap rework + redirect (safety + transitional/recovery UI)**

**Goal:** Cookie-mode bootstrap uses loginStatus; replaces `/login` navigations with a validated,
budget-guarded SSO redirect; handles the anonymous-read branch; shows transitional and per-cause
recovery states.

**Requirements:** R1, R3, R9, R11 — **Dependencies:** Units 2, 3, 4, 5.

**Files:** Modify `app-initNetwork.service.ts` (cookie branch: skip credential login; use loginStatus;
logged-in → storage bootstrap; not-logged-in + authRequired → redirect; not-logged-in + auth NOT
required → anonymous-read ready, no redirect; convert all three `/login` navigations). Create/modify a
redirect helper (relative-only validation incl. control chars + self-route; `returnTo` param;
`noAutoLogin` on recovery; reload-surviving budget that resets on success and is bypassed by explicit
Sign in). Modify bootstrap/route presentation for the "Signing in via SSO…" transitional state and the
auth-blocked screen with **per-cause** copy/actions (unreachable → Retry; budget-exhausted → reset-on
-click Sign in; cancelled → Sign in). Test: `app-initNetwork.service.spec.ts`.

**Approach:** budget guard survives reloads; manual Sign in is user-initiated (not the auto-loop).
Anonymous-read proceeds read-only with no Sign-in dead-end.

**Test scenarios:** cookie logged-in → ready, storage bootstraps; cookie not-logged-in + oidcAutoLogin
→ one redirect with a validated relative `returnTo`; returned still notLoggedIn within budget → no
immediate re-redirect; budget exhausted across reloads → auth-blocked screen, manual Sign in resets
budget + uses `noAutoLogin`; redirect param with `//`/scheme/host/control-char → rejected; auth-not
-required same-origin → anonymous-read ready, no redirect; token mode unchanged.

**Verification:** suite green; deploy-time SSO round-trip returns logged in without loop.

- [ ] **Unit 7: `/login` route + Connectivity tab UX**

**Goal:** Same-origin entry points redirect to SK login (transitional state) instead of the dialog;
cross-origin keeps the dialog. Connectivity tab shows session identity, read-only state, anonymous
state, loading states; no password field; no sign-out; no mode-explainer label.

**Requirements:** R1, R5, R11, R13 — **Dependencies:** Units 2, 3, 6.

**Files:** Modify `widget-login/widget-login.component.ts` (cookie → render "Signing in via SSO…" and
redirect, **not** the dialog in `ngOnInit`; standalone → existing dialog), `options/signalk/signalk.component.ts`
(cookie → no password field; identity block: logged-in shows provider name + read/write level,
read-only disables write controls with explanation, not-logged-in shows Sign in, anonymous shows
"Connected (no sign-in required)", in-flight shows a loading affordance, unreachable shows a connection
error not a Sign-in CTA; extend `connectToServer` to clear a stored token when the new config resolves
to cookie mode). Use aria-live + focus management on transitional/blocked screens. Test:
`widget-login/login.component.spec.ts`, `signalk.component.spec.ts` (extend/create).

**Test scenarios:** cookie `/login` → redirect (transitional), not the dialog; token `/login` → dialog;
cookie Connectivity has no password field; read-only session → write controls disabled with
explanation; anonymous → "Connected" identity, no dead-end Sign in; loginStatus in-flight → loading,
not "Not signed in"; editing `signalKUrl` to flip mode clears stored auth on reload.

**Verification:** suites green; deploy-time visual check of same-origin UX, read-only, and transitional
states.

- [ ] **Unit 8: Profiles availability + write-gating in cookie mode (cross-branch follow-on)**

**Goal:** Make profiles visible and writable in cookie mode by keying availability off `isUserSession`
and write actions off `canWriteUserData`. **Not a same-branch unit** — these files exist only on
`named_configs`; this lands during the profiles rebase onto merged auth and is owned by this plan's
definition of done. The auth merge alone does not satisfy R8.

**Requirements:** R8, R13 — **Dependencies:** Unit 3 (`isUserSession`/`canWriteUserData`), applied at
rebase.

**Files (on rebased `named_configs`):** `options/configuration/config.component.ts` (`profilesAvailable`
keys off `isUserSession`; write actions gated on `canWriteUserData`), `profile.service.ts` (scope
selection works under a cookie session), `config.component.getActiveConfig()` (Unit 5 effective-storage
signal). Test: `config.component.spec.ts`, `profile.service.spec.ts` (update mocks).

**Test scenarios:** cookie write session → profiles available + writable; cookie read-only session →
profiles visible, write controls disabled (no silent 403); cookie not-logged-in → unavailable; device
-token → unavailable; cross-origin user-token → available.

**Verification:** on the rebased branch, a cookie-mode write-capable SSO user sees and **writes**
profiles (deploy-time acceptance — the prerequisite's success gate). The auth-to-master merge is not
"done" until this rebase lands and the check passes; if it slips, auth ships as a security+SSO
improvement with the prerequisite explicitly marked unproven.

- [ ] **Unit 9: Documentation, design doc, changelog, deploy-time acceptance test**

**Goal:** Document dual-mode auth and record the design + verification.

**Requirements:** R6, R10, R11 — **Dependencies:** Units 1–8.

**Files:** Create `docs/signalk-auth-plan.md` (this plan, moved from `_local/`); modify KIP help
content; modify `CHANGELOG.md` / release notes (call out password-storage removal **and** that cross
-origin shared-config users now re-login on expiry / on each reload, not just "on expiry").

**Approach:** the deploy-time acceptance test (build locally, deploy to the device webapp dir; never
build on device) covers: loginStatus drives state; redirect triggers OIDC and returns without loop;
cookie authenticates REST + WS + Freeboard iframe with no token; **CSRF forged-write is blocked
(R10)**; read-only session disables writes; cookie mode persists config to the server slot (Unit 5);
profiles (post-rebase) read/write user scope.

**Test scenarios:** `Test expectation: none — documentation only.`

**Verification:** help reflects dual-mode; design doc on the branch; acceptance checklist run.

## System-Wide Impact

- **Interaction graph:** `AuthenticationService` (mode + session signals) feeds the interceptor, the
  WS delta service, the Freeboard iframe, `StorageService` readiness, `AppNetworkInitService`
  bootstrap, `SettingsService` storage routing, and (post-rebase) profiles. `isLoggedIn$`,
  `isUserSession`, `canWriteUserData` are authoritative.
- **Error propagation:** cookie 401 → loginStatus re-check → budget-guarded redirect or auth-blocked
  screen; loginStatus unreachable/malformed → fail-closed not-logged-in. Token-mode 401 unchanged.
- **State lifecycle:** stale token (user/device) suppressed in cookie mode at construction; config
  -change normalizes auth state; redirect budget resets on success.
- **API surface parity:** REST (interceptor), WS (`&token=`), and the Freeboard iframe (`?token=`,
  origin-correct) all carry the cookie in cookie mode.
- **Storage parity:** `settings.service` write branches, `startup()` load, `app-initNetwork` gates,
  and `config.component.getActiveConfig()` all key off the effective storage signal in cookie mode
  (Unit 5) — not raw `useSharedConfig`.
- **Integration coverage:** the live cookie round-trip (REST + WS + iframe + SSO redirect + CSRF +
  read-only) is only provable with a deployed build + OIDC login (Unit 9).
- **Unchanged invariants:** local-only mode, device-token plumbing, user-scope `applicationData`
  paths (server-side scope), and the `connectionConfig` schema version (stays 12).

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Storage routing not fully decoupled (split-brain) | Med | High | Unit 5 re-keys all 16 branches + startup + bootstrap + getActiveConfig; deploy test persists to server slot |
| Read-only session shows editable profiles that 403 | Med | High | `canWriteUserData` gates write affordances (Unit 3/7/8); read-only test scenarios |
| WS / iframe cookie handshake fails same-origin | Low | High | Deploy test early; iframe `src` origin-correct; fallback (short-lived token) is a re-plan, not in scope |
| Freeboard iframe cross-origin under proxy | Med | High | Build iframe `src` from `window.location.origin` in cookie mode (Unit 4) |
| Redirect loop across reloads (kiosk + oidcAutoLogin) | Med | High | Reload-surviving budget + `noAutoLogin` recovery + reset-on-success (Unit 6, R9) |
| Open redirect via `returnTo` | Low | High | Relative-only validation incl. control chars + self-route (Unit 6, R9) |
| CSRF on cookie-authenticated writes | Med | Med | Gating deploy check (R10): forged write must be blocked; else re-plan a token |
| Same-origin device-token install stranded | Low | Med | Drop device token only once a cookie session is obtainable (Unit 2) |
| Profiles unproven until rebase | Med | Med | Unit 8 owned by this plan's DoD; window benign (profiles not on master) |
| Token-mode re-login on expiry/reload (no auth/validate) | High (by design) | Med | Cross-origin only now; CHANGELOG calls out reload re-login too (Unit 9) |
| Same-origin password-only users lose in-app modal | Med | Med | Accepted: admin-login redirect is SK's own pattern; minority vs OIDC target |
| Version collision with `named_configs` v13 | Low | Med | Stay v12; Unit 1/5 edits overlap the v13 migration — reconcile in one rebase pass |
| Upstream rejects auto-detect default | Med | Med | Chosen deliberately; fallback is default-on toggle, not a redesign |

## Alternative Approaches Considered

- **Explicit mode toggle (default on for same-origin).** More upstreamable/legible, but the user chose
  auto-detect, no toggle. If upstream rejects auto-detect, the fallback is the default-on toggle.
- **Thin redirect-only (keep token machinery).** Risks a JWT-after-cookie-redirect inconsistent state.
- **Proxy-layer ForwardAuth.** SK does not trust forwarded identity; KIP stays unauthenticated to the
  API and profiles break.
- **Keep the custom form, fix only the password.** Does not solve the OIDC dead-end. Password fix kept
  (Unit 1) but insufficient alone.
- **Decouple profiles and ship for password-users now.** User chose to keep profiles paused with this
  plan owning the cookie-mode fix (Unit 8).

## Phased Delivery

- **Phase A (independently shippable):** Unit 1 — password removal + bootstrap-gate fix.
- **Phase B (the feature):** Units 2–7 — auto-detected cookie mode, carriage, storage decouple,
  bootstrap/redirect, UX.
- **Phase C:** Unit 9 — docs + deploy-time acceptance test on halosdev.
- **Profiles rebase:** Unit 8 lands when `named_configs` rebases onto merged auth; the cookie-mode
  profiles read/write check is the prerequisite's success gate. The auth merge is not "done" until
  this passes (or the prerequisite is explicitly marked unproven if the rebase slips).

## Documentation / Operational Notes

- Deploy-time acceptance test (build locally, deploy to the device's SK webapp dir — never build on
  device): served same-origin; loginStatus drives state (incl. read-only); redirect triggers OIDC and
  returns without loop; cookie authenticates REST + WS + iframe with no token; CSRF forged write
  blocked; config persists to the server slot; profiles (post-rebase) read/write user scope.
- `ng serve` (cross-origin `localhost:4200`) exercises token mode and all unit-level mode logic but
  not the live cookie path.

## Sources & References

- Related plan (rebases on top, hosts Unit 8): `docs/named-configs-plan.md`
- Key code: `authentication.service.ts`, `app-initNetwork.service.ts`, `authentication-interceptor.ts`,
  `signalk-delta.service.ts`, `signalk-connection.service.ts`, `storage.service.ts`,
  `settings.service.ts`, `widget-login.component.ts`, `widget-freeboardsk.component.ts`,
  `options/signalk/signalk.component.ts`, `options/configuration/config.component.ts` (profiles)
- SK docs: webapps auth, security spec, `loginRedirect.ts`, OIDC docs (`returnTo`/`noAutoLogin`)
- Advisory: GHSA-fq56-hvg6-wvm5
