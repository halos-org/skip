## Configuration Management

Skip keeps your setup in two separate places:

- **Connection settings** (Signal K server URL and connection options) are always stored **on this device**, in the browser. They are never shared between devices.
- **Application configuration** (pages, widgets, layouts, and theme) is stored **on the Signal K server**, tied to your Signal K user account, so it follows you to any device where you sign in as the same user.

## Signing In

Skip signs in through your Signal K server's session (single sign-on). It **never asks you for a Signal K username or password directly** and never stores credentials — the sign-in happens on the server, and Skip only holds the resulting session.

Open **Settings > Connectivity**:

- If the server requires sign-in and you are not signed in yet, a **Sign in** button appears. It sends you to the Signal K server's login and returns you to Skip once you are authenticated.
- When signed in, the Connectivity tab shows the account you are signed in as.
- If your account has read-only access, Skip shows a **Read-only access** notice and configuration changes are disabled.
- If your Signal K server does not require authentication, Skip connects without signing in.

Application configuration is stored on the server under a Signal K user account. Without a signed-in user account, profile management and server-stored configuration are unavailable, and Skip runs with connection settings only.

## Creating a Signal K User

To sign in, your Signal K server needs a user account. To create one:

1. In the Signal K server admin, open the **Security > Users** menu.
2. Click **Add** to create a new user.
3. Provide a **User ID** and **Password**.
4. Assign **Read/Write** permissions so the account can store configuration. A **Read-only** account can view configuration but not change it.
5. Click **Apply** to save the new user.

Then sign in to that account from Skip via **Settings > Connectivity > Sign in**.

## Profiles

A **profile** is a named set of pages, layouts, and theme, stored under your Signal K user account. Profiles let a single account keep several independent setups — for example one per station, role, or device form factor. Each device remembers which profile it is showing, so different displays signed in as the same user can each show a different profile.

Manage profiles in **Settings > Configurations**:

- **New** — create a new profile.
- **Switch** — show a different profile on this device.
- **Rename** / **Duplicate** — rename a profile or copy it (including its configuration).
- **Delete** — remove a profile. You cannot delete the active profile or the `default` profile.

Profile changes require a read/write session; they are disabled when you are signed in with a read-only account.

## Sharing Configuration Between Devices

Because application configuration lives on the server under your Signal K user account, signing in as the **same** user on another device gives you the same profiles automatically — this is how configuration is shared across devices.

To keep devices independent, either sign in with **different** Signal K users, or switch each device to a different profile.

## Backup, Import, and Reset

The **Advanced** section of **Settings > Configurations** provides:

- **Download** — save the active profile's configuration to a file, for backup or to move it to another Signal K server.
- **Import** — load a configuration file as a **new profile**. This never overwrites an existing profile.
- **Default** — reset the active profile to a single Getting Started widget. Your connection settings are kept.
- **Connection** — clear the Connectivity settings only; this does not affect your profiles.

Use these operations with care: they change your active configuration in real time and cannot be undone.
