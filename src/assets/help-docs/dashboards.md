## Managing Pages
Pages let you group widgets by task—navigation, engines, energy, weather, racing, night watch, and more. This guide covers creating, organizing, and editing pages, plus an overview of available widget types.


## Pages Panel
Reveal the toolbar and select Settings.

Here you can:
- Add a new page (+ button)
- Reorder pages (drag with touch or mouse)
- Rename and pick an icon (double tap or double click)
- Duplicate a page (long press or long click → Duplicate)
- Delete a page (long press or long click → Delete)

Choose icons that reflect each page’s purpose (e.g. compass for navigation, droplet for tanks, bolt for power). Icons appear wherever pages are listed.

### Gesture / Action Summary
| Action        | Touch / Mobile         | Mouse / Desktop         |
|---------------|------------------------|-------------------------|
| Add page      | Tap (+)                | Click (+)               |
| Reorder       | Drag tile              | Drag tile               |
| Rename/Icon   | Double tap             | Double click            |
| Duplicate     | Long press → Duplicate | Long click → Duplicate  |
| Delete        | Long press → Delete    | Long click → Delete     |


## Editing Page Layouts
1. Go to the page you want to change (swipe sideways, scroll horizontally, or tap its icon in the toolbar’s page navigator).
2. Reveal the toolbar (swipe down from the top, scroll up, or tap the top peek strip).
3. Tap the edit button to unlock the page.

In edit mode, widgets show dashed outlines.

### What You Can Do in Edit Mode
- Add a widget (tap empty space → Add Widget)
- Move a widget (drag)
- Resize a widget (drag edges/corners)
- Configure, duplicate, or delete a widget (tap it → action menu; Delete asks to confirm)
- Save changes (Check button) or discard (X button) in the lower right

>**Tip:** If you can’t add a widget, free up space by resizing or moving existing ones first.

## Viewing Widget History on a Locked Page
When a page is locked (normal viewing mode), you can open a history chart for a widget without entering edit mode: **press and hold (long-press)** the widget.

KIP opens a history chart dialog and loads historical series data for that widget using the History API. Only widgets bound to numeric data have a history — long-pressing anything else does nothing.


## Workflow: From Idea to Page
1. Define the purpose (e.g. “Night Nav” = heading, COG, SOG, depth, wind, batteries, minimal brightness)
2. Create or duplicate a page similar to what you want
3. Enter edit mode and add required widgets
4. Configure each widget’s data paths (keep sample times reasonable to reduce churn)
5. Arrange and size for readability at your viewing distance
6. Exit edit mode and test switching at real brightness/environment


## Widget Gallery (Overview)
KIP widgets turn Signal K data into readable visuals and controls. Available widget types:

