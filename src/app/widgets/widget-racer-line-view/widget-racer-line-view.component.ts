import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { SignalkRequestsService } from '../../core/services/signalk-requests.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { SoundService } from '../../core/services/sound.service';
import { DataService } from '../../core/services/data.service';
import { GnssAntennaService } from './gnss-antenna.service';
import { bowPosition, positionOffsets } from './bow-position.util';
import type { IWidgetPath, IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { ITheme } from '../../core/services/app-service';
import { getColors } from '../../core/utils/themeColors.utils';
import {
  IRacerLineViewData,
  NO_VMG,
  RacerLineViewComponent,
  TEndFeedback,
  TLineEnd,
  TLineViewAction,
  TVmgName,
  VMG_NAMES
} from './racer-line-view/racer-line-view.component';

/** How long a ping waits for the plugin's answer before it is shown as failed. */
const PING_REPLY_TIMEOUT_MS = 5000;
/** How long a settled ping's colour stays on its end: a failure longer, to be noticed. */
const PING_OK_HOLD_MS = 1500;
const PING_ERROR_HOLD_MS = 3000;

/**
 * The start line, drawn at full frame.
 *
 * Watching the line is the default state: the drawing, and one mode button in the lower
 * left, carrying the same vertical ellipsis the other racer widgets use to select the
 * control mode. It steps through the screens and back round to watching: setting the ends,
 * where the two ends become touch targets that put an end on the vessel's current position
 * and a row of buttons picks the named line to work on, adjusting those ends, and adjusting
 * the best VMGs. Nothing else is offered here - the numbers and the favoured end stay in
 * the Racer - Start Line Setup widget.
 *
 * The drawing itself sits in the child directory rather than here, so it stays a
 * self-contained component: if a second widget ever needs it again it lifts back out
 * unchanged.
 */
@Component({
  selector: 'widget-racer-line-view',
  templateUrl: './widget-racer-line-view.component.html',
  styleUrls: ['./widget-racer-line-view.component.scss'],
  imports: [RacerLineViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WidgetRacerLineViewComponent {
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();

  protected readonly runtime = inject(WidgetRuntimeDirective);
  private readonly streams = inject(WidgetStreamsDirective);
  private readonly signalk = inject(SignalkRequestsService);
  private readonly sound = inject(SoundService);
  private readonly data = inject(DataService);
  private readonly gnss = inject(GnssAntennaService);
  protected readonly dashboard = inject(DashboardService);

  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    supportAutomaticHistoricalSeries: false,
    displayName: 'Start Line',
    filterSelfPaths: true,
    numDecimal: 1,
    updateInterval: 500,
    viewSmoothing: 25,
    showLineLabel: false,
    showTimeToLine: true,
    showTimeToBurn: true,
    playBeeps: true,
    color: 'contrast',
    paths: {
      // The plugin publishes one object at navigation.racing.lines holding both the
      // current line's name and the list of known lines, so both keys point at it and
      // pick their field out with observe()'s RFC 6901 pointer ('/lines').
      startLineNamePath: {
        description: 'The current named start line',
        path: 'self.navigation.racing.lines',
        source: 'default',
        pathType: 'object',
        pathRequired: false,
        isPathConfigurable: false, hideFromConfig: true,
        enableTimeout: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: null
      },
      linesPath: {
        description: 'The known named lines',
        path: 'self.navigation.racing.lines',
        source: 'default',
        pathType: 'object',
        pathRequired: false,
        isPathConfigurable: false, hideFromConfig: true,
        enableTimeout: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: null
      },
      portPath: {
        description: 'Position of the port (pin) end of the start line',
        path: 'self.navigation.racing.startLinePort',
        source: 'default', pathType: 'object', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        showPathSkUnitsFilter: false, pathSkUnitsFilter: null,
        enableTimeout: false
      },
      stbPath: {
        description: 'Position of the starboard (boat) end of the start line',
        path: 'self.navigation.racing.startLineStb',
        source: 'default', pathType: 'object', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        showPathSkUnitsFilter: false, pathSkUnitsFilter: null,
        enableTimeout: false
      },
      // Position, COG and SOG are the boat's own navigation, and the one place a boat with
      // two GPSs can feed the drawing a mix: the server's source priorities are set per
      // path, so a priority given to position alone lets the other GPS's COG and SOG
      // through. These three take a path and a source of their own to override that; the
      // plugin's paths below have a single publisher and are hidden from the settings.
      positionPath: {
        // Not necessarily the bow: the widget moves it there - see bow.
        description: 'Position of the vessel',
        path: 'self.navigation.position',
        source: 'default', pathType: 'object', pathRequired: false, isPathConfigurable: true,
        showPathSkUnitsFilter: false, pathSkUnitsFilter: null,
        // This and the four below are live navigation, published continuously, so they
        // take the stale-data TTL: a frozen boat on the drawing reads as a live one. The
        // drawing holds its frame and the gun's verdict across a lost fix - see
        // updateViewFrame and startedClean.
        enableTimeout: true
      },
      headingPath: {
        description: 'True heading of the vessel',
        path: 'self.navigation.headingTrue',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false,
        convertUnitTo: 'rad', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        enableTimeout: true
      },
      twdPath: {
        description: 'True wind direction',
        path: 'self.environment.wind.directionTrue',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false,
        convertUnitTo: 'rad', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        enableTimeout: true
      },
      cogPath: {
        description: 'Course over ground (true) of the vessel',
        path: 'self.navigation.courseOverGroundTrue',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: true,
        convertUnitTo: 'rad', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        enableTimeout: true
      },
      sogPath: {
        // Kept in m/s: the projections are metres on the ground, not a readout.
        description: 'Speed over ground of the vessel',
        path: 'self.navigation.speedOverGround',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: true,
        convertUnitTo: 'm/s', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        enableTimeout: true
      },
      lineLengthPath: {
        description: 'Length of the start line',
        path: 'self.navigation.racing.startLineLength',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        // Follows the server's unit preference for the path. Whatever that resolves to is
        // the unit the whole drawing measures in - see lengthUnit - so the line and the
        // approach legs always agree, whichever unit the server hands back.
        convertUnitTo: 'm', showConvertUnitTo: true, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm',
        enableTimeout: false
      },
      lineBearingPath: {
        description: 'Bearing of the start line',
        path: 'self.navigation.racing.startLineBearing',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 'rad', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        enableTimeout: false
      },
      ttlPath: {
        description: 'Time to sail to the start line in seconds',
        path: 'self.navigation.racing.timeToLine',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 's', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 's',
        // Published continuously while the plugin is computing it, so it takes the
        // stale-data TTL: a frozen number here reads as a live one.
        enableTimeout: true
      },
      ttbPath: {
        description: 'Time to delay before sailing to the start line in seconds',
        path: 'self.navigation.racing.timeToBurn',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 's', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 's',
        // Published continuously while the plugin is computing it, so it takes the
        // stale-data TTL: a frozen number here reads as a live one.
        enableTimeout: true
      },
      ttsPath: {
        description: 'Time to the start in seconds',
        path: 'self.navigation.racing.timeToStart',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 's', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 's',
        // Not continuous, unlike the other two: the plugin publishes the time to start
        // once when the timer is armed or reset - a 5:00 sitting there not counting - and
        // then every second only while it actually runs. A TTL would blank that seeded
        // countdown five seconds after a reset. The exemption has to be unanimous, since
        // DataService's timeout cross-clears every registration on a silent path.
        //
        // Nothing here needs it to expire: the gun is read from the countdown running
        // down to zero and the latch is cleared by the next countdown, not by this going
        // null. See startedClean in the drawing.
        enableTimeout: false
      },
      startTimePath: {
        // Cleared by the plugin whenever the timer is not counting down, so it
        // doubles as the running flag.
        description: 'Time of the start',
        path: 'self.navigation.racing.startTime',
        source: 'default', pathType: 'Date', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        enableTimeout: false
      },
      boatLengthPath: {
        // Drawn to the same scale as the line, so the triangle is the vessel's real size.
        description: 'Overall length of the vessel',
        path: 'self.design.length.overall',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 'm', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm',
        enableTimeout: false
      },
      // Where the GPS is on the hull, for working out the bow when the server's GNSS
      // configuration does not say - see bow.
      gpsFromBowPath: {
        description: 'Distance of the GPS antenna aft of the bow',
        path: 'self.sensors.gps.fromBow',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 'm', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm',
        enableTimeout: false
      },
      gpsFromCenterPath: {
        description: 'Distance of the GPS antenna from the centreline, positive to starboard',
        path: 'self.sensors.gps.fromCenter',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 'm', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm',
        enableTimeout: false
      },
      effectiveVmgToLinePath: {
        // What the plugin's time to line actually divides the perpendicular leg by:
        // the collected best, or the VMG being sailed now if that is better. Published
        // from signalk-racer 1.3.0; derived locally when it is absent.
        description: 'VMG the perpendicular leg of the time to line is divided by',
        path: 'self.navigation.racing.effectiveVmg.toLine',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 'm/s', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        enableTimeout: false
      },
      effectiveVmgAlongLinePath: {
        description: 'VMG the along-line leg of the time to line is divided by',
        path: 'self.navigation.racing.effectiveVmg.alongLine',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 'm/s', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        enableTimeout: false
      },
      vmgToCourseSidePath: {
        description: 'Best VMG across the line towards the course side',
        path: 'self.navigation.racing.bestVmg.toCourseSide',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        // Fixed, like its three siblings below: vmgUnit() formats all four from this one
        // key, so a path that followed the server's speed preference on its own would
        // label the other three wrongly.
        convertUnitTo: 'knots', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        enableTimeout: false
      },
      vmgToPortEndPath: {
        description: 'Best VMG along the line towards the port end (pin)',
        path: 'self.navigation.racing.bestVmg.toPortEnd',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 'knots', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        enableTimeout: false
      },
      vmgToStbEndPath: {
        description: 'Best VMG along the line towards the starboard end (boat)',
        path: 'self.navigation.racing.bestVmg.toStbEnd',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 'knots', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        enableTimeout: false
      },
      vmgFromCourseSidePath: {
        description: 'Best VMG back across the line from the course side',
        path: 'self.navigation.racing.bestVmg.fromCourseSide',
        source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, hideFromConfig: true,
        convertUnitTo: 'knots', showConvertUnitTo: false, showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        enableTimeout: false
      }
    }
  };

  // Everything live, handed to the drawing as one object so it recomputes its scene once
  // per update rather than once per path.
  private readonly view = signal<IRacerLineViewData>({
    portLat: null, portLon: null, stbLat: null, stbLon: null,
    lat: null, lon: null, fixTime: null,
    heading: null, cog: null, sog: null,
    lineLength: null, lineBearing: null,
    timeToStart: null, startTime: null, twd: null,
    boatLength: null, effVmgToLine: null, effVmgAlongLine: null,
    bestVmg: { ...NO_VMG }
  });
  private readonly ttl = signal<number | null>(null);
  private readonly ttb = signal<number | null>(null);
  protected readonly timeToLine = this.ttl.asReadonly();
  protected readonly timeToBurn = this.ttb.asReadonly();

  /** The position as received, and the `$source` it came from; the view carries the bow instead. */
  private readonly fix = signal<{ lat: number | null; lon: number | null; source: string | null }>(
    { lat: null, lon: null, source: null });
  private readonly gpsFromBow = signal<number | null>(null);
  private readonly gpsFromCenter = signal<number | null>(null);

  /**
   * The bow, which the drawing takes the vessel's position to be.
   *
   * signalk-racer measures every distance to the line from the bow, and since server 2.31
   * `navigation.position` may be the antenna or the server's midships reference point, so the
   * bow is worked out exactly as racer does it (see bow-position.util.ts): otherwise the drawn
   * boat and racer's numbers disagree by metres.
   */
  private readonly bow = computed<{ lat: number | null; lon: number | null }>(() => {
    const { lat, lon, source } = this.fix();
    if (lat == null || lon == null) return { lat, lon };
    const d = this.view();
    const offsets = positionOffsets({
      source,
      length: d.boatLength,
      gnss: this.gnss.config(),
      serverVersion: this.gnss.serverVersion(),
      canonical: ref => this.gnss.canonical(ref),
      gpsFromBow: this.gpsFromBow(),
      gpsFromCenter: this.gpsFromCenter()
    });
    const bow = bowPosition(lat, lon, d.heading ?? d.cog, offsets);
    return { lat: bow.latitude, lon: bow.longitude };
  });

  protected readonly viewData = computed<IRacerLineViewData>(() => ({ ...this.view(), ...this.bow() }));

  protected readonly palette = signal<{ color: string; dim: string; dimmer: string }>(
    { color: 'var(--skip-contrast-color)', dim: 'var(--skip-contrast-dim-color)',
      dimmer: 'var(--skip-contrast-dimmer-color)' });

  private cfg(): IWidgetSvcConfig {
    return this.runtime.options() ?? WidgetRacerLineViewComponent.DEFAULT_CONFIG;
  }

  private get pathsRecord(): Record<string, IWidgetPath> {
    return (this.cfg().paths as Record<string, IWidgetPath> | undefined) ?? {};
  }

  protected readonly title = computed<string>(() => this.cfg().displayName || 'Start Line');
  protected readonly viewSmoothing = computed<number>(() => this.cfg().viewSmoothing ?? 25);
  protected readonly showLineLabel = computed<boolean>(() => this.cfg().showLineLabel ?? false);
  protected readonly showTimeToLine = computed<boolean>(() => this.cfg().showTimeToLine ?? true);
  protected readonly showTimeToBurn = computed<boolean>(() => this.cfg().showTimeToBurn ?? true);
  /**
   * The unit every distance in the drawing is shown in: the line's length, the approach
   * legs, all of it.
   *
   * Taken from the unit the length stream actually resolved to rather than from the
   * stored config, because a path that follows the server's unit preference is converted
   * to whatever that preference says - which is not necessarily what `convertUnitTo`
   * holds. Reading the config instead is how the legs came to be drawn in metres beside a
   * line length in nautical miles. Falls back to the stored unit until the first value
   * arrives.
   */
  private readonly lengthMeasure = signal<string | null>(null);
  protected readonly lengthUnit = computed<string>(() =>
    this.lengthMeasure() ?? this.pathsRecord['lineLengthPath']?.convertUnitTo ?? 'm');
  protected readonly vmgUnit = computed<string>(() =>
    this.pathsRecord['vmgToCourseSidePath']?.convertUnitTo ?? 'knots');

  /**
   * Which screen is showing: 0 watches the line, 1 sets its ends and picks the named
   * line, 2 adjusts the ends of the one in use, 3 adjusts the best VMGs behind the time
   * to line.
   *
   * Cycled by the one button, and never by a timeout: pinging the ends takes as long as
   * it takes, and a mode that expired just as the helm reached for the pin would be
   * worse than no mode at all.
   */
  protected readonly mode = signal<0 | 1 | 2 | 3>(0);

  /** Which best VMG the adjust buttons act on; null while none is chosen. */
  protected readonly selectedVmg = signal<TVmgName | null>(null);

  /** The named lines the plugin knows, and which is current. */
  private readonly lines = signal<string[]>(['Default']);
  private readonly startLineName = signal<string | null>(null);
  protected readonly lineNames = computed<string[]>(() => this.lines());
  protected readonly currentLineName = computed<string>(() => this.startLineName() || 'Default');

  /**
   * Which named line the picker is showing. Held as a name rather than an index so that
   * a list arriving or changing under it cannot silently point it at a different line;
   * a name that is no longer known falls back to the one in use.
   */
  private readonly browsed = signal<string | null>(null);
  protected readonly browsedLine = computed<string>(() => {
    const name = this.browsed();
    return name && this.lineNames().includes(name) ? name : this.currentLineName();
  });

  /** Step to the next screen, and back to watching after the last. */
  protected nextMode(): void {
    this.mode.update(m => (m === 3 ? 0 : m + 1) as 0 | 1 | 2 | 3);
    // A selection only means anything on the screen that shows it.
    this.selectedVmg.set(null);
  }

  /** What a control in the drawing asked for. */
  protected onAction(action: TLineViewAction): void {
    switch (action.kind) {
      case 'mode':
        this.nextMode();
        break;
      case 'browse': {
        const names = this.lineNames();
        const at = names.indexOf(this.browsedLine());
        // Wraps both ways, so a short list is a couple of presses from anything in it.
        this.browsed.set(names[(at + action.step + names.length) % names.length]);
        break;
      }
      case 'choose':
        this.selectLine(this.browsedLine());
        break;
      case 'adjust':
        this.signalk.putRequest('navigation.racing.setStartLine',
          { end: action.end, delta: action.delta, rotate: action.rotate || null }, this.id());
        break;
      case 'vmgNext': {
        // Round the four and then off again, so the pad can be left showing no selection
        // and nothing to press by accident.
        const at = this.selectedVmg() ? VMG_NAMES.indexOf(this.selectedVmg()!) + 1 : 0;
        this.selectedVmg.set(at >= VMG_NAMES.length ? null : VMG_NAMES[at]);
        break;
      }
      case 'vmgStep': {
        const name = this.selectedVmg();
        if (!name) break;
        this.signalk.putRequest('navigation.racing.setBestVmg',
          { vmg: name, delta: action.deltaMs }, this.id());
        break;
      }
      case 'vmgClear':
        this.signalk.putRequest('navigation.racing.setBestVmg',
          { command: 'clear' }, this.id());
        break;
      case 'vmgReset':
        // No vmg name clears every override, which is what the Reset offers.
        this.signalk.putRequest('navigation.racing.setBestVmg',
          { command: 'reset' }, this.id());
        break;
    }
  }

  /**
   * How each end's last ping is going, for the drawing to show on its target: 'pending'
   * from the press until the plugin answers, then 'ok' or 'error' for a moment, then back
   * to 'idle'. A ping is the one press here whose effect cannot be seen - the boat is
   * already sitting on the end it just set - so without this a press that worked and one
   * that never arrived look the same.
   */
  protected readonly endFeedback = signal<Record<TLineEnd, TEndFeedback>>({ port: 'idle', stb: 'idle' });
  /** The request each end is waiting on; a reply to an older one is ignored. */
  private readonly endRequest: Record<TLineEnd, string | null> = { port: null, stb: null };
  /**
   * The request each end gave up waiting on. The plugin may still set the end after the
   * timeout, and a late success must not be left showing as a failure.
   */
  private readonly lateRequest: Record<TLineEnd, string | null> = { port: null, stb: null };
  private readonly endTimer: Record<TLineEnd, ReturnType<typeof setTimeout> | null> = { port: null, stb: null };

  /** Put an end of the line on the boat's current position. */
  protected setLineEnd(end: TLineEnd): void {
    this.lateRequest[end] = null;
    this.showEndFeedback(end, 'pending', PING_REPLY_TIMEOUT_MS);
    const requestId = this.signalk.putRequest('navigation.racing.setStartLine',
      { end, position: 'bow' }, this.id());
    this.endRequest[end] = requestId;
    // Not sent at all: no reply is coming to settle it.
    if (requestId == null) this.settleEnd(end, false);
  }

  /** The plugin's answer to a ping, or the lack of one. */
  private settleEnd(end: TLineEnd, ok: boolean): void {
    this.endRequest[end] = null;
    this.showEndFeedback(end, ok ? 'ok' : 'error', ok ? PING_OK_HOLD_MS : PING_ERROR_HOLD_MS);
    if (!this.cfg().playBeeps) return;
    // Loud enough to carry on deck: one high pip for done, two low ones for not.
    if (ok) {
      this.sound.playTone(880, 150, 0.3);
    } else {
      this.sound.playTone(220, 200, 0.3);
      this.sound.playTone(220, 200, 0.3, 300);
    }
  }

  /**
   * Show a state on an end's target, and what follows it after `holdMs`: a pending ping
   * that has heard nothing by then has failed, and a settled one goes back to idle.
   */
  private showEndFeedback(end: TLineEnd, state: TEndFeedback, holdMs: number): void {
    const timer = this.endTimer[end];
    if (timer) clearTimeout(timer);
    this.endFeedback.update(f => ({ ...f, [end]: state }));
    this.endTimer[end] = setTimeout(() => {
      this.endTimer[end] = null;
      if (state === 'pending') {
        this.lateRequest[end] = this.endRequest[end];
        this.settleEnd(end, false);
      } else this.endFeedback.update(f => ({ ...f, [end]: 'idle' }));
    }, holdMs);
  }

  private settleRequest(requestId: string, statusCode: number | null): void {
    for (const end of ['port', 'stb'] as const) {
      if (this.endRequest[end] === requestId) {
        this.settleEnd(end, statusCode === 200);
      } else if (this.lateRequest[end] === requestId) {
        // Already shown as failed; only a success changes that.
        this.lateRequest[end] = null;
        if (statusCode === 200) this.settleEnd(end, true);
      }
    }
    this.settleLineName(requestId, statusCode);
  }

  /**
   * Switch the plugin to a named line, and show it as the current one at once.
   *
   * The name is set locally as well as sent, because the plugin republishes the line it
   * is working on only once it has changed it: waiting for that leaves the name still
   * reading as a button offering the line just chosen, which reads as a press that did
   * nothing. The stream's own value lands on top of this a moment later, and a switch
   * the plugin refuses is taken back - see settleLineName.
   */
  protected selectLine(name: string): void {
    const selectedName = name === 'Default' ? null : name;
    const previous = this.startLineName();
    const requestId = this.signalk.putRequest('navigation.racing.setStartLineName',
      {startLineName: selectedName}, this.id());
    if (requestId != null) {
      this.pendingLineName = { requestId, previous, shown: selectedName };
      this.startLineName.set(selectedName);
      this.browsed.set(name);
    }
  }

  /**
   * The line switch shown ahead of the plugin's answer. A switch the plugin refuses is
   * never republished - nothing changed - so without taking the name back it would sit
   * over the previous line's geometry for good.
   */
  private pendingLineName: { requestId: string; previous: string | null; shown: string | null } | null = null;

  private settleLineName(requestId: string, statusCode: number | null): void {
    const pending = this.pendingLineName;
    if (!pending || pending.requestId !== requestId) return;
    this.pendingLineName = null;
    // Only undone while it is still what is showing: the stream may already have moved on.
    if (statusCode !== 200 && this.startLineName() === pending.shown) {
      this.startLineName.set(pending.previous);
    }
  }

  /**
   * The `$source` of the position just received: the configured one, or for the default
   * source the one whose update is the latest - the streams do not carry it.
   */
  private positionSource(): string | null {
    const config = this.pathsRecord['positionPath'];
    if (!config?.path) return null;
    if (config.source && config.source !== 'default') return config.source;
    const item = this.data.getPathObject(config.path);
    if (!item) return null;
    const latest = Object.entries(item.sources)
      .find(([, s]) => s.sourceTimestamp === item.pathTimestamp);
    return latest?.[0] ?? item.defaultSource ?? null;
  }

  constructor() {
    effect(() => {
      const cfg = this.runtime.options() ?? WidgetRacerLineViewComponent.DEFAULT_CONFIG;
      const theme = this.theme();
      if (!theme) return;
      untracked(() => this.palette.set(getColors(cfg.color ?? 'contrast', theme)));
    });

    // A path cleared in the options has no stream left to say it went away, so what it last
    // delivered is cleared here: otherwise it stays on the drawing as a live reading.
    const num = (key: string, apply: (v: number | null, at: number | null) => void) => {
      effect(() => {
        if (!this.pathsRecord[key]?.path) {
          untracked(() => apply(null, null));
          return;
        }
        untracked(() => this.streams.observe(key, pkt => {
          const value = pkt?.data?.value;
          const at = pkt?.data?.timestamp;
          apply(typeof value === 'number' ? value : null, at ? at.getTime() : null);
        }));
      });
    };

    /** The same, for a path whose value is a whole {latitude, longitude} in degrees. */
    const position = (key: string,
      apply: (pos: { latitude?: number | null; longitude?: number | null } | null,
        at: number | null) => void) => {
      effect(() => {
        if (!this.pathsRecord[key]?.path) {
          untracked(() => apply(null, null));
          return;
        }
        untracked(() => this.streams.observe(key, pkt => {
          const value = pkt?.data?.value as
            { latitude?: number | null; longitude?: number | null } | null | undefined;
          const at = pkt?.data?.timestamp;
          apply(value ?? null, at ? at.getTime() : null);
        }));
      });
    };
    // Signal K emits a position whole, at its own path: the delta service stopped
    // fabricating dotted child paths for object values (SK-02 / #21), so there is no
    // navigation.position.latitude to subscribe to. All three positions here - the two
    // line ends and the vessel - arrive as one {latitude, longitude} object in degrees.
    position('portPath', (pos) =>
      this.view.update(d => ({ ...d, portLat: pos?.latitude ?? null, portLon: pos?.longitude ?? null })));
    position('stbPath', (pos) =>
      this.view.update(d => ({ ...d, stbLat: pos?.latitude ?? null, stbLon: pos?.longitude ?? null })));
    position('positionPath', (pos, at) => {
      this.fix.set({ lat: pos?.latitude ?? null, lon: pos?.longitude ?? null, source: this.positionSource() });
      this.view.update(d => ({ ...d, fixTime: at }));
    });
    num('headingPath', v => this.view.update(d => ({ ...d, heading: v })));
    num('cogPath', v => this.view.update(d => ({ ...d, cog: v })));
    num('twdPath', v => this.view.update(d => ({ ...d, twd: v })));
    num('sogPath', v => this.view.update(d => ({ ...d, sog: v })));
    // Bespoke rather than num(), to keep the resolved measure as well as the value.
    effect(() => {
      if (!this.pathsRecord['lineLengthPath']?.path) return;
      untracked(() => this.streams.observe('lineLengthPath', pkt => {
        const value = pkt?.data?.value;
        this.lengthMeasure.set(pkt?.data?.measure ?? null);
        this.view.update(d => ({ ...d, lineLength: typeof value === 'number' ? value : null }));
      }));
    });
    num('lineBearingPath', v => this.view.update(d => ({ ...d, lineBearing: v })));
    num('ttsPath', v => this.view.update(d => ({ ...d, timeToStart: v })));
    num('ttlPath', v => this.ttl.set(v));
    num('ttbPath', v => this.ttb.set(v));
    num('boatLengthPath', v => this.view.update(d => ({ ...d, boatLength: v })));
    num('gpsFromBowPath', v => this.gpsFromBow.set(v));
    num('gpsFromCenterPath', v => this.gpsFromCenter.set(v));
    this.gnss.ensureStarted();
    num('effectiveVmgToLinePath', v => this.view.update(d => ({ ...d, effVmgToLine: v })));
    num('effectiveVmgAlongLinePath', v => this.view.update(d => ({ ...d, effVmgAlongLine: v })));
    // The collected bests still matter: they are the fallback the drawing derives its
    // effective VMGs from when the plugin does not publish them.
    for (const name of VMG_NAMES) {
      const cap = name.charAt(0).toUpperCase() + name.slice(1);
      num(`vmg${cap}Path`, v =>
        this.view.update(d => ({ ...d, bestVmg: { ...d.bestVmg, [name]: v } })));
    }

    // 202 is held back by the service until the final answer, so every result seen here
    // is settled.
    this.signalk.subscribeRequest().pipe(takeUntilDestroyed()).subscribe(result => {
      if (result.widgetUUID === this.id()) this.settleRequest(result.requestId, result.statusCode);
    });
    inject(DestroyRef).onDestroy(() => {
      for (const end of ['port', 'stb'] as const) {
        const timer = this.endTimer[end];
        if (timer) clearTimeout(timer);
      }
    });

    effect(() => {
      if (!this.pathsRecord['startLineNamePath']?.path) return;
      untracked(() => this.streams.observe('startLineNamePath', pkt =>
        this.startLineName.set((pkt?.data?.value as string) ?? null), '/startLineName'));
    });

    effect(() => {
      if (!this.pathsRecord['linesPath']?.path) return;
      untracked(() => this.streams.observe('linesPath', pkt => {
        const named = ['Default'];
        const value = pkt?.data?.value;
        if (Array.isArray(value)) {
          for (const line of value) {
            if (line?.startLineName) named.push(line.startLineName as string);
          }
        }
        this.lines.set(named);
      }, '/lines'));
    });

    effect(() => {
      if (!this.pathsRecord['startTimePath']?.path) return;
      untracked(() => this.streams.observe('startTimePath', pkt =>
        this.view.update(d => {
          const value = pkt?.data?.value;
          return { ...d, startTime: value ? String(value) : null };
        })));
    });
  }
}
