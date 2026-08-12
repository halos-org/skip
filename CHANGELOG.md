# Unreleased
## New Features
* Read-only access without signing in: on a Signal K server that grants anonymous read (`allow_readonly`) and does not auto-redirect to SSO, Skip now shows the instruments to a visitor with no session instead of sending them to a login page. The dashboard comes from the shared `default` slot in the server's global application-data scope when an operator has published one, and otherwise from the pages shipped with this release. The session is genuinely read-only — no configuration is saved, the layout stays locked, and the page-management and edit controls are hidden — with **Sign in** still offered from the Connection panel. A deployment configured to sign its users in automatically is unchanged; one that grants no anonymous read keeps its sign-in redirect.
* Freeboard-SK panel: Skip registers itself as a Freeboard-SK plotter extension, so a supporting Freeboard-SK shows a map-toolbar button that opens Skip in a side panel. The plugin manifest declares the host capabilities it needs (`requires: ['panels.iframe', 'buttons']`) and targets the map toolbar (`slot: 'mapToolbar'`), so only a Freeboard-SK build that provides those capabilities surfaces the button; the exact minimum Freeboard-SK version is confirmed at deploy. Delivered by the companion `@halos-org/skip-freeboard-panel` package (a runtime dependency of Skip), installed automatically alongside Skip and enabled by default.
* Freeboard-SK Wind Steer widget: the same plotter-extension plugin now also contributes the Wind Steer control as an always-on chart widget in small (1x1) and large (2x2) sizes, so a supporting Freeboard-SK can place it directly on the chart. Each widget iframe boots Skip chromeless on a single-widget route and renders the live Wind Steer against your own Signal K session. Long-press the tile to open Freeboard-SK's dialog, which offers the widget's **settings** and a **Remove** button; the settings reuse Skip's standard widget-options UI and persist per placement. Widget support is additive — the manifest does not require it, so a Freeboard-SK without widget support still gets the panel. Serves as a proof of concept for exposing other complex Skip controls as first-class Freeboard-SK widgets.
* Same-origin Signal K sign-in (SSO): when Skip is served by a Signal K server on the same origin, it authenticates with the server's session cookie instead of its own username/password form. With an OIDC/SSO server, Skip joins the existing session and redirects to the server login when needed — no second sign-in, and OIDC-provisioned users (who have no server-local password) can use Skip. Cross-origin standalone use (a PWA pointed at a remote server) keeps the existing token sign-in.
## Improvements
* Settings > Display > Toolbar adds **Show the toolbar automatically**. The toolbar normally slides down at startup and on every page change; turn this off on a display you only watch, and it appears only when you swipe down, scroll up, or tap the top peek strip. Fixes #495
* The Connectivity settings show your Signal K session identity in same-origin mode (including a read-only-session indicator) instead of a credential form.
* Security: the Signal K login password is no longer stored in the browser; it is used only in memory to obtain a session token.
* The Numeric and Linear widgets show the unit next to the widget name, on one row across the top of the tile, instead of spending a second row on it at the bottom. The reading gets that space: the Numeric widget's value is drawn larger, and the Linear gauge's bar and scale grow into the bands its title and unit used to occupy. A name too long for its share of the row is now shortened with an ellipsis instead of running into the unit.
* The Linear and Compact Linear widgets run the full length of their tile, and their bars line up with each other when the two sit side by side. Both used to hold a fixed shape, so a wide, short tile cut the bar's length to match its height and left most of the card empty on either side. For the Linear gauge that shape is now a limit on how thick the bar gets rather than how long it runs; the Compact Linear stretches to the tile's own proportions, down to the shape it is drawn at, below which a tall tile centres it as before.
## Fixes
* Signing in from Skip returns you to the page you were on, instead of leaving you on the Signal K admin screen. Skip named the return address in the redirect it sends to the login page, but under a parameter name the Signal K server does not read, so the server fell back to its own home page every time. Applies to both the SSO login and the server's own login page. Fixes #554
* Text and time fields inside a widget respond to touch again. The gesture recogniser that watches every widget for taps and long-presses was taking over the pointer as soon as you touched anything, including a form field — on iOS that stopped the field focusing at all, so tapping the Racer Timer's start-time input did nothing, or opened its picker for a fraction of a second before it closed. A gesture that starts on a field is now left alone, so the field focuses and its picker opens as it should.
* The Racer Timer's absolute start time works as intended. It now has a **Set** button: nothing is sent until you press it, whether you typed the time or picked it on a phone or tablet's time wheel. Previously it submitted whatever was in the field the moment the value looked complete, so typing 20:40 sent 20:04 halfway through. The field also blanked itself every few seconds while you were filling it in, because the widget overwrote it each time the server reported no start time. Setting a time no longer jumps to the countdown view before the race plugin has accepted it either, and says so if it refuses or does not answer.
* Button labels in the Race Timer, Racer Line and Autopilot widgets are legible and readable in every theme. They were drawn as SVG text inside a fixed box wider than the words, so they shrank to fit the empty space beside them rather than the button, and they took the theme's normal text colour even though they sit on a coloured button — which meant dark text on a dark blue or red button in the light theme, and in night mode a label the exact colour of the button behind it, so it was invisible. Every button in these widgets, and in the Racer Timer, now meets the WCAG AA contrast bar in the light, dark and night themes. The Autopilot's two Tack buttons also say which way they tack, where before they were told apart only by a small arc.
* Every button in the racing and autopilot widgets has a name for screen readers. The labels sat inside an element the accessibility tree ignores, so assistive technology saw a row of unlabelled buttons.
* Skip no longer fails to start in a browser that denies it local storage. Private-mode Safari and Firefox throw when a site so much as looks at local storage, which Skip did while saving its connection settings — with no way to recover. Storage that is unavailable is now treated as empty: your connection settings fall back to defaults, and everything else, which lives on the Signal K server, loads as usual. Fixes #502
* Racer Timer controls are legible again. The button labels were drawn as SVG text inside a fixed viewBox far wider than the words, so they were scaled down to fit the empty space rather than the button — on a 2x2 tile they rendered at 17px in a 44px button, and on a 1x1 tile at roughly 1px. Labels are now ordinary text sized against each control's own box, so they fill the buttons, stay the same size when you cycle modes, grow with the tile, and no longer get cut off on a tile that is taller than it is wide. The absolute start-time field was drawn with the theme's text colour as its background, making it black-on-black in the light theme; it now sits on the widget's own surface with the theme's text colour and matches the buttons' height and corner radius. That field also showed nothing at all wherever the system clock format is not 24-hour with colons — a Finnish or US locale left it blank — and clearing it silently failed instead of being ignored; both are fixed. Every control has an accessible name now, where before the labels sat inside an element the accessibility tree ignores, so screen readers saw only unlabelled buttons.
* A widget whose configured Signal K path is not currently published can be saved again. Signal K publishes a path only once some source has sent it, so switching off the gear behind an otherwise correct path — an autopilot control unit, say — made it read as unknown and disabled Save for the whole widget, locking every other setting in it. An unrecognized path now warns instead of blocking, and the widget's stored data source and unit conversion are kept rather than cleared. The warning says which problem it found: a path the server is not sending, one that has not reported a value yet, one carrying the wrong value type, a read-only path in a control, a path on another vessel, or one without the alarm zones the widget needs. Fixes #501
* Saving Display settings no longer discards your changes when Automatic Night Mode cannot be enabled. Previously, if that feature was switched on while the Signal K Derived Data plugin was missing or unreachable, the failed dependency check abandoned the whole save — theme, browser tab title, brightness and the rest were silently lost, and the error message mentioned only night mode. Everything unrelated to the plugin now saves as asked; only automatic night mode is held back, and its stored value is left as it was. Fixes #498
* OIDC/SSO users could not sign in to Skip because it required a server-local password they do not have; same-origin SSO mode resolves this.
## Behavior changes
* On a server with anonymous read enabled and OIDC auto-login off, a visitor without a session now lands on a working read-only dashboard rather than the sign-in recovery screen. What they see is the shared global `default` configuration, or this release's shipped pages — never another user's profile. Operators who relied on the previous behavior as a gate should note that the Signal K server was already serving that data to any anonymous client; what changed is that Skip now renders it.
* When auto-login is on but the redirect cannot happen — the identity provider is down and the per-tab redirect budget is spent, or Skip is running framed — a server that grants anonymous read now falls back to the read-only dashboard instead of the sign-in recovery screen, so the instruments stay readable while SSO is broken.
* Settings > Display no longer carries the **Allow saving widgets with invalid paths (testing only)** toggle. An unrecognized path no longer blocks Save, so the override has nothing left to override.
* Cross-origin token sign-in: the Signal K server provides no token-refresh endpoint, so the stored password is no longer re-sent to renew a session. The session token still persists across browser reloads until it expires; when it expires you are prompted to sign in again.
* Skip now stores its configuration in its own namespace, separate from KIP's, on both the Signal K server (applicationData appid `skip` instead of `kip`) and in browser storage (`skip.`-prefixed keys). On a server or browser that had also run KIP, Skip previously loaded KIP's dashboards and settings; it now starts from its own defaults. This is a **one-time reset with no migration** — your existing KIP config is left untouched but is not imported, so re-create or re-import your Skip configuration after this upgrade.
* The Image widget and the server-side image asset service have been removed. Dashboards that used an Image widget will show a "failed to load" placeholder in that tile (one-time; no data migration). In-app image asset management is planned to return via a future standalone `sk-media` Signal K plugin.
* Skip's bundled server-side history provider (the `node:sqlite`-backed Signal K plugin) has been removed, along with its "Widget Historical Data" provider selection in Settings → Display. History charts now rely on an external Signal K History API provider (e.g. InfluxDB via `signalk-to-influxdb2`, or `signalk-parquet`); where no provider is present, charts show an empty state.