- **Numeric** – Displays numeric data in a clear and concise format, with options to show min/max values and a background minichart for trends.
- **Text** – Displays text data with customizable color formatting.
- **Date & Time** – Shows date and time with custom formatting and timezone correction.
- **Position** – Displays latitude and longitude for location tracking and navigation.
- **Static Label** – Add customizable labels to organize and clarify your dashboard layout.
- **Zones State Panel**: Monitor the health/state of path data. Each panel control displays path data severity and status messages (driven by Signal K metadata zones).
- **Switch Panel** – Group of toggle switches, indicator lights, and press buttons for digital switching and operations. See [Digital Switching and PUT Path Setup](#/help/putcontrols.md).
- **Slider** – Range slider for adjusting values (e.g. lighting intensity). See [Digital Switching and PUT Path Setup](#/help/putcontrols.md).
- **Multi State Switch** - Lists all available device/path operating modes/states (e.g., On, Off, Charge Only, Invert Only), highlights the current state, and lets you select a new state to send to the device and see the result. See [Digital Switching and PUT Path Setup](#/help/putcontrols.md).
- **Compact Linear** – Simple horizontal linear gauge with a large value label and modern look.
- **Linear** – Horizontal or vertical linear gauge with zone highlighting.
- **Radial** – Radial gauge with configurable dials and zone highlighting.
- **Compass** – Rotating compass gauge with multiple cardinal indicator options.
- **Level Gauge** – Dual-scale heel angle indicator for trim tuning and sea-state monitoring.
- **Pitch & Roll** – Horizon-style attitude indicator showing live pitch and roll degrees.
- **Classic Steel** – Traditional steel-look linear & radial gauges with range sizes and zone highlights.
- **Windsteer** – Combines wind, wind sectors, heading, COG, and waypoint info for wind steering.
- **Wind Trends** – Real-time True Wind trends with dual axes for direction and speed, live values, and averages.
- **Battery Monitor** - Display batteries or whole banks state State of Charge, remaining capacity, remaining time, voltage, current, power flow, and temperature.
- **Solar Charger**- Track solar generation and charging performance at a glance with live panel output, battery-side metrics, and clear charger and relay status indicators.
- **AC/DC Charger**- Monitor charging performance at a glance with a compact AC/DC Charger Widget. View single or multiple chargers with charge mode, voltage, current, power and temperature. Chargers are discovered automatically.
- **Freeboard-SK** – Adds the Freeboard-SK chart plotter as a widget with automatic sign-in.
- **Autopilot Head** – Typical autopilot controls for compatible Signal K Autopilot devices.
- **Realtime Data Chart** – Visualizes data on a real-time chart with actuals, averages, and min/max.
- **AIS Radar**: Display AIS targets with range rings, interactive target details, and quick zoom and filtering controls. See [AIS Radar Widget](#/help/ais-radar.md).
- **Embed Webpage Viewer** – Embeds external web apps (Grafana, Node-RED, etc.) into your dashboard.
- **Racesteer** – Race steering display fusing polar performance data with live conditions for optimal tactics.
- **Racer - Start Line Insight** – Set and adjust start line ends, see distance, favored end, and line bias; integrates with Freeboard SK.
- **Racer - Start Timer** – Advanced racing countdown timer with OCS status and auto page switching.
- **Countdown Timer** – Simple race start countdown timer with start, pause, sync, and reset options.

### Need a Widget Not Listed Here?

- Check the community first: someone may already have a reusable setup or branch.
- If you are a developer, see [Contributing Widgets](#/help/contributing-widgets.md) for the contribution path.
- If you only need external visuals, consider [The Embed Page Viewer](#/help/embedwidget.md) for web dashboards.

## Performance & Layout Tips
- Favor clarity over cramming: leave space around high‑priority values
- Group related widgets (navigation, energy, engines, environment)
- Use consistent units per page (e.g. all speeds in knots, all temps in °C or °F—don’t mix)
- For night pages, adjust brightness or use the all‑red theme in Settings → Options → Display
- Duplicate a working layout before making major changes (easy rollback)
- Keep sampling intervals modest (1000 ms+) unless fast reaction is essential
- Know your device’s hardware limits and adjust widget count per page accordingly
- Avoid embedding too many external webpages—each adds load


## Troubleshooting
| Issue                  | Possible Cause                        | Fix                                                                 |
|------------------------|---------------------------------------|---------------------------------------------------------------------|
| Data shows “—” or blank| Path missing/not configured/null value | Open widget config, verify Signal K path exists and updates. Use Data Inspector and Signal K Data Browser to view raw data from the server. |
| Wrong units            | Default convert unit used              | Edit widget config paths and set the desired target unit.            |
| Slow page switching    | Excessive data sampling/too many widgets| Increase sample times; remove unused widgets. Split widgets into separate pages. Optimize system resource usage. |
| Embedded page blank    | Cross‑origin blocked                   | See "Embed Page Viewer" help section.                               |
| History dialog not opening on a locked page | The page is still in edit mode, or the widget has no numeric data | Lock the page first, then press and hold the widget. Only numeric‑data widgets have a history. |


## Next Steps
See also:
- Remote Control (switch pages on unattended displays)
- Night Mode (automatic theme + brightness)
- Contact / Issues (report widget feature ideas)

Refine incrementally—small improvements keep pages readable and reliable.
