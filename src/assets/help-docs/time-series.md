## Historical Widget Data

Skip is primarily designed for live sailing data, but most numeric widgets can also show recent history — both as a pop-up history plot you open from a widget and as startup seeding for plot widgets, so they show recent trends immediately instead of starting empty.

History is served by an external **Signal K History API provider** — a server plugin such as `signalk-to-influxdb2` or `signalk-parquet`. Skip does not record or store data itself; it reads history from whatever provider your Signal K server runs. When no provider is available, Skip shows live data only, starting from when a widget was opened.

See [History-API Provider](#/help/history-api.md) in the Integrations help menu for how to install and configure a provider.

## What Skip Does With History
- Pre-seeds Realtime Data Plot and Wind Trends so they show recent trends immediately on open.
- Provides a pop-up historical view for numeric-value widgets on your pages.

The detail and time span available depend entirely on what your provider has recorded and how it is configured.

## Accessing the History Plot
On a **locked page** (normal viewing mode), **press and hold (long-press)** a numeric value widget to open its pop-up history plot directly — no edit mode, no menu. This is the only way to open it; interactive widgets keep single-tap for their own control, so long-press is the history gesture there too.

The pop-up plot displays recorded data only (no live-stream overlay), across a fixed set of time windows: the last 15 minutes, 1 hour, 8 hours, or 24 hours. For more flexible analytics, use a purpose-built platform such as Grafana.

## Supported Widgets
Most widgets that use numeric paths support history, including Horizon, Battery Monitor, Solar, and similar numeric-based widgets. Plot widgets seed from history according to their configuration:

#### Realtime Data Plot Widget
- **Supported:** Yes, seeded with history data.
- **Requirements:** Time scale must be minutes or longer.

#### Wind Trends Widget
- **Supported:** Yes, seeded with history data.
- **Requirements:** Time span of `5 minutes` or `30 minutes`.

#### Numeric Widget's Mini Plot
- **Supported:** No. Mini plots use very short time windows (12 seconds) and skip history seeding.
- Mini plots start live-only for performance reasons.

## Requirements
- Signal K v2.22.1+: the history query service uses History API v2, introduced in Signal K v2.22.1.
- A History API provider plugin installed and configured on your Signal K server (see [History-API Provider](#/help/history-api.md)).

## Questions or Issues?
- Refer to [History-API Provider](#/help/history-api.md) to install and configure a provider.
- For general questions or issues, see the Contact-Us help page. The Signal K community is active on Discord and GitHub.
