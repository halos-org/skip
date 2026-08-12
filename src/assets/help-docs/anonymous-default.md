## Read-Only Access Without Signing In

Skip normally keeps your pages, layouts and theme on the Signal K server under your own user account. A visitor with no account and no session is a third case: on a server that allows it, Skip shows them a dashboard instead of a sign-in page, and refuses every change they try to make.

This is how a public or demonstration server offers a working display to anyone who opens it, and how a boat's own display keeps showing instruments while the sign-in service is unavailable.

## What the Server Must Allow

Two settings on the Signal K server decide whether an anonymous visitor sees a dashboard.

**Read-only access must be enabled.** In the Signal K admin, open **Security > Settings** and turn on **Allow Readonly Access**. Without it the server refuses every request from a visitor with no session, including the one Skip uses to fetch the shared dashboard.

**Automatic SSO login must be off.** A server configured to sign users in automatically (`SIGNALK_OIDC_AUTO_LOGIN=true`) is telling Skip that everyone is meant to have an account, so Skip sends the visitor to the login page rather than showing them the shared dashboard. Leave auto-login off if you want anonymous visitors to see instruments.

With both in place, a visitor with no session gets the shared dashboard, a **Not signed in — reading shared data** notice, and a **Sign in** button in the Connection panel.

## Publishing the Shared Dashboard

Anonymous visitors read one configuration: a slot named `default` in the server's **global** application-data scope. Skip never writes it — no button in the app publishes a dashboard there, deliberately, since anything that could write it from a browser session could also overwrite it from one. You put it there yourself, as a server administrator.

Until you do, an anonymous visitor sees the pages Skip ships with, which is a reasonable starting point but knows nothing about your vessel.

### 1. Build the dashboard

Sign in to Skip as an ordinary user and arrange the pages you want visitors to see. Anything that needs a signed-in session to work — remote control of another display, for instance — is worth leaving out.

### 2. Export it

Open **Menu > Settings > Configurations > Advanced** and press **Download**. You get a `SkipConfig.json` file holding the active profile's pages, layout and theme. That file is exactly the shape the shared slot expects.

### 3. Upload it to the global scope

Writing to the global scope requires a Signal K **admin** account. Reading it does not, which is what lets an anonymous visitor fetch it.

```bash
SERVER=https://your-server:3000

# Obtain an admin session token. Enter your own admin credentials here.
TOKEN=$(curl -s -X POST "$SERVER/signalk/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}' | jq -r .token)

# Publish the dashboard.
curl -s -X POST "$SERVER/signalk/v1/applicationData/global/skip/11/default" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @SkipConfig.json
```

Every segment of that URL is fixed, and all four have to match or Skip will not find what you published:

| Segment | Value | Meaning |
|---|---|---|
| `global` | `global` | The shared scope. The `user` scope holds per-account profiles instead. |
| `skip` | `skip` | Skip's application id on the server. |
| `11` | `11` | The storage file version Skip reads. |
| `default` | `default` | The slot name an anonymous session loads. |

### 4. Check it

Fetch it back without any credentials. This is the request an anonymous visitor's browser makes:

```bash
curl -is "$SERVER/signalk/v1/applicationData/global/skip/11/default"
```

A published slot answers `200` with the JSON you uploaded. One that was never published answers `404` with an empty body — so a 404 here means nothing is at that URL, not that your request was malformed. Check the URL before suspecting the file.

Then open Skip in a private browser window and confirm you land on your pages without being asked to sign in.

## What an Anonymous Visitor Cannot Do

The session is read-only throughout, not merely undecorated:

- Nothing is saved. Page and layout changes are refused outright; a setting that would normally autosave is dropped instead, since the session has nowhere to put it.
- The layout stays locked, and the page-management and edit controls are hidden rather than shown and inert.
- Profiles are unavailable. They live under a user account, so a `?profile=` link is ignored with a warning rather than honoured.

A visitor who signs in gets their own profile and full write access. The shared dashboard is never written back to their account.

## Keeping It Current

The published dashboard is a snapshot. Skip's configuration format changes between releases, and an older published config still renders — Skip warns in the browser console naming its version and the current one, and shows it unmigrated.

Republish after a Skip upgrade that reports the mismatch: download the profile again from a current Skip and repeat step 3. There is no automatic migration of the shared slot, because a read-only session must not write anything, including a migration of the configuration it just read.