# v4.8.0
## New Features
* Solar Charger Widget: Get instant clarity on your solar system with a compact, purpose-built Solar Charger Widget. Track individual panels or full arrays in real time, including State of Charge, remaining capacity, remaining time, voltage, current, power flow, and temperature. Device discovery is automatic, and Zones support keeps warnings and alarms state highly visible.
* AC/DC Charger Widget: Monitor charging performance at a glance with a compact AC/DC Charger Widget. View single or multiple chargers with charge mode, voltage, current, power and temperature. Chargers are discovered automatically.
## Improvements
* Battery Monitor Widget visual cleanup for better readability and tighter consistency with the electrical widget family.
* Framework upgrades and core refactoring to improve long-term maintainability and runtime performance.
## Fixes
* Improved Battery Monitor text contrast when color state is Alert (yellow), making critical values easier to read. Fixes #1027
* Restored Countdown Timer visibility in Add Widgets.
# v4.7.0
## New Features
* Battery Monitor Widget: Stay on top of your vessel’s power system with a dedicated compact Battery Monitor Widget. Instantly view individual batteries or whole banks, including State of Charge, remaining capacity, remaining time, voltage, current, power flow, and temperature. Batteries are detected automatically, with Signal K Zones support for clear warning and alarm visibility at a glance.
## Improvements
* Faster first-load widget data display so dashboards feel more immediate and alive
* Smoother dashboard transitions with reduced startup animation on Radial, Linear, Compass, Compact Linear, Windsteer, Racesteer, and Autopilot widgets
* More robust History API integration using the server-provided HistoryAPI type and improved registration cleanup. Thanks to @tkurki
* Newly added widgets now open their options automatically, speeding up setup and reducing extra taps
## Fixes
* Fixed the plugin-config-data directory location. Fixes #1006
* Fixed documentation link references
# v4.6.0
## Improvements
* Built-in Time-Series storage and History-API provider now use the native node:sqlite feature, eliminating binary and external dependencies.
  * Requires Node.js 22.5.0 or newer. If you use an older Node.js version, you must select an alternative History-API provider.
  * **IMPORTANT:** Before upgrading Node.js, always confirm your Signal K server and OS supports the required Node.js version. See the [Signal K installation documentation](https://demo.signalk.org/documentation/Installation.html).
## Fixes
* Extending v4.5.x features to VenusOS (32bit OS) - Error: Failed to start: Error loading duckdb native binding: unsupported arch 'arm' for platform 'linux'. Fixes #979
* Uninstallation does not remove all files. Fixes #981
* Reduce unwarranted installation size.
# v4.5.2 - Deprecated version due to lack of VenusOS (32bit) DuckDB binary support  
## Fixes
* DuckDB initialized when features are not enabled.
* Parquet data compression and pruning not executing.
# v4.5.1 - Deprecated version due to lack of VenusOS (32bit) DuckDB binary support 
## Fixes
* DuckDB dependency causing build and installation errors. Fixes #979
* Reduced installation size. Fixes #980
# v4.5.0 - Deprecated version due to lack of VenusOS (32bit) DuckDB binary support 
## New Features
* Effortlessly review your vessel’s history with the new Widget Historical Charts—automatically track, store, and visualize key data. Instantly access up to the last full day of performance: just two-finger tap or right-click any widget to open a seamless history dialog—no setup, no clutter, just the trends you need. (Requires Signal K v2.22.1)
* Dashboards now start with fully populated Data Charts, powered by KIP’s managed Time-Series History-API provider or other compatible history providers. (Requires Signal K v2.22.1)
* Added internet availability detection for remote queries.
## Improvements
* Added "Days" as a selectable time scale in the Data Chart widget.
* Improved integration by validating server plugin presence, plugin state, and configuration.
* Added a Node-RED introduction guide to the Help section.
* Migrated KIP plugin historical storage internals from `duckdb` to `@duckdb/node-api` and Parquet export writing to `@dsnp/parquetjs`.
## Fixes
* Improved KIP plugin OpenAPI compatibility.
* Resolved slow Data Inspector performance caused by high resource usage in deep loop logic.
* Remote Control feature should not require Admin permission. Fixes #940
# v4.4.0
## New Features
* New AIS Radar widget: Turn AIS traffic into an instant tactical view with live targets, dynamic range rings, fast zoom controls, and smart filters—so you can spot nearby vessels quicker and make confident navigation decisions at a glance.
# v4.3.0
## New Features
* New signalk-anchoralarm-plugin (by Scott Bender) embedded widget to surface its features and make anchor setting and monitoring fast and easy.
## Improvements
* Added a Simple Wind mode in Windsteer (a popular request) to mimic classic instruments. Toggle “Enable Advanced Compass Mode” off to lock the dial to +/- 180° and keep indicators stable. Fixes #828
* New high‑impact snackbar templates with inform/warn/alert layouts, bold colors, and icons that make different app message types instantly recognizable.
## Fixes
* Racesteer (beta): corrected tack/gybe angle, indicator reference, and layline calculations for better precision. Fixes #858
* Fixed occasional double‑fire on long‑press gestures (reduced extra processing).
* Prevented duplicate app events from async PUT responses (reduced extra processing).
# v4.2.0
## New Features
* Multi State Switch widget: Take control of multi‑mode devices (chargers, inverters, and more) with a clear state list that highlights the active mode and lets you switch states with a tap. Fixes #404
* Copy and Cut & Paste Widget Between Dashboards: Build dashboards faster by copying existing widgets—including their configuration—across dashboards in seconds. Fixes #554
## Improvements
* Minor all Red Night mode theming corrections to save night vision. 
## Fixes
* Gauge instrument highlights exceeds gauge scale when zones definition lack upper or lower scale definition. Fixes #871
# v4.1.0
## New Features
* Zones State Panel widget: monitor the health/state of multiple sensors and devices at a glance. Configure multiple paths per panel; each Zone States control uses KIP’s color-coded Zone severity and prominent status message to spot warnings/alarms early without digging through notification menus. Powered by Signal K metadata zone configuration. Fixes #873
## Improvements
* Better chartplotter mode with automatic night/day mode and manual night mode button applying to both Freeboard SK and KIP. Requires Freedoard SK version above v2.19.6.
* Ability to hide widget label for Switch Panel Group and the new Zone States Panel.
* Framework and dependency updates to stay current.
## Fixes
* Fix chartplotter mode notification badge not displaying.
* Fix some controls are too bright in red night mode.
# v4.0.9
## Improvements
* Racer Line and Timer widgets now include:
  * Support for named lines (configured in the Racer plugin).
  * Time To Line and Time To Boat in the Race Line widget.
  * Clearer button guidance via tooltips and improved label visibility.
* Enhanced Data Chart widget:
  * Optional “points only” rendering for the tracked series, improving readability for wrap‑around data (e.g. values that jump from the top to the bottom of the scale).
  * Data point precision that adapts to the selected time window for a more consistent experience from seconds to hours.
  * Faster initial value display to reduce the “dead spot” feeling.
## Fixes
* Data Chart widget Options: Path form losing previously saved path source.
# v4.0.8
## Improvements
* Enhanced the Remote Control experience:
  * Automatically selects the first available remote instance.
  * Supports dashboard tile selection using the Enter and Spacebar keys.
* Better keyboard support with Enter/Spacebar actions on the:
  * Dashboard selection in the sidebar navigation.
  * Dashboard tiles configuration in the Settings page.
* Improved chart smoothness by reintroducing chart streaming in:
  * Data Chart widget
  * Numeric widget’s background chart.
* Added one-click path copy to clipboard in the Data Inspector, facilitating path pasting in widget configuration.
* Simplified widget development.
## Fixes
* Occasional dashboard jumping when using the Remote Control feature. Fixes #899
* Issue where switching remote-controlled dashboards while the target was in edit mode could overwrite the dashboard. Fixes #899
* Updated Windsteer widget “Next Waypoint” indicator path to use the course provider. Fixes #886
* Fixed Radial, Linear, and Compass widget rendering issues when smaller than 8px.
* Configurations page layout not fully expanding on large displays. Fixes #874
* Widgets overlapping others on creation when space was available but smaller than the widget’s minimum size. Fixes #843
* Fixed form submission required field validation on the Options page Display tab.
* Added “No configuration is required for this plugin.” to the KIP plugin configuration section to better set expectations.
# v 4.0.7
## Improvements
* Return to last active dashboard when leaving Options, Settings and Help
* Reduce minichart dataset storage churn
## Fixes
* Gauge zones not drawn in initial app load
* More Switch Panel toggle control not responding to touch on Android Chrome and RPi Chromium
* Widget Racesteer icon rendering is missing colors
# v 4.0.6
## Fixes
* Rare case where changing widget source does not resubscribe to data and reloading the dashboard is needed.
* Switch Panel not responding to touch with Chrome on some OS/versions when fill color opacity is 0.
# v 4.0.5
## Fixes
* More Embedded widget overflow causing scrollbar
# v 4.0.4
Broken package
# v 4.0.3
## Improvements
* Automatic configuration backup before upgrade execution.
## Fixes
* Unresponsive Switch Panel widget
* Embedded Widget overflow causing scrollbar
* Migration launched more them once
# v 4.0.2
## Improvements
* Align page header styles with Freeboard‑SK for better visual integration.
* Remote Control page: minor UX and UI refinements.
## Fixes
* Correct widget sizing after configuration upgrades when width/height were missing in legacy layouts.
# v 4.0.1
## Fixes
* Prevent an upgrade edge case that created a stray Freeboard panel and pushed widgets off‑screen.
# v 4.0.0
## New features
- **Next‑gen widget framework**: A simplified component architecture that makes widgets faster to develop, leaner to run, and more consistent to configure — now with an automated widget generator and **AI‑assisted guidance** to get you from idea to working widget in minutes. Want to contribute your first widget? Run `npm run generate:widget` and follow the prompts.
- Data Chart, streamlined: Dataset configuration now lives directly inside the widget. The separate “Dataset Options” page has been retired for a cleaner flow.
- Racesteer (beta): Performance‑plugin powered windsteer with real‑time optimal steering cues and on‑the‑fly performance ratios against your polar based on live conditions. Requires a valid polar chart.
## Improvements
- Radial Gauge, your way: Hide the needle, progress bar, and ticks independently for ultra‑custom layouts.
- Snappier gestures on macOS Chrome with responsiveness refinements.
- Precision layouts with 2× grid resolution for tighter, more accurate arrangements.
- Chartplotter Mode control: Optional setting to disable KIP gestures over the Freeboard‑SK chart to prevent accidental swipes while moving the chart. Fixes #845.
- Dashboard editor ergonomics: Cancel/Ok button order now follows platform conventions (Sorry folks. You'll need to rewire your brains. Doctors say it's healthy!).
- Smarter upgrades: Configuration upgrade service now supports v2.12 → v4 config migrations with a new upgrade activity window.
- Documentation refresh: Syntax‑highlighted help, a comprehensive Chartplotter Mode guide, and clearer text across Remote Control and Notifications.
## Fixes
- Eliminated an occasional “empty dashboard flicker” when dashboards load. Mostly visible on low computing power hardware.
- Data Trends widget: fixed UI overlap on small screens. Fixes #848.
- Authentication reliability: Token renewal logic reworked to avoid 24‑day timer limits.
# v 3.12.0
# New Features
* Chartplotter Mode: A dual‑panel, performance‑tuned split experience that lets you run KIP dashboards and Freeboard‑SK together in one adaptive shell. Keep the chart live while moving between dashboards. Seamless side‑by‑side in landscape, smart vertical stacking in portrait and as always, designed for mobile and touch. Use the per‑dashboard forced collapse option for data‑focused layouts while Freeboard remains active in the background. Drag resize split distribution with commit‑on‑save editing. This feature brings you:
  * Freeboard-SK chart continuity while you cycle dashboards (full-on dedicated MFD feel, Signal K native!)
  * Remote dashboard switching compatible (no chart context loss)
  * Split collapse and change dashboard transitive animations
  * Per‑dashboard collapse flag to lock map closed for data‑dense layouts
  * Optional Freeboard‑SK widget still available if persistent background map not required
# Improvements
* Updated help documentation:
  * New Community section: curated video library, creator channel directory, contribution guidelines (PR / Discord #showcase) and ecosystem resource table.
  * Added optional Chromium "No Sleep" and resource usage optimization launch parameters to the "Kiosk Mode" documentation.
  * Enhanced "Digital Switching and PUT" section with links to supported devices.
  * "Managing Dashboards" tips and recommendations update.
# v 3.11.0
# New Features
* Level gauge: Dual-scale heel angle indicator combining a high‑precision ±5° fine level with a wide ±40° coarse arc for fast trim tuning and broader heel / sea‑state monitoring. **Special thanks to @fymmot for permission to integrate his plugin code. See https://github.com/fymmot/signalk-heel-angle**
# Improvements
* Minor Switch Panel state visibility improvement using bold fonts and a glow effect. Fixes #813
* Enhance Countdown Timer Widget with Configurable Time and Sound Alerts. Fixes #814
## Fixes
* Dashboard edit button in disabled state on initial app load. Fixes #809
# v 3.10.4
## Fixes
* Dashboard edit button disabled by default on load. Fixes #805
* Clicking the right sidenav Settings button closes the sidenav but does not navigate to the page on some browsers.
# v 3.10.3
## Fixes
* Failed to start: pluginConstructor is not a function. Fixes #808
# v 3.10.1 & v 3.10.2
* Unpublished packages: manipulation errors
# v 3.10.0
# New Feature
* Remote Control Plugin: Instantly switch dashboards on any KIP from any KIP (or your phone). Perfect for mast displays, hard‑to‑reach screens, and non‑touch devices. Open Actions → Settings → Remote Control, pick a device, tap a dashboard—done. Enable remote control in Options → Display → Remote Control.
# Improvements
* Added Kiosk Mode setup guide to Help
# v 3.9.0
# New Feature
* A new dashboard navigation experience. Introducing our all-new Dashboard sidenav designed for speed. Effortlessly jump between dashboards with a single tap, always knowing exactly where you are thanks to clear highlighting of your current dashboard.
* Discover the brand new Settings button at the top of the sidenav. Instantly access tools to manage your dashboards, plus quick links to Options, Data Inspector, and Help—all in one place.
* Personalize your dashboards with style: double-click any dashboard to open the new icon gallery and give each page a unique visual identity.
* All configuration controls are now streamlined as tabs within the Options page, making customization faster and more enjoyable than ever.
# Improvements
* Reduced GPU memory usage to improve performance and stability, especially on low-end hardware such as the RPi Zero 2.
* Added canvas bitmap blitting for better rendering speed and visual performance.
* Replaced HammerJS with native gesture support for improved responsiveness.
* Updated CSS to help prevent accidental page reloads and unwanted text selection on mobile devices.
* Enabled Notification audio on mobile.
# v 3.8.2
# Improvements
* Faster app loading with local font and font swap support
* Linux/RPi UI cleanup with removal of unnecessary scroll bars in multiple pages
* Increased mobile Wake Lock support
* Help component active page marker
## Fixes
* Dashboard card Drag & Drop and Long Press event collision preventing dashboard reordering in Chromium.
# v 3.8.1
## Improvements
* Expose option to invert pitch and roll axes in Horizon gauge widget
* Enhance memory management and lifecycle handling
* Application dependencies updated
# V 3.8.0
## New features
* Pitch & Roll widget: Horizon-style attitude display for live pitch and roll, helping monitor vessel motion in sea state.
## Improvements
* Radial gauge: Progress bar start position (left, middle, right) — enables split-from-center and regressive styles.
* Linear gauge: Needle option refined — tick values and bars are centered within the needle for better readability.
* Add Widget dialog: Optional plugin dependency awareness and display.
## Fixes
* Widget resize: Touch events could stop responding. Fixes #759
* Racer Start Line widget: Correct rotation button direction. Thanks @gregw — Fixes #757
# V 3.7.0
## New features
* Real‑time True Wind Trends widget with dual top axes for direction (°) and speed (kts). Shows live values plus SMA over the period average for faster tactical wind shift / pressure awareness.
## Improvements
* Data Chart layout: Cleaner vertical option, optional min/max line, flexible top/right axes, larger fonts for readability.
* Dataset Service circular angle stats: Correct mean/SMA/min/max for wrap‑around angles (no 0→360 jump spikes) for smoother, accurate trends.
* Widget categories: New Core & Racing groupings (retired "Basic") reduce hunting time and clarify purpose.
* Configuration upgrade guidance: More prominent tips ease migration and new input control adaptation after upgrades.
* Help access: "Get help" button on empty dashboards boosts documentation visibility and user support.
* Tutorial widget: Clearer instructions improve first‑time user experience.
* Help documentation updates.
## Fixes
* Enforce WSS under HTTPS to avoid mixed‑content issues. _Contribution by @tkurki_
* Server reconnect counter should not resets when switching tabs; removed redundant snackbar action button.
## New Contributor
* @tkurki made their first contribution
# V 3.6.1
## Fixes
* Dashboard swipe gesture over Freeboard-SK and Embed widgets not changing dashboard. Fixes #744
* Path Options form with hardcoded paths falsy reported as invalid 
* Display of Windsteer widget's True Wind Angle indicator is not optional
# V 3.6.0
## Improvements
* Numeric widget now features mini background charts for instant visual trend insights
* Data Chart widget now supports vertical orientation and inverted value scales for greater flexibility
* Data Chart loading speed and resource usage significantly improved, enabling smoother performance with large datasets
## Fixes
* Fixed login loop bug in V3.4+ when KIP is run on Signal K server and authentication is denied
# V 3.5.1
## Fixes
* Dashboard ID URL not redirecting to dashboard instance (/mxtommy/kip/#/dashboard/1)
* Widget resize handles too small to operate with fingers on smaller screens
* Display network connection and socket error messages only
* WebSocket retry should not stop after five attempts
# V 3.5.0
## New features
* Gain tactical racing advantages with new signalk-racer plugin integrated widgets for start line analysis and  race countdowns. _Contribution by @gregw_
## Improvements
* Optimized dashboard loading and switching speed for a more responsive user experience.
* Optimized Data Chart widget for significantly faster loading and smoother performance.
* Added Simple Linear widget zones support.
* Automatic detection of Signal K Autopilot API version for seamless integration.
* Enforced widget minimum dimension for better layout consistency.
* General framework updates and codebase refactoring for maintainability and performance.
## Fixes
* Dataset service does initialize on early app startup.
* Data Chart widget resets data when automatic night mode is enabled.
* Gauge widgets does not correctly distribute highlights over dynamic scales.
* Sidebar swipe gesture functionality stops responding in one direction.
## New Contributors
* @gregw made their first contribution
# V 3.4.2
## Fixes
* Stripped Vessel Base Delta path first character
# V 3.4.1
## Fixes
* Improve dashboard loading speed and keydown handling
* Fix null path configuration option when path is not required
# V 3.4.0
## New features
* Enhanced empty dashboard experience with intuitive visual guidance and one-click customization prompts for seamless onboarding
## Improvements
* Advanced recursive data flattening engine converting complex nested objects into accessible data paths for improved widget compatibility
* Completely redesigned networking architecture with state machine management for enhanced connection reliability, performance, and user experience
## Fixes
* Autopilot widget now properly handles 'off-line' connection states with appropriate visual indicators
* Removed unit conversion option from slider widget UI to preserve original path format integrity
# V 3.3.0
## New features
* New autopilot widget with responsive UI.
* New Wind Steering widget UI:
  * Added Current/Drift and Set.
  * Improved wind speeds visibility.
  * Apparent wind used for tack angle and sector calculation.
* Widget server plugin dependency validation and UI enhancements.
## Improvements
* Add support for optional and hardcoded paths in widgets increasing flexibility.
* Add days:hours:minutes:Seconds to Time unit format options. Fixes #682.
* Reduce package size.
* Support for Date values provided in metadata. Fixes #665. Special thanks to @emonty
* Add code linter. Special thanks to @emonty
* Add project documentation.
## Fixes
* Fix bouncy slider when selecting non-default value display. Fixes #671
* Position type paths should not be converted to radian. Fixes #670
* Numeric Widget has scrollbar on resize for some browsers. Fixes #640
# V 3.2.0
## New features
* Add automatic reconnection on mobile OS app resume
## Fixes
* Data Chart form error with invalid dataset uuid
# V 3.1.7
## Fixes
* Linear gauge not respecting scales with no ticks. Fixes #621
* Text overlap on low resolution screens. Fixes #624
* Minor performance improvement to Data Chart widget
# V 3.1.6
## Fixes
* Fix embed overflow scrollbar
* Fix canvas cleanup process
* Harden known webkit canvas bug with custom webfont 
# V 3.1.5
## Fixes
* Swipe sensitivity reported by trackpad device users
* Sidebars occasionally stops responding to swipes
* Documentation: Embed widget, Dataset & Data Charts and Data Inspector guides update
# V 3.1.4
## Fixes
* Help section on Updating Signal K Data (using PUT commands)
# V 3.1.3
## Fixes
* Switch Panel Indicator control only listing PUT enabled paths. Fixes #609
# V 3.1.2
## Fixes
* Embed widget not accepting relative URL and causing issues when loading KIP embeds on devices other then the server  
# V 3.1.1
## Fixes
* Missing image assets
* Only enable metadata supportsPUT path filter for SK v2.12 or more
# V 3.1.0
## Improvements
* Add option the allow input device events on Embed widget content. Fixes 602
* Add signal K plugin presence and enabled status service.
## Fixes
* Data Chart widget not applying red night mode.
* Update Tutorial text.
# V 3.0.1
## Fixes
* Fixes Embedded Web Page not working after 3.0 upgrade. Fixes #598
# V 3.0
## New features
- Touch first user experience with hotkey support
- Fullscreen dashboards experience with the removal of the bottom navbar
- New grid Dashboard layout for easy widgets rearrangement
- New deep black and true white themes for improved sunlight contrast.
- Seven new high contrast colors available.
- Widget duplication feature
- Increased Gauge color reaction to Zones highlights enhancing data state awareness
- Ability to disregard Zones configuration in applicable widgets
- Ability to have no unit label for unitless paths
- New Position widget. Special thanks to @mantas_sidlauskas 
- New Slider widget
- New Label widget
- Dashboard pages can be labeled, reordered and duplicated
- New additional low Brightness+Sepia Night mode for those whom want to keep colors at night.
- Simplified configuration management. Configuration file download & upload support
- Redesigned Notification user experience 
- Enhanced Data Inspector user experience including identification of PUT supported paths
- New Inch, Millimeter and Fuel economy units. Special thanks to @emonty
- Redesigned Help section
- Enhanced Responsive design on tablets and mobile
### Fixes
- Boolean Panel label cut off #582
- Conversion of seconds to HH:MM:SS loses sign #581
- Token renewal loop #580
- Fix Toggle Switches Boolean Control Panel - Push mode not not changing color on touchscreen #579
