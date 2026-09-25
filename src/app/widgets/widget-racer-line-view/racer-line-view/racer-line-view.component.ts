import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { UnitsService } from '../../../core/services/units.service';
import { ILatLon, ILineGeometry, lineGeometry, screenVector } from './start-line-geometry.util';

/**
 * The four best VMGs the signalk-racer plugin publishes, and the order the widget reads
 * them in. The drawing chooses one per leg of the approach, so it owns the set; the
 * widget around it seeds and subscribes from the same names.
 */
export const VMG_NAMES = ['toCourseSide', 'toPortEnd', 'toStbEnd', 'fromCourseSide'] as const;
export type TVmgName = typeof VMG_NAMES[number];

export const VMG_TITLE: Record<TVmgName, string> = {
  toCourseSide: 'Best VMG across the line towards the course side',
  toPortEnd: 'Best VMG along the line towards the port end (pin)',
  toStbEnd: 'Best VMG along the line towards the starboard end (committee boat)',
  fromCourseSide: 'Best VMG back across the line from the course side, used when OCS'
};

/**
 * What a control in the drawing asks the host to do. The drawing owns where the controls
 * are - they belong beside the line ends and under the line - and the host owns what they
 * mean, so the geometry and the Signal K requests stay in separate places.
 */
export type TLineViewAction =
  | { kind: 'mode' }
  | { kind: 'browse'; step: -1 | 1 }
  | { kind: 'choose' }
  | { kind: 'adjust'; end: 'port' | 'stb'; delta: number; rotate: number }
  // Step the selection on to the next VMG, and off the end of them.
  | { kind: 'vmgNext' }
  // Metres per second, whatever unit the pad shows: the plugin's own unit for a VMG.
  | { kind: 'vmgStep'; deltaMs: number }
  // Reset drops the manual overrides; clear throws away the collected samples too.
  | { kind: 'vmgReset' }
  | { kind: 'vmgClear' };

/** No VMGs known yet, for seeding a record of them. */
export const NO_VMG: Record<TVmgName, number | null> =
  { toCourseSide: null, toPortEnd: null, toStbEnd: null, fromCourseSide: null };

declare global {
  interface Window {
    /** Turns the approach trace below on: set it from the browser console. */
    skipRacerStartLineDebug?: boolean;
    /** Every row the trace has logged this run, for copying out in one go. */
    skipRacerStartLineTrace?: Record<string, number | string | null>[];
  }
}


/**
 * Floor under a derived effective VMG, in m/s - one knot, matching the plugin's own
 * `minEffectiveVmg` default. Only used when the plugin does not publish its effective
 * VMGs; when it does, its configured value governs.
 */
const MIN_EFFECTIVE_VMG = 0.514444;

/**
 * How old the last fix may be and still judge the gun, when the position has timed out
 * by then. The stale-data TTL is 5s and its retry another 5s, so this covers one missed
 * retry; a fix lost for longer than that says nothing about the start.
 */
const LAST_FIX_AT_GUN_MS = 15000;

const LEGEND_CURRENT = 'Current cog/sog to start';
const LEGEND_STUB = 'Current course over ground (no timer running)';

/**
 * Everything the drawing needs from the Signal K stream. The host widget owns the
 * subscriptions and hands the values down, so this component stays a pure view.
 */
export interface IRacerLineViewData {
  portLat: number | null; portLon: number | null;
  stbLat: number | null; stbLon: number | null;
  lat: number | null; lon: number | null;
  /** Signal K's timestamp for the current position fix, for the approach trace. */
  fixTime: number | null;
  heading: number | null; cog: number | null; sog: number | null;
  lineLength: number | null; lineBearing: number | null;
  timeToStart: number | null;
  /**
   * The start time as the plugin publishes it; null while no countdown is set. The plugin
   * publishes it exactly while its timer is running - set on start, moved by an adjust or
   * sync, left in place at the gun, nulled only by a reset - so its presence is what says
   * the timer is running. A countdown sitting at a set 5:00 has none.
   */
  startTime: string | null;
  /** True wind direction, the bearing the wind blows FROM. */
  twd: number | null;
  boatLength: number | null;
  /** The effective VMGs as the plugin publishes them; null against an older one. */
  effVmgToLine: number | null; effVmgAlongLine: number | null;
  bestVmg: Record<TVmgName, number | null>;
}

/** The projection running from the boat towards the line. */
interface ISceneProjection {
  x1: number; y1: number; x2: number; y2: number;
  width: number; opacity: number; title: string;
}

/** The two ends of the line, drawn at an exaggerated size so they stay legible. */
interface ISceneEnds {
  /** Radius of the pin at the port end. */
  pinRadius: number;
  /** Hull of the committee boat at the starboard end. */
  hull: string;
  /** Cabin sitting on that hull. */
  cabin: { x: number; y: number; width: number; height: number };
}

/**
 * The fitted view of the line drawing, held steady between re-fits so the line stays put
 * and the boat moves against it.
 */
interface IViewFrame {
  /** viewBox units per metre. */
  scale: number;
  /** Along-line and across-line model coordinates at the centre of the drawing. */
  midA: number;
  midC: number;
}

/**
 * One leg of the approach, drawn as a dimension line: a rule with a tick at each end and
 * its value set into a break in the middle, so it reads as a measurement rather than as
 * a course to steer. Both legs are axis-aligned on screen, the drawing being line-up.
 */
interface ISceneLeg {
  x1: number; y1: number; x2: number; y2: number;
  /** End ticks, drawn across the leg. */
  ticks: string;
  label: string;
  labelX: number; labelY: number;
  /** Horizontal legs label above the rule, vertical ones label beside it. */
  anchor: 'middle' | 'start' | 'end';
  title: string;
  /**
   * The first leg of a two-leg approach, drawn a shade darker than the second. When the
   * approach turns a corner the two labels sit near each other in the same colour and
   * read as one pair of numbers; the shading says which is sailed first.
   */
  leading: boolean;
}

/**
 * One control drawn into the scene: a rounded touch target with either a glyph or a word
 * in it. Drawn in the SVG rather than as HTML over it so the controls sit exactly beside
 * the marks they act on and scale with the drawing.
 */
interface ISceneButton {
  x: number; y: number; w: number; h: number;
  /** Corner radius, matching the 12px the other racer widgets' buttons use. */
  rx: number;
  /** Path for a chevron or the vertical three dots, drawn centred on the button. */
  glyph: string | null;
  text: string | null;
  fontSize: number;
  title: string;
  action: TLineViewAction;
  /** Accent fill - the mode button, and a line name that can be selected. */
  accent: boolean;
}

/**
 * The four best VMGs, laid out to match the drawing above them: across the line towards
 * the course side at the top, back across it at the bottom, and along it towards each end
 * to the side that end is drawn on.
 */
interface ISceneVmgPad {
  values: {
    x: number; y: number; text: string; fontSize: number; title: string;
    /** The one the adjust buttons are pointed at. */
    selected: boolean;
  }[];
  /** The four-way arrow they are arranged around, which is what says which is which. */
  compass: { x: number; y: number; path: string };
  caption: { x: number; y: number; text: string; fontSize: number };
}

/** A countdown shown in the corner: a small caption and the time beside it. */
interface ISceneReadout {
  x: number; valueX: number; y: number; caption: string; value: string;
  captionSize: number; valueSize: number;
}

/** Everything the template draws, in viewBox units. */
interface IScene {
  portX: number; stbX: number; lineY: number;
  ends: ISceneEnds;
  /** Whether the length and heading label is drawn at all. */
  labelVisible: boolean;
  /**
   * How the line itself reads: over early with time still to run, a clean start already
   * made, or neither. See lineStatus.
   */
  lineStatus: 'ocs' | 'started' | null;
  /**
   * Whether each end is a real position or just somewhere to press. Set together today
   * - see placeholderScene - but kept per end so the drawing is ready for a plugin that
   * says which one is missing.
   */
  portUndefined: boolean; stbUndefined: boolean;
  label: string; labelX: number; labelY: number;
  projections: ISceneProjection[];
  boat: { path: string; ocs: boolean; title: string } | null;
  /**
   * The start zone: the line's own extensions and the 45 degree wedges off each end,
   * drawn faintly because they are what decides which legs the time to line is built
   * from, not part of the course itself.
   */
  guides: { x1: number; y1: number; x2: number; y2: number }[];
  /** The approach the time to line is computed over: along to the zone, then across. */
  legs: ISceneLeg[];
  /** Where the boat reaches along those legs at the gun, at the effective VMGs. */
  gun: { x: number; y: number; title: string } | null;
  /**
   * Touch targets over each end, while the ends are being set. Square with a rounded
   * corner, like every other control here - the shape is what says it is a button.
   */
  editEnds: {
    port: { x: number; y: number; size: number; rx: number; title: string };
    stb: { x: number; y: number; size: number; rx: number; title: string };
  } | null;
  /** Every control in this mode: the mode button, and whatever the mode itself offers. */
  controls: ISceneButton[];
  /** The current line's name, shown under the line while editing. */
  nameLabel: { x: number; y: number; text: string; fontSize: number } | null;
  /** The best-VMG pad, on the screen that adjusts them. */
  vmgPad: ISceneVmgPad | null;
  /** Size of the length and heading label, shrunk from LABEL_FONT if it would not fit. */
  labelFont: number;
  /** The wind, shown against the line's own orientation. Null when TWD is unknown. */
  wind: { points: string; title: string } | null;
}

/**
 * The start line drawing: the line "line up" with the boat against it, the start zone it
 * sits in, and the approach the time to line is computed over. Purely presentational:
 * the host widget owns the data and the buttons.
 */
@Component({
  selector: 'racer-line-view',
  templateUrl: './racer-line-view.component.html',
  styleUrls: ['./racer-line-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RacerLineViewComponent implements AfterViewInit, OnDestroy {
  /** Everything live, from the host widget's subscriptions. */
  public data = input.required<IRacerLineViewData>();
  /**
   * Which screen is showing: 0 watches the line, 1 sets its ends and picks which named
   * line to work on, 2 adjusts the ends of the one in use, 3 adjusts the best VMGs the
   * time to line is computed from. Every editing screen gives the line the full width and
   * draws nothing else, the boat being beside the point while the line and the numbers
   * behind it are being worked on.
   */
  public mode = input<0 | 1 | 2 | 3>(0);
  /** Which end was pressed, for the host to act on. */
  public endPressed = output<'port' | 'stb'>();
  /** Everything else a control in the drawing asks for. */
  public action = output<TLineViewAction>();
  /** The named lines the plugin knows, the one in use, and the one being browsed. */
  public lines = input<string[]>(['Default']);
  public currentLine = input<string>('Default');
  public browsedLine = input<string>('Default');
  /** Countdowns to show in the corner; null hides that one. */
  public timeToLine = input<number | null>(null);
  public timeToBurn = input<number | null>(null);
  /** Show the line's length and heading. The editing screens show it regardless. */
  public showLineLabel = input<boolean>(false);
  public showTimeToLine = input<boolean>(false);
  public showTimeToBurn = input<boolean>(false);
  /** Which best VMG the adjust buttons act on, if any. The host owns the selection. */
  public selectedVmg = input<TVmgName | null>(null);
  public title = input<string>('');
  public palette = input.required<{ color: string; dim: string; dimmer: string }>();
  /** Unit the line length and the approach legs are shown in. */
  public lengthUnit = input<string>('m');
  /** Unit the best VMGs are shown in. */
  public vmgUnit = input<string>('knots');
  /** Percent of the drawing's height the view may drift before it re-fits. */
  public viewSmoothing = input<number>(25);

  private readonly units = inject(UnitsService);

  /** Either editing screen: the line takes the frame and the boat is not drawn. */
  private readonly editing = computed<boolean>(() => this.mode() > 0);

  // The drawing was written against signals holding each value; these keep that shape so
  // the geometry below reads the same whether the data arrives as inputs or as streams.
  private readonly portLat = computed(() => this.data().portLat);
  private readonly portLon = computed(() => this.data().portLon);
  private readonly stbLat = computed(() => this.data().stbLat);
  private readonly stbLon = computed(() => this.data().stbLon);
  private readonly lat = computed(() => this.data().lat);
  private readonly lon = computed(() => this.data().lon);
  private readonly fixTime = computed(() => this.data().fixTime);
  private readonly heading = computed(() => this.data().heading);
  private readonly cog = computed(() => this.data().cog);
  private readonly sog = computed(() => this.data().sog);
  private readonly lineLength = computed(() => this.data().lineLength);
  private readonly lineBearing = computed(() => this.data().lineBearing);
  private readonly timeToStart = computed(() => this.data().timeToStart);
  private readonly startTime = computed(() => this.data().startTime);
  private readonly timerRunning = computed(() => this.startTime() != null);
  private readonly twd = computed(() => this.data().twd);
  private readonly boatLength = computed(() => this.data().boatLength);
  private readonly effVmgToLine = computed(() => this.data().effVmgToLine);
  private readonly effVmgAlongLine = computed(() => this.data().effVmgAlongLine);
  private readonly bestVmg = computed(() => this.data().bestVmg);

  // Drawing coordinate system. The height is fixed so that font sizes scale with the
  // widget; the width tracks the container aspect so the drawing fills it undistorted.
  protected readonly VB_HEIGHT = 260;
  // Band kept clear at the top for the widget title, so the drawing can never run into
  // it however the boat lies.
  protected readonly VB_TOP_BAND = 26;
  // The line is never drawn into the bottom of the viewport: at a glance a line low
  // in the frame reads as one about to leave it. 10% of the height.
  private readonly VB_BOTTOM_MARGIN = 26;
  private readonly VB_MARGIN = 28;
  // Font size of the length and start heading label. Everything sitting above the line -
  // the label and the arrow beside it - is scaled from it, and LABEL_HEADROOM is the
  // space that has to stay clear above the line to hold them.
  private readonly LABEL_FONT = 28.8;
  private readonly LABEL_HEADROOM = 56;
  // Font size of the approach legs' dimension labels. Everything positioning them is
  // derived from it, so the two cannot drift apart; the template sets it on the text.
  protected readonly LEG_FONT = 22.5;
  // Both ends of the line are taken to be 10m objects. They are drawn at this multiple
  // of their true size so they stay legible landmarks whatever the line's zoom.
  private readonly END_METRES = 10;
  private readonly END_EXAGGERATION = 2;
  /** Largest an end mark is drawn, in viewBox units; what buildEnds clamps to. */
  private readonly END_SIZE_MAX = 40;
  // The vessel, in contrast, is drawn at true scale, so it can be read against the line.
  // Fallback length for a vessel that does not publish one, and the beam its hull is
  // drawn with as a fraction of that length.
  private readonly DEFAULT_BOAT_METRES = 10;
  private readonly HULL_BEAM_RATIO = 0.36; // TODO lookup boat width
  private readonly MIN_HULL_DISPLAY_UNITS = 20;
  /**
   * How much of the line, in boat lengths, the fit keeps in frame before it will zoom in
   * any further. Ten is about as much as places the boat along the line rather than just
   * beside a mark; a line shorter than that is shown whole, and a longer one is not
   * chased - past this the detail around the boat is worth more than the water at the
   * far end.
   */
  private readonly LINE_IN_FRAME_LENGTHS = 10;

  // The line a placeholder stands in for. Nothing measures against it; it only gives the
  // end marks a scale to be drawn at.
  private readonly PLACEHOLDER_METRES = 100;
  protected readonly vbWidth = signal<number>(400);
  /**
   * The drawing's rendered height in CSS pixels, for the one measurement that has to be
   * in pixels rather than viewBox units: the controls' corner radius, which matches the
   * other racer widgets' 12px buttons and so cannot scale with the drawing.
   */
  private readonly hostHeightPx = signal<number>(this.VB_HEIGHT);

  private readonly vizRef = viewChild.required<ElementRef<HTMLDivElement>>('vizRef');
  private resizeObserver: ResizeObserver | null = null;

  // The view the line drawing is currently using. Re-fitting on every update makes the
  // line drift about under a distant boat, so the frame is kept until it has actually
  // gone stale - see updateViewFrame.
  private readonly viewFrame = signal<IViewFrame | null>(null);
  /** What the held frame was fitted for; a change here forces a re-fit. */
  private frameKey: string | null = null;
  /**
   * The exact fit the held frame was made from.
   *
   * Drift is measured against this rather than against the held frame itself, because
   * the held frame is deliberately larger than its own fit when the view had to grow -
   * and measuring against it would read that overshoot as drift and shrink the view
   * straight back, which is the oscillation the overshoot exists to stop.
   */
  private frameIdeal: IViewFrame | null = null;

  /**
   * Whether the countdown reached zero with the boat still behind the line.
   *
   * Latched rather than computed, because by the time it is worth showing, the thing it
   * describes is over: the plugin stops publishing timeToStart at the gun, and the
   * widget's own timeout nulls it a few seconds later, so nothing in the live data still
   * says a clean start was made. The start time is left in place at the gun - still
   * running, as far as the plugin is concerned - so nothing about the timer changes
   * there that could end this either.
   *
   * What ends it is the next countdown: a new start time, or a time to start with time
   * still to run. Both say a new start is ahead, which is the only thing that makes the
   * last one stale.
   */
  private readonly startedClean = signal<boolean>(false);
  /** The previous start time, to catch the timer being armed again. See startedClean. */
  private lastStartTime: string | null = null;
  /**
   * Whether the countdown on hand has been seen running. A newly armed timer has not
   * counted down yet, and the time to start still on hand is the last countdown's - a
   * zero that has already been through its gun. See startedClean.
   */
  private countdownSeen = false;
  /**
   * Which side of the line the boat was last seen on, and when. A fix that times out just
   * before the gun takes the boat away at the one moment it is needed, so the gun is
   * judged from here instead - if it is recent enough to still say anything.
   */
  private lastBoatSide: { c: number; at: number } | null = null;

  constructor() {
    // Keep the view frame up to date. Reading the geometry, width and mode here makes
    // this fire on every position update and on any resize.
    effect(() => {
      const geo = this.geometry();
      const width = this.vbWidth();
      const editMode = this.editing();
      const smoothing = this.viewSmoothing();
      untracked(() => this.updateViewFrame(geo, width, editMode, smoothing));
    });

    // Watch the countdown through zero. Reading all three here makes this fire on every
    // countdown tick, every arm and every reset.
    effect(() => {
      const startTime = this.startTime();
      const tts = this.timeToStart();
      const geo = this.geometry();
      untracked(() => {
        const running = startTime != null;
        // Any new start time arms it, not only one after none: after a gun the plugin
        // still holds the old one, so a new time set straight over it never passes
        // through null. An adjust or sync of a running timer moves it too, which is
        // harmless - its next tick is seen with time to run. Adjusting a stopped timer
        // changes only the time to start, and arms nothing.
        const armed = running && startTime !== this.lastStartTime;
        this.lastStartTime = startTime;
        // The zero a timer is armed on top of belongs to the countdown that just ran, so
        // this one is not through its gun until it has been seen with time still to run.
        // Otherwise the first position update after arming - and every one after it,
        // this effect reading the geometry - is taken for a second gun. The two paths
        // arrive separately, so the new start time can land before the new time to start.
        if (armed) this.countdownSeen = false;
        if (tts != null && tts > 0) this.countdownSeen = true;
        // Measured against a line that is gone, the side means nothing.
        if (!geo) this.lastBoatSide = null;
        else if (geo.boat) this.lastBoatSide = { c: geo.boat.c, at: Date.now() };

        if (this.startedClean()) {
          // Only the next countdown ends the state - see startedClean for why the timer
          // stopping does not.
          if (armed || (tts != null && tts > 0)) this.startedClean.set(false);
          return;
        }
        if (!running || !this.countdownSeen) return;
        // The gun: the countdown at zero, which it then stays at with the start time still
        // set. A boat behind the line latches the green at once; one over it is judged
        // again on every fix after, and latches it once it is back behind.
        if (tts != null && tts <= 0) {
          const last = this.lastBoatSide;
          const side = geo?.boat?.c
            ?? (last && Date.now() - last.at <= LAST_FIX_AT_GUN_MS ? last.c : null);
          this.startedClean.set(side != null && side >= 0);
        }
      });
    });

    // Diagnostic trace of the approach. Reading the geometry here makes this fire on
    // every position and countdown update.
    effect(() => {
      const geo = this.geometry();
      untracked(() => this.traceApproach(geo));
    });
  }

  ngAfterViewInit(): void {
    const host = this.vizRef().nativeElement;
    this.resizeObserver = new ResizeObserver(() => this.measure(host));
    this.resizeObserver.observe(host);
    this.measure(host);
  }

  private measure(host: HTMLElement): void {
    const rect = host.getBoundingClientRect();
    if (rect.height <= 0) return;
    // Clamped so an extreme aspect cannot squash the drawing into a sliver.
    const width = Math.round(this.VB_HEIGHT * Math.min(Math.max(rect.width / rect.height, 0.6), 4));
    if (width !== this.vbWidth()) this.vbWidth.set(width);
    if (rect.height !== this.hostHeightPx()) this.hostHeightPx.set(rect.height);
  }

  private readonly geometry = computed<ILineGeometry | null>(() =>
    // The plugin nulls the length when the line is lost, while the end positions keep
    // their last published latitude/longitude, so the length is what says there is a
    // line. Only its presence is used - the drawing measures the line itself.
    this.lineLength() == null ? null : lineGeometry(
      this.latLon(this.portLat(), this.portLon()),
      this.latLon(this.stbLat(), this.stbLon()),
      this.latLon(this.lat(), this.lon())
    ));

  /** The whole drawing, in viewBox units. Null when there is no line to draw. */
  protected readonly scene = computed<IScene | null>(() => {
    const geo = this.geometry();
    // Watching an unset line draws nothing; editing one has to draw something to press.
    if (!geo) return this.editing() ? this.placeholderScene() : null;

    const W = this.vbWidth(), margin = this.VB_MARGIN;
    // The band the drawing gets: below the title, with room above the line kept clear
    // for the length and heading label that sits there.
    const yMin = this.bandYMin();
    const yMax = this.bandYMax(W);
    const editMode = this.editing();
    const boat = geo.boat;

    let scale: number;
    let sx: (a: number) => number;
    let sy: (c: number) => number;

    // Radius of an end's touch target while the ends are being set. It also sets the side
    // inset there, since a target centred on an end runs a radius past it.
    const targetRadius = Math.min(W, this.VB_HEIGHT) * 0.11;
    const ctrl = this.controlSize(W);

    if (editMode) {
      // Working on the line is about hitting the right end, not about where the boat
      // lies, so the line takes the full width and nothing else is drawn. The ends are
      // held clear of the sides by whatever sits around them: a touch target on the
      // setting screen, a ring of adjust buttons on the other.
      const inset = this.mode() === 2
        ? Math.max(ctrl * 1.55, this.END_SIZE_MAX * 0.54 + ctrl) + 4
        : this.mode() === 3
          ? Math.max(margin, this.END_SIZE_MAX * 0.54)
          : Math.max(margin, targetRadius) * 1.3;
      scale = (W - 2 * inset) / Math.max(geo.length, 1);
      sx = (a: number) => W / 2 - (a - geo.length / 2) * scale;
      const editY = this.editLineY(ctrl, targetRadius);
      sy = (c: number) => editY + c * scale;
    } else {
      // The frame the effect is holding, or a fresh fit on the very first paint before
      // that effect has run.
      const frame = this.viewFrame() ?? this.fitFrame(geo, W);
      scale = frame.scale;
      // The port (pin) end draws to the left, so the along axis runs against screen x.
      sx = (a: number) => W / 2 - (a - frame.midA) * scale;
      // The pre-start side draws below the line, so across runs with screen y.
      sy = (c: number) => (yMin + yMax) / 2 + (c - frame.midC) * scale;
    }

    const portX = sx(geo.length), stbX = sx(0), lineY = sy(0);

    // Measured from the two ends, in metres, and converted once by formatDistance - the
    // published length arrives already converted into the display unit, so using it here
    // would convert it a second time. The two agree to within millimetres over a start
    // line anyway, both being derived from the same pair of published end positions.
    const length = geo.length;
    const lineBearingRad = this.lineBearing();
    const lineBearing = lineBearingRad != null
      ? (lineBearingRad * 180 / Math.PI + 360) % 360
      : geo.bearing;
    // The heading worth reporting is the one you sail to cross the line: perpendicular
    // to it, towards the course side. That is 90 degrees clockwise of the line bearing
    // (which runs starboard end -> port end), and in this line-up view it is always
    // straight up the screen.
    const startBearing = (lineBearing + 90) % 360;

    // The trailing arrow says the heading is the way to sail to start - in this line-up
    // view always straight up the screen - so it needs no separate arrowhead.
    const label = `${this.formatDistance(length)} \u00b7 ` +
      `${startBearing.toFixed(0).padStart(3, '0')}\u00b0T\u2191`;
    // Full size unless the label would run off a narrow widget.
    // On the adjust screen the label lifts to the height of the rotate buttons and lives
    // in the gap between them - at the line itself it would be written over by the pair
    // of shorten buttons, which reach much further in. Elsewhere it sits just above the
    // line with the drawing's full width.
    const adjusting = this.mode() === 2;
    const labelRoom = adjusting
      ? Math.max(Math.abs(stbX - portX) - ctrl - 8, W * 0.3)
      : W - 8;
    const font = Math.min(this.LABEL_FONT, labelRoom / (label.length * 0.51));
    const labelY = adjusting
      ? lineY - this.adjusterOffsetY(ctrl) + font * 0.35
      : lineY - font * 0.5;
    // Centred on the line, but held inside the drawing: the line can sit well off centre
    // when the fit has to reach out to a distant boat, and the label is often wider than
    // the line itself.
    const labelHalf = label.length * font * 0.51 / 2;
    const labelX = Math.min(
      Math.max((portX + stbX) / 2, labelHalf + 4), W - labelHalf - 4);

    const scene: IScene = {
      portX, stbX, lineY, ends: this.buildEnds(stbX, lineY, scale),
      labelVisible: this.labelShown(),
      lineStatus: editMode ? null : this.lineStatus(geo),
      portUndefined: false, stbUndefined: false,
      label, labelX, labelY,
      projections: [], boat: null, editEnds: null,
      guides: [], legs: [], gun: null,
      controls: [], nameLabel: null, vmgPad: null,
      labelFont: font,
      // The arrow's angle only means anything beside the line it is measured against.
      wind: editMode ? null : this.buildWind(geo, W)
    };

    if (this.mode() === 1) {
      // A target over each end, larger than the mark it covers: the drawn ends scale
      // with the line and would otherwise be below a usable touch size.
      const size = targetRadius * 2, rx = this.controlRadius(size);
      scene.editEnds = {
        port: { x: portX, y: lineY, size, rx, title: 'Set the port (pin) end here' },
        stb: { x: stbX, y: lineY, size, rx, title: 'Set the starboard (boat) end here' }
      };
      this.buildLinePicker(scene, W, lineY, ctrl, Math.abs(stbX - portX));
    } else if (this.mode() === 3) {
      this.buildVmgPad(scene, W, lineY, ctrl);
    } else if (this.mode() === 2) {
      this.buildEndAdjusters(scene, portX, stbX, lineY, ctrl);
      scene.nameLabel = {
        x: W / 2, y: lineY + ctrl * 0.95, text: this.currentLine(), fontSize: ctrl * 0.55
      };
    } else if (boat) {
      this.buildZone(scene, geo, sx, sy, W, scale);
      this.buildApproach(scene, geo, sx, sy, scale, W);
      this.buildBoat(scene, geo, sx(boat.a), sy(boat.c), boat.c < 0, scale);
    }
    return scene;
  });

  /**
   * Whether the line's length and heading is drawn. Always while the ends are being
   * worked on - there it is the reading that says what the ends you are moving have
   * produced - and otherwise only when the widget is set to show it.
   */
  private readonly labelShown = computed<boolean>(() => this.editing() || this.showLineLabel());

  /**
   * The upper edge of the band the line is drawn in.
   *
   * The label sits above the line, so the band has to keep room for it - and give that
   * room back to the drawing when the label is not being shown, which is the whole point
   * of turning it off.
   */
  private bandYMin(): number {
    return this.VB_TOP_BAND + (this.labelShown() ? this.LABEL_HEADROOM : 8);
  }

  /**
   * The lower edge of the band the line is drawn in.
   *
   * The line and the boat both have to stay clear of the corner controls - the screen
   * button and the countdowns beside it - because between them they are the whole
   * reading, and either one drawn under a button is unreadable at the moment it matters
   * most. The rest may pass behind: a zone guide or a leg label there costs nothing, and
   * the projection is read from the boat outwards.
   */
  private bandYMax(W: number): number {
    const chrome = this.controlSize(W) + 6 + 4;
    return this.VB_HEIGHT - Math.max(this.VB_BOTTOM_MARGIN, chrome);
  }

  /**
   * Where the line sits while it is being worked on.
   *
   * High in the frame, because everything the editing screens put on the line hangs
   * below it - the line picker, the name, the lower half of the ring of adjust buttons -
   * and the space above it does nothing. A third of the way down is the target; the
   * floor is whatever has to fit between the line and the widget's title, which on the
   * adjust screen is the ring of buttons and on the setting screen the end targets. The
   * title band is the one thing the drawing never writes into.
   */
  private editLineY(ctrl: number, targetRadius: number): number {
    // The VMG pad needs the whole frame below the line, so there the line goes as high as
    // its own label allows and nothing else claims the space.
    if (this.mode() === 3) return this.VB_TOP_BAND + 4 + this.LABEL_FONT * 1.25;
    const clearance = this.mode() === 2
      // Half a button, plus the gap out to it.
      ? Math.max(ctrl * 1.45, this.END_SIZE_MAX * 0.42 + ctrl)
      : targetRadius;
    return Math.max(this.VB_HEIGHT * 0.3, this.VB_TOP_BAND + 4 + clearance);
  }

  /**
   * Side of a control, in viewBox units. Sized off the drawing rather than fixed, so a
   * control is the same fraction of a widget whatever the widget's size, and stays a
   * usable target on a phone-sized tile.
   */
  private controlSize(W: number): number {
    return Math.min(Math.max(Math.min(W, this.VB_HEIGHT) * 0.13, 22), 46);
  }

  /**
   * Corner radius of a control, in viewBox units, working out to the same 12 CSS pixels
   * the other racer widgets round their buttons by.
   *
   * The conversion is the point: a viewBox unit is the drawing's rendered height over
   * VB_HEIGHT, so a radius fixed in units grows with the widget and a big tile ends up
   * with pills. This is the one measurement here that is about the screen rather than
   * about the drawing, so it is the one that has to be converted back.
   */
  private controlRadius(h: number): number {
    const unitsPerPixel = this.VB_HEIGHT / Math.max(this.hostHeightPx(), 1);
    return Math.min(12 * unitsPerPixel, h * 0.5);
  }

  /** A chevron pointing left, right, up or down, centred on (0,0) at the given size. */
  private chevron(dir: 'left' | 'right' | 'up' | 'down', size: number): string {
    const a = size * 0.26, b = size * 0.16;
    switch (dir) {
      case 'left': return `M${b},${-a} L${-b},0 L${b},${a}`;
      case 'right': return `M${-b},${-a} L${b},0 L${-b},${a}`;
      case 'up': return `M${-a},${b} L0,${-b} L${a},${b}`;
      default: return `M${-a},${-b} L0,${b} L${a},${-b}`;
    }
  }

  /**
   * The three dots of the mode button, centred on (0,0). Stacked vertically, matching the
   * vertical ellipsis the other racer widgets' mode buttons carry.
   */
  private ellipsisGlyph(size: number): string {
    const r = size * 0.07, gap = size * 0.22;
    return [-gap, 0, gap].map(dy =>
      `M${-r},${dy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`).join(' ');
  }

  /**
   * Browse the named lines the plugin knows, under the line itself.
   *
   * The line in use is a label, because pressing it would do nothing; any other is a
   * button, because pressing it is how you switch to it. So the control says what it
   * will do by whether it looks pressable, and the row does not change size as you
   * step through the names.
   */
  private buildLinePicker(scene: IScene, W: number, lineY: number, ctrl: number,
    lineWidth: number): void {
    const isCurrent = this.browsedLine() === this.currentLine();
    // Sized for the longest name there is, so stepping through them does not walk the
    // prev and next buttons along the screen under the finger pressing them.
    const longest = this.lines().reduce((a, b) => (b.length > a.length ? b : a), '');
    const gap = ctrl * 0.62;
    // The row is never wider than the line it sits under: past that it stops reading as
    // part of the line and starts running out of the drawing.
    const roomForName = Math.max(ctrl * 2.4, lineWidth - 2 * (gap + ctrl / 2));
    let font = ctrl * 0.5;
    let nameW = Math.max(ctrl * 2.4, longest.length * font * 0.62 + ctrl * 0.6);
    if (nameW > roomForName) {
      // Shrink to fit first, down to the point where it stops being readable...
      font = Math.max(ctrl * 0.3, font * roomForName / nameW);
      nameW = roomForName;
    }
    // ...and only then take characters off the end. The epsilon matters: the width above
    // was computed from the longest name, so that name divides back to its own length -
    // give or take the last bit of a float, which would otherwise clip a character off
    // the very name the row was sized for.
    const fits = Math.max(1, Math.floor((nameW - ctrl * 0.6) / (font * 0.62) + 1e-6));
    const full = this.browsedLine();
    const name = this.truncate(full, fits);
    const y = lineY + ctrl * 1.5;
    const step = nameW / 2 + gap;

    scene.controls.push({
      x: W / 2 - step, y, w: ctrl, h: ctrl, rx: this.controlRadius(ctrl),
      glyph: this.chevron('left', ctrl), text: null, fontSize: 0,
      title: 'Show the previous named line', action: { kind: 'browse', step: -1 }, accent: false
    });
    scene.controls.push({
      x: W / 2 + step, y, w: ctrl, h: ctrl, rx: this.controlRadius(ctrl),
      glyph: this.chevron('right', ctrl), text: null, fontSize: 0,
      title: 'Show the next named line', action: { kind: 'browse', step: 1 }, accent: false
    });

    if (isCurrent) {
      scene.nameLabel = { x: W / 2, y: y + font * 0.35, text: name, fontSize: font };
    } else {
      scene.controls.push({
        x: W / 2, y, w: nameW, h: ctrl, rx: this.controlRadius(ctrl),
        glyph: null, text: name, fontSize: font,
        // The title carries the whole name even when the button cannot show it.
        title: `Use the ${full} line`, action: { kind: 'choose' }, accent: true
      });
    }
  }

  /** A name cut to fit, with an ellipsis standing for what was taken off. */
  private truncate(text: string, fits: number): string {
    return text.length <= fits ? text : text.slice(0, Math.max(1, fits - 1)) + '\u2026';
  }

  /**
   * The four adjustments on each end: out and in along the line, and the two directions
   * of rotation about the other end.
   *
   * Laid out around the end they act on, so there is no labelling to read - the button
   * on the outboard side moves that end outboard. The rotation sense per end matches the
   * Start Line Setup widget's own buttons, so the two widgets do not disagree about which
   * way up is.
   */
  private buildEndAdjusters(scene: IScene, portX: number, stbX: number, lineY: number,
    ctrl: number): void {
    const STEP_METRES = 5;
    const STEP_RADIANS = Math.PI / 180;
    // Close in to the mark each one acts on - proximity is what says which end a button
    // belongs to - but clear of the symbol itself. The committee boat is the larger of
    // the two and is drawn wider than it is tall, so the sideways buttons stand off
    // further than the ones above and below. Taken at the end marks' largest drawn size,
    // which is what they reach at the full-width layout these screens use.
    const offX = Math.max(ctrl * 0.95, this.END_SIZE_MAX * 0.54 + ctrl * 0.5 + 3);
    const offY = this.adjusterOffsetY(ctrl);

    const ends: { end: 'port' | 'stb'; x: number; outward: 'left' | 'right'; up: number }[] = [
      // The port (pin) end draws on the left, so outboard for it is to the left; a press
      // of its up button rotates the line the way the setup widget's port arrow does.
      { end: 'port', x: portX, outward: 'left', up: STEP_RADIANS },
      { end: 'stb', x: stbX, outward: 'right', up: -STEP_RADIANS }
    ];
    const named = { port: 'port (pin)', stb: 'starboard (boat)' };

    for (const e of ends) {
      const outSign = e.outward === 'left' ? -1 : 1;
      const push = (dx: number, dy: number, dir: 'left' | 'right' | 'up' | 'down',
        title: string, action: TLineViewAction) =>
        scene.controls.push({
          x: e.x + dx, y: lineY + dy, w: ctrl, h: ctrl, rx: this.controlRadius(ctrl),
          glyph: this.chevron(dir, ctrl), text: null, fontSize: 0,
          title, action, accent: false
        });

      push(outSign * offX, 0, e.outward,
        `Lengthen the line by ${STEP_METRES}m at the ${named[e.end]} end`,
        { kind: 'adjust', end: e.end, delta: STEP_METRES, rotate: 0 });
      push(-outSign * offX, 0, e.outward === 'left' ? 'right' : 'left',
        `Shorten the line by ${STEP_METRES}m at the ${named[e.end]} end`,
        { kind: 'adjust', end: e.end, delta: -STEP_METRES, rotate: 0 });
      push(0, -offY, 'up',
        `Rotate the line by moving the ${named[e.end]} end up`,
        { kind: 'adjust', end: e.end, delta: 0, rotate: e.up });
      push(0, offY, 'down',
        `Rotate the line by moving the ${named[e.end]} end down`,
        { kind: 'adjust', end: e.end, delta: 0, rotate: -e.up });
    }
  }

  /** How far above and below its end the rotate buttons sit, clear of the end symbol. */
  private adjusterOffsetY(ctrl: number): number {
    return Math.max(ctrl * 0.95, this.END_SIZE_MAX * 0.42 + ctrl * 0.5 + 3);
  }

  /**
   * The best VMGs, arranged around a four-way arrow.
   *
   * Nothing but the numbers and the arrow: which VMG is which is said by where it sits
   * relative to the drawing above - across the line to the course side at the top, back
   * across it at the bottom, along it towards each end on the side that end is drawn on -
   * and the arrow is what makes that readable without a word of labelling. The controls
   * that change them live in the bottom row, out of the way of the reading.
   */
  private buildVmgPad(scene: IScene, W: number, lineY: number, ctrl: number): void {
    const unit = this.vmgUnit();
    const valueFont = ctrl * 0.9;
    const captionFont = ctrl * 0.42;
    // Four characters of room, so a two-digit VMG does not crowd the arrow.
    const valueW = 4 * valueFont * 0.58;
    const arrow = ctrl * 1.5;

    // The band between the line and the bottom row, less the caption's own line. The rows
    // are spaced to sit inside it whatever is left, so the top value cannot climb into
    // the line above it - which is where it went when the gap was sized on its own.
    const top = lineY + ctrl * 0.4;
    const bottom = this.VB_HEIGHT - this.controlSize(W) - 10 - captionFont * 1.4;
    const cy = (top + bottom) / 2;
    const rowGap = Math.max(
      Math.min(arrow * 0.62 + valueFont * 0.8, (bottom - top) / 2 - valueFont * 0.5),
      valueFont * 0.7);
    const colGap = Math.min(arrow * 0.62 + valueW / 2, (W - valueW) / 2 - 4);

    const selected = this.selectedVmg();
    const pad: ISceneVmgPad = {
      values: [],
      compass: { x: W / 2, y: cy, path: this.fourWayGlyph(arrow) },
      caption: {
        x: W / 2, y: bottom + captionFont,
        text: `Best VMG in ${unit}`, fontSize: captionFont
      }
    };

    const place = (name: TVmgName, x: number, y: number) => {
      const best = this.bestVmg()[name];
      const value = best == null ? null : this.units.convertToUnit(unit, best);
      pad.values.push({
        x, y: y + valueFont * 0.35, fontSize: valueFont, title: VMG_TITLE[name],
        text: value == null ? '--' : value.toFixed(1),
        selected: name === selected
      });
    };

    place('toCourseSide', W / 2, cy - rowGap);
    place('toPortEnd', W / 2 - colGap, cy);
    place('toStbEnd', W / 2 + colGap, cy);
    place('fromCourseSide', W / 2, cy + rowGap);
    scene.vmgPad = pad;
  }

  /** A four-way arrow centred on (0,0): the four directions the VMGs are read in. */
  private fourWayGlyph(size: number): string {
    const r = size / 2, head = size * 0.16, stem = size * 0.05;
    const arm = (dx: number, dy: number) => {
      // Along the arm, and across it.
      const ax = dx * r, ay = dy * r;
      const px = -dy, py = dx;
      const bx = dx * (r - head), by = dy * (r - head);
      return `M${ax},${ay} L${bx + px * head},${by + py * head} `
        + `L${bx + px * stem},${by + py * stem} L${px * stem},${py * stem} `
        + `L${-px * stem},${-py * stem} L${bx - px * stem},${by - py * stem} `
        + `L${bx - px * head},${by - py * head} Z`;
    };
    return [arm(0, -1), arm(0, 1), arm(-1, 0), arm(1, 0)].join(' ');
  }

  /** A minus and a plus, centred on (0,0), drawn like the chevrons. */
  private minusGlyph(size: number): string {
    const a = size * 0.24;
    return `M${-a},0 L${a},0`;
  }

  private plusGlyph(size: number): string {
    const a = size * 0.24;
    return `M${-a},0 L${a},0 M0,${-a} L0,${a}`;
  }

  /**
   * The bottom-left corner: the button that cycles the three screens, and - while
   * watching - the countdowns beside it.
   *
   * They sit bottom left because the boat comes in from the bottom right far more often
   * than not, and they are drawn under everything else so that when it does cross them
   * the boat stays the thing you can see.
   */
  protected readonly chrome = computed<{ controls: ISceneButton[]; readouts: ISceneReadout[] }>(() => {
    const W = this.vbWidth();
    const full = this.controlSize(W);
    // What this screen's row needs, in multiples of a control: the screen button, and on
    // the VMG screen a Reset, a VMG and - once one is chosen - the pair that adjusts it.
    // The row comes down as a whole when it will not fit, rather than running off the
    // edge or overlapping itself.
    const parts = this.mode() === 3
      ? 1.5 + 0.25 + 1.9 + 0.25 + 1.5
        + (this.selectedVmg() ? 0.25 + 1 + 0.25 + 1 : 0.25 + 1.9)
      : 1.5;
    const needed = full * parts + 12;
    const ctrl = needed <= W ? full : Math.max(full * (W - 12) / (needed - 12), 14);
    const y = this.VB_HEIGHT - ctrl * 0.5 - 6;
    const modeW = ctrl * 1.5;
    const left = 6;
    const controls: ISceneButton[] = [{
      x: left + modeW / 2, y, w: modeW, h: ctrl, rx: this.controlRadius(ctrl),
      glyph: this.ellipsisGlyph(ctrl), text: null, fontSize: 0,
      title: 'Next screen: watch the line, set its ends, adjust them',
      action: { kind: 'mode' }, accent: true
    }];

    // On the VMG screen the row carries the controls that change them: a Reset, a VMG
    // button that steps the selection through the four, and - once one is selected - the
    // pair that adjusts it. Keeping them here leaves the reading above uncluttered, and
    // puts every control on one line under the thumb.
    if (this.mode() === 3) {
      const selected = this.selectedVmg();
      let x = left + modeW + ctrl * 0.25;
      const wordButton = (text: string, w: number, title: string,
        action: TLineViewAction, accent: boolean) => {
        controls.push({
          x: x + w / 2, y, w, h: ctrl, rx: this.controlRadius(ctrl),
          glyph: null, text, fontSize: Math.min(ctrl * 0.5, w / (text.length * 0.62)),
          title, action, accent
        });
        x += w + ctrl * 0.25;
      };
      wordButton('Reset', ctrl * 1.9, 'Clear every manual VMG adjustment',
        { kind: 'vmgReset' }, false);
      wordButton('VMG', ctrl * 1.5,
        selected ? `Adjusting ${VMG_TITLE[selected]}; press for the next`
          : 'Choose a best VMG to adjust',
        { kind: 'vmgNext' }, !!selected);

      if (!selected) {
        // Only offered with nothing selected: it throws away every sample the plugin has
        // collected, which is a different thing from Reset dropping the hand adjustments
        // on top of them, and not something to have under the thumb while stepping one
        // VMG up and down.
        wordButton('Clear', ctrl * 1.9,
          'Throw away the collected VMG samples and start again', { kind: 'vmgClear' }, false);
      } else {
        const perBaseUnit = this.units.convertToUnit(this.vmgUnit(), 1) || 1;
        const step = 0.1 / perBaseUnit;
        const name = VMG_TITLE[selected].charAt(0).toLowerCase() + VMG_TITLE[selected].slice(1);
        for (const [glyph, delta, verb] of [
          [this.minusGlyph(ctrl), -step, 'Reduce'] as const,
          [this.plusGlyph(ctrl), step, 'Increase'] as const
        ]) {
          controls.push({
            x: x + ctrl / 2, y, w: ctrl, h: ctrl, rx: this.controlRadius(ctrl),
            glyph, text: null, fontSize: 0,
            title: `${verb} the ${name}`,
            action: { kind: 'vmgStep', deltaMs: delta }, accent: false
          });
          x += ctrl + ctrl * 0.25;
        }
      }
    }

    const readouts: ISceneReadout[] = [];
    if (this.mode() === 0) {
      const valueSize = ctrl * 0.85;
      const captionSize = ctrl * 0.42;
      let x = left + modeW + ctrl * 0.5;
      const add = (caption: string, seconds: number | null) => {
        const value = this.formatCountdown(seconds);
        const valueX = x + captionSize * caption.length * 0.62 + captionSize * 0.5;
        readouts.push({ x, valueX, y: y + valueSize * 0.36, caption, value, captionSize, valueSize });
        // Past the value, then a gap before the next pair.
        x = valueX + value.length * valueSize * 0.58 + ctrl * 0.45;
      };
      if (this.showTimeToLine()) add('TTL', this.timeToLine());
      if (this.showTimeToBurn()) add('TTB', this.timeToBurn());
    }
    return { controls, readouts };
  });

  /** A countdown as m:ss, or h:mm:ss once there is an hour of it. */
  private formatCountdown(seconds: number | null): string {
    if (seconds == null || !Number.isFinite(seconds)) return '--:--';
    const negative = seconds < 0;
    const v = Math.floor(Math.abs(seconds));
    const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
    const body = h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
      : `${m}:${sec.toString().padStart(2, '0')}`;
    return (negative ? '-' : '') + body;
  }

  /**
   * How the line reads: red across the line, green once a start has been made from
   * behind it.
   *
   * Being over the line is a fact about where the boat is, so red needs no countdown
   * behind it. The one case where crossing is not a problem is a start already made
   * cleanly, and that is precisely what the latch records - so it is tested first and
   * takes the line green through everything that follows, until the timer is reset.
   */
  private lineStatus(geo: ILineGeometry): IScene['lineStatus'] {
    if (this.startedClean()) return 'started';
    return geo.boat && geo.boat.c < 0 ? 'ocs' : null;
  }

  /**
   * The line to edit when there is not one yet.
   *
   * With no line set there is nothing to draw and nothing to press, so edit mode would
   * open on a blank frame - exactly when the ends most need setting. This lays a line of
   * no particular length across the frame purely to carry the two targets, and greys both
   * ends to say that neither is a position yet.
   *
   * Both ends grey together because that is the whole of what the plugin says. When
   * either waypoint is missing it publishes startLinePort, startLineStb and the length
   * as null as a set, so an end that does exist is indistinguishable from one that does
   * not; the scene keeps the flags per end for a plugin that one day distinguishes them.
   */
  private placeholderScene(): IScene {
    const W = this.vbWidth();
    // The same targets edit mode uses on a real line, at the same inset: a target centred
    // on an end runs a radius past it and has to stay in frame.
    const radius = Math.min(W, this.VB_HEIGHT) * 0.11;
    const lineY = this.editLineY(this.controlSize(W), radius);
    const inset = Math.max(this.VB_MARGIN, radius);
    // Port (pin) to the left and starboard (committee boat) to the right, as ever.
    const portX = inset, stbX = W - inset;

    const label = 'Line not set';
    const font = Math.min(this.LABEL_FONT, (W - 8) / (label.length * 0.51));

    return {
      portX, stbX, lineY,
      ends: this.buildEnds(stbX, lineY, (stbX - portX) / this.PLACEHOLDER_METRES),
      labelVisible: true,
      lineStatus: null,
      portUndefined: true, stbUndefined: true,
      label, labelX: W / 2, labelY: lineY - font * 0.5, labelFont: font,
      projections: [], boat: null, guides: [], legs: [], gun: null, wind: null,
      controls: [], nameLabel: null, vmgPad: null,
      editEnds: {
        port: {
          x: portX, y: lineY, size: radius * 2, rx: this.controlRadius(radius * 2),
          title: 'Set the port (pin) end here'
        },
        stb: {
          x: stbX, y: lineY, size: radius * 2, rx: this.controlRadius(radius * 2),
          title: 'Set the starboard (boat) end here'
        }
      }
    };
  }

  /**
   * Decide whether the line drawing keeps the view it has or takes a fresh one.
   *
   * Re-fitting on every position update means the scale changes every time the boat
   * moves, so the line slides and breathes under a boat that appears to stand still -
   * worst when approaching from a distance, where each update is a large fraction of
   * the span being fitted. Holding the frame inverts that: the line stays put and the
   * boat visibly closes on it.
   *
   * The trigger is how far the drawing has gone out of true rather than a count of
   * updates, because the need is not spread evenly over an approach: far out, an update
   * moves the boat a tiny fraction of the span and a re-fit would change nothing
   * visible, while closing in the same update is a large fraction. Counting updates
   * therefore re-fits too often early and too coarsely late, and its meaning changes
   * with the position source's update rate. Drift is indifferent to all of that.
   *
   * The frame is replaced when any of these is true:
   *  - there is no frame yet, or the drawing was resized, or the line itself changed
   *  - re-fitting now would move the drawing further than `viewSmoothing` percent
   *  - the boat would be drawn outside the viewBox under it, which must never wait
   *
   * @param smoothing Percent of the drawing's height the view may drift; 0 re-fits on
   *   every update.
   */
  private updateViewFrame(geo: ILineGeometry | null, W: number, editMode: boolean,
    smoothing: number | undefined): void {
    // Edit mode lays the line out for itself and never uses a fitted frame.
    if (!geo || editMode) {
      this.viewFrame.set(null);
      this.frameKey = null;
      this.frameIdeal = null;
      return;
    }

    // A resize, or an edit to the line itself, invalidates the frame outright.
    const key = `${W}|${geo.length.toFixed(1)}`;
    const current = this.viewFrame();
    const tolerance = Math.max(0, smoothing ?? 25) / 100;

    // A lost fix - the position timing out - takes the boat away, not the line. Re-fitting
    // for the line alone would zoom out to it and straight back in when the fix returns,
    // so the frame the boat was last seen in is held until it does.
    if (!geo.boat && current && key === this.frameKey) return;

    const ideal = this.fitFrame(geo, W);
    if (!current || key !== this.frameKey
      || this.frameDrift(this.frameIdeal ?? current, ideal, geo, W) > tolerance
      || !this.lineFitsIn(current, W)
      || !this.boatFitsIn(current, geo, W)) {
      // Growing the view to exactly fit leaves it fitting exactly, so the next update
      // pushes back out of it and it re-fits again - a stutter every second or two on an
      // approach. Overshooting a growth by the smoothing tolerance buys that many more
      // updates before the next one is needed. Shrinking is not overshot: a view that
      // shrank past its content would have to grow straight back.
      const grow = current && ideal.scale < current.scale;
      this.viewFrame.set(grow ? { ...ideal, scale: ideal.scale / (1 + tolerance) } : ideal);
      this.frameIdeal = ideal;
      this.frameKey = key;
    }
  }

  /**
   * How far re-fitting now would shift the drawing, as a fraction of its height.
   *
   * Measured at the two things the fit is built around and the eye is actually on: the
   * end being kept in frame, and the boat. That catches both a change of scale and a
   * pure pan - the latter happens whenever the across axis is the binding one and the
   * boat works its way along the line. The far end is deliberately not measured: it can
   * be a long way outside the frame, where a small change of scale moves it hugely and
   * would re-fit a drawing that has not visibly moved.
   */
  private frameDrift(held: IViewFrame, ideal: IViewFrame, geo: ILineGeometry, W: number): number {
    const yMin = this.bandYMin();
    const yMax = this.bandYMax(W);
    const at = (frame: IViewFrame, a: number) => ({
      x: W / 2 - (a - frame.midA) * frame.scale,
      y: (yMin + yMax) / 2 - frame.midC * frame.scale
    });
    const boat = geo.boat;
    const marks = boat ? [this.nearestEnd(geo, boat.a), boat.a] : [0, geo.length];
    let worst = 0;
    for (const a of marks) {
      const from = at(held, a), to = at(ideal, a);
      worst = Math.max(worst, Math.hypot(from.x - to.x, from.y - to.y));
    }
    return worst / Math.max(yMax - yMin, 1);
  }

  /**
   * Fit the boat and the line, with the boat's drawn size allowed for.
   *
   * Only one end of the line has to be in frame. Holding both caps how far the drawing
   * can zoom in, which is exactly backwards: the closer the boat gets to an end, the
   * more the detail near that end is what is being read, and the less the far end - a
   * hundred metres of empty water away - is worth the scale it costs. So the along axis
   * is fitted to the boat and its nearer end, and the far one is allowed to leave.
   *
   * It does not let the drawing zoom without limit: showing a usable run of the line
   * comes before zooming in, and LINE_IN_FRAME_LENGTHS boat lengths of it stay in frame
   * whatever that costs in scale. A line shorter than that is shown whole; a longer one
   * is not chased, which is what keeps a long line from zooming the boat away to nothing.
   *
   * What the far end leaves for is the scale it would cost - so when it costs nothing it
   * stays. Standing off the line, the across axis is what sets the scale and the width is
   * left holding far more along-distance than the span asked of it; centring that span
   * then draws empty water either side of it while the line itself runs off the edge. The
   * spare width goes to the line instead. See the growth below.
   */
  private fitFrame(geo: ILineGeometry, W: number): IViewFrame {
    const margin = this.VB_MARGIN;
    const yMin = this.bandYMin();
    const yMax = this.bandYMax(W);
    const boat = geo.boat;
    // The boat is drawn aft of its position, not at it, so the fit has to hold the whole
    // hull rather than just the fix or the transom gets clipped at the edge.
    const pad = boat ? this.boatReach() : 0;

    // With no boat there is nothing to zoom towards, so the whole line is the subject.
    const ends = boat ? [this.nearestEnd(geo, boat.a)] : [0, geo.length];
    let minA = Math.min(...ends, boat ? boat.a - pad : 0);
    let maxA = Math.max(...ends, boat ? boat.a + pad : geo.length);
    const minC = Math.min(0, boat ? boat.c - pad : 0);
    const maxC = Math.max(0, boat ? boat.c + pad : 0);

    // Keep a usable run of the line itself in frame. Measured on the line rather than on
    // the span, because the span is mostly open water when the boat is standing off, and
    // a fit that satisfied the floor with water would still show a stub of line.
    const wanted = Math.min(this.LINE_IN_FRAME_LENGTHS * this.boatReach(), geo.length);
    const visibleLo = Math.max(minA, 0), visibleHi = Math.min(maxA, geo.length);
    if (visibleHi - visibleLo < wanted) {
      // Grown about what is already showing, then slid back inside the line's own ends:
      // there is no point reserving room past them, where there is no line to see.
      const middle = (visibleLo + visibleHi) / 2;
      let lo = middle - wanted / 2, hi = middle + wanted / 2;
      if (lo < 0) { hi -= lo; lo = 0; }
      if (hi > geo.length) { lo = Math.max(0, lo - (hi - geo.length)); hi = geo.length; }
      minA = Math.min(minA, lo);
      maxA = Math.max(maxA, hi);
    }

    // Keep the across axis from collapsing when the boat is sitting on the line.
    const spanA = Math.max(maxA - minA, 1);
    const spanC = Math.max(maxC - minC, spanA * 0.35);
    const scale = Math.min((W - 2 * margin) / spanA, (yMax - yMin) / spanC);

    // Spend whatever width the chosen scale left over on the line, by growing the window
    // towards the far end - as far as the room reaches and no further than the end
    // itself, there being nothing past it to show. The scale is deliberately not
    // recomputed from the grown window: this is room already bought and standing empty,
    // not a reason to zoom out, so the boat and its end are drawn exactly as large as
    // they were and the line simply reaches further across the frame.
    //
    // It needs no threshold and no state of its own. Closing on the line shrinks the
    // across span, which raises the scale, which shrinks the spare room - so the window
    // retracts of its own accord, and by the time the along axis is the binding one
    // there is no spare left and this does nothing at all.
    if (boat) {
      const spare = (W - 2 * margin) / scale - (maxA - minA);
      if (spare > 0) {
        const far = this.nearestEnd(geo, boat.a) === 0 ? geo.length : 0;
        if (far > maxA) maxA = Math.min(far, maxA + spare);
        else if (far < minA) minA = Math.max(far, minA - spare);
      }
    }

    return {
      scale,
      midA: (minA + maxA) / 2,
      midC: (minC + maxC) / 2
    };
  }

  /**
   * The end of the line the boat is nearer to, as a distance along the line. The one the
   * drawing keeps in frame, and the one drift is measured at.
   */
  private nearestEnd(geo: ILineGeometry, a: number): number {
    return Math.abs(a) <= Math.abs(a - geo.length) ? 0 : geo.length;
  }

  /**
   * How far the drawn boat reaches from its fix, in metres.
   *
   * The fix is the bow and the hull hangs aft of it, so the farthest part of the boat
   * from the fix is the transom, a full length away - and it can lie in any direction,
   * the heading being free. A full boat length in every direction is therefore what the
   * fit has to hold. It is a model quantity, independent of the scale.
   */
  private boatReach(): number {
    return this.boatLength() ?? this.DEFAULT_BOAT_METRES;
  }

  /**
   * Whether the line itself is still clear of the bottom of the drawing under this
   * frame. The fit keeps it clear, but a frame held through several updates can drift,
   * and a line sitting on the bottom edge reads as one about to disappear.
   */
  private lineFitsIn(frame: IViewFrame, W: number): boolean {
    const yMin = this.bandYMin();
    const yMax = this.bandYMax(W);
    const lineY = (yMin + yMax) / 2 - frame.midC * frame.scale;
    return lineY >= yMin && lineY <= yMax;
  }

  /**
   * Whether the boat's whole outline still lands inside the drawing under this frame.
   *
   * Bounded below by the same edge as the line, so the boat never disappears behind the
   * corner controls either: a boat drawn under a button is a boat you cannot place.
   */
  private boatFitsIn(frame: IViewFrame, geo: ILineGeometry, W: number): boolean {
    const boat = geo.boat;
    if (!boat) return true;
    const yMin = this.bandYMin();
    const yMax = this.bandYMax(W);
    const bx = W / 2 - (boat.a - frame.midA) * frame.scale;
    const by = (yMin + yMax) / 2 + (boat.c - frame.midC) * frame.scale;
    const radius = this.boatReach() * frame.scale;
    return bx - radius >= 2 && bx + radius <= W - 2
      && by - radius >= this.VB_TOP_BAND && by + radius <= yMax;
  }

  /**
   * The line's own extensions, and the 45 degree wedge off each end. Together these
   * bound the start zone: inside it the line is closed straight across, outside it the
   * boat must first run along the line to get in. The plugin decides its legs on exactly
   * this boundary, so drawing it is what makes the approach below explicable.
   */
  private buildZone(scene: IScene, geo: ILineGeometry, sx: (a: number) => number,
    sy: (c: number) => number, W: number, scale: number): void {
    // Far enough that every guide leaves the drawing rather than stopping inside it.
    const reach = (W + this.VB_HEIGHT) / Math.max(scale, 1e-6);
    const L = geo.length;
    const add = (a1: number, c1: number, a2: number, c2: number) =>
      scene.guides.push({ x1: sx(a1), y1: sy(c1), x2: sx(a2), y2: sy(c2) });

    // The line carried on past each end.
    add(0, 0, -reach, 0);
    add(L, 0, L + reach, 0);
    // The wedges: 45 degrees off each end, on both sides of the line.
    add(0, 0, -reach, reach);
    add(0, 0, -reach, -reach);
    add(L, 0, L + reach, reach);
    add(L, 0, L + reach, -reach);
  }

  /**
   * The approach the time to line is actually computed over, drawn as dimension lines.
   *
   * The plugin does not sail a bearing to work out the time to line. It takes two legs:
   * outside the start zone, the distance along the line needed to enter the zone divided
   * by the best VMG in that direction, plus the perpendicular distance to the line
   * divided by the best VMG across it. Drawing a straight line on the course that
   * happened to record the best sample - which is what the faint line used to be - shows
   * a different quantity from the number beside it, which is why it read as nothing in
   * particular.
   *
   * So this draws the legs themselves, at their true lengths, with a mark showing how far
   * along them the boat gets by the gun. Nobody sails parallel to the line and then turns
   * ninety degrees, so the legs are styled as dimension lines: they are a measurement,
   * not a course.
   */
  private buildApproach(scene: IScene, geo: ILineGeometry, sx: (a: number) => number,
    sy: (c: number) => number, scale: number, W: number): void {
    const boat = geo.boat;
    if (!boat) return;
    const L = geo.length, a = boat.a, c = boat.c;
    const ocs = c < 0;
    const across = Math.abs(c);

    // How far past an end the boat lies, and which way it would have to run to get back.
    let overshoot = 0, beyondPort = false;
    if (a > L) { overshoot = a - L; beyondPort = true; } else if (a < 0) { overshoot = -a; }

    // Inside the 45 degree wedge the zone leg vanishes: the boat can close straight
    // across. Outside it, the corner sits where the wedge meets the boat's own offset.
    const toZone = Math.max(0, overshoot - across);
    const cornerA = toZone > 0 ? (beyondPort ? L + across : -across) : a;

    // The VMGs the plugin would use for these legs: the collected best, or whatever the
    // boat is achieving right now if that is better - which is what computeTimeToLine
    // does, so the drawing matches the published time rather than undercutting it.
    const parallelName: TVmgName = beyondPort ? 'toStbEnd' : 'toPortEnd';
    const normalName: TVmgName = ocs ? 'fromCourseSide' : 'toCourseSide';
    // Prefer what the plugin says it used; fall back to deriving it the same way when
    // running against a version that does not publish it.
    const parallel = this.effVmgAlongLine() ?? this.deriveEffectiveVmg(parallelName, geo.bearing);
    const normal = this.effVmgToLine() ?? this.deriveEffectiveVmg(normalName, geo.bearing);

    // Each leg is labelled with how far it is - a dimension states a distance - while the
    // VMG it would be sailed at stays on the hover text.
    //
    // The two labels meet at the corner, so each is put on the side of its own leg that
    // faces away from the other one: the across label on the far side of its rule from the
    // zone leg, the zone label on the far side of its rule from the across leg. Which way
    // each leg runs from the corner, on screen (0 when there is no such leg):
    const zoneLabel = this.formatDistance(toZone);
    const acrossLabel = this.formatDistance(across);
    const towardsBoat = toZone > 0 ? Math.sign(sx(a) - sx(cornerA)) : 0;
    const towardsLine = across > 0 ? Math.sign(sy(0) - sy(c)) : 0;
    // A short leg has no room for its label in a break in the rule and takes it outside,
    // past the corner. When both are short both labels want that same outside quarter,
    // so the zone label moves round to the line's side of its rule: the across label has
    // left the side of its own rule for the corner, and that is the room it frees.
    const zoneShort = !this.legRoomy(Math.abs(sx(a) - sx(cornerA)), zoneLabel);
    const acrossShort = !this.legRoomy(Math.abs(sy(0) - sy(c)), acrossLabel);
    const zoneSide = towardsLine === 0 ? undefined
      : zoneShort && acrossShort ? towardsLine : -towardsLine;
    const acrossSide = towardsBoat === 0 ? undefined : -towardsBoat;

    if (toZone > 0) {
      scene.legs.push(this.buildLeg(
        sx(a), sy(c), sx(cornerA), sy(c), true, zoneLabel,
        `Along the line to the start zone at `
        + `${VMG_TITLE[parallelName].replace('Best VMG ', '')}`, W, zoneSide));
    }
    // Only a leg with another after it leads; a lone leg has nothing to be ordered against.
    if (toZone > 0 && across > 0) scene.legs[0].leading = true;
    if (across > 0) {
      scene.legs.push(this.buildLeg(
        sx(cornerA), sy(c), sx(cornerA), sy(0), false, acrossLabel,
        `Across to the line at `
        + `${VMG_TITLE[normalName].replace('Best VMG ', '')}`, W, acrossSide));
    }
    if (scene.legs.length === 2) this.separateLegLabels(scene.legs[0], scene.legs[1], towardsLine);

    // Where the boat gets to by the gun, walked along those legs at those VMGs. Short of
    // the line is late, past it is over early - the same reading as the COG projection,
    // but as a position along a route rather than the tip of a floating bearing.
    const tts = this.timeToStart();
    if (!this.timerRunning() || tts == null || tts <= 0) return;
    // A leg with no VMG behind it costs no time, which is what computeTimeToLine does:
    // it simply omits that term. Treating it as unreachable instead stalled the mark on
    // the boat, so it never showed the across leg at all.
    const alongTime = parallel > 0 ? toZone / parallel : 0;
    let gunA: number, gunC: number;
    if (tts <= alongTime) {
      const run = parallel * tts;
      gunA = beyondPort ? a - run : a + run;
      gunC = c;
    } else {
      if (!(normal > 0)) return;
      // Clamped a little past the line: a long countdown runs the mark off the drawing.
      const run = Math.min(normal * (tts - alongTime), across + 400 / Math.max(scale, 1e-6));
      gunA = cornerA;
      gunC = ocs ? c + run : c - run;
    }
    scene.gun = {
      x: sx(gunA), y: sy(gunC),
      title: 'Where you reach at the gun, sailing these legs at these VMGs'
    };
  }

  /**
   * Whether a leg this long has room for its label in a break in the rule. The along-line
   * leg is often very short, the boat being just outside the wedge.
   */
  private legRoomy(length: number, label: string): boolean {
    return length > label.length * this.LEG_FONT * 0.6 + 16;
  }

  /**
   * One leg of the approach, as a dimension line with end ticks and a labelled break.
   *
   * @param side Which side of the rule the label goes: for a horizontal leg -1 above and
   *   1 below, for a vertical one -1 left and 1 right. Left out, a horizontal label goes
   *   above a roomy leg and below a short one, and a vertical label to the right.
   */
  private buildLeg(x1: number, y1: number, x2: number, y2: number, horizontal: boolean,
    label: string, title: string, W: number, side?: number): ISceneLeg {
    const tick = 5;
    const ticks = horizontal
      ? `M${x1},${y1 - tick} L${x1},${y1 + tick} M${x2},${y2 - tick} L${x2},${y2 + tick}`
      : `M${x1 - tick},${y1} L${x1 + tick},${y1} M${x2 - tick},${y2} L${x2 + tick},${y2}`;

    // Every offset below is a fraction of the label's own size, so changing LEG_FONT
    // moves the labels with it instead of leaving them sitting on the rule.
    const F = this.LEG_FONT;
    const charWidth = F * 0.6;

    // A dimension's value sits in a break in the rule, but a short leg has no room for
    // one. Then the label goes outside the far tick instead, the way a drawing takes a
    // dimension outside its own extension lines.
    const roomy = this.legRoomy(Math.hypot(x2 - x1, y2 - y1), label);
    let labelX: number, labelY: number, anchor: ISceneLeg['anchor'];
    if (horizontal) {
      const below = (side ?? (roomy ? -1 : 1)) > 0;
      labelY = (y1 + y2) / 2 + (below ? F * 1.13 : -F * 0.4);
      if (roomy) {
        labelX = (x1 + x2) / 2;
        anchor = 'middle';
      } else {
        // Out past the corner: the boat sits on this leg's other end.
        labelX = x1 < x2 ? x2 + F * 0.53 : x2 - F * 0.53;
        anchor = x1 < x2 ? 'start' : 'end';
      }
    } else {
      const right = (side ?? 1) > 0;
      labelX = right ? x1 + F * 0.53 : x1 - F * 0.53;
      anchor = right ? 'start' : 'end';
      // Short, it goes out past the corner end, away from the line.
      labelY = roomy ? (y1 + y2) / 2 + F * 0.33
        : (y1 < y2 ? y1 - F * 0.53 : y1 + F * 0.93);
    }
    // Held inside the drawing: a label pushed outside a short leg can otherwise run off
    // the edge, which is exactly when it gets pushed out.
    const width = label.length * charWidth;
    const lead = anchor === 'end' ? width : anchor === 'middle' ? width / 2 : 0;
    const trail = anchor === 'start' ? width : anchor === 'middle' ? width / 2 : 0;
    labelX = Math.min(Math.max(labelX, lead + 3), Math.max(W - trail - 3, lead + 3));

    return { x1, y1, x2, y2, ticks, label, title, labelX, labelY, anchor, leading: false };
  }

  /**
   * The box a leg's label covers, from its anchor, text length and font size. An estimate -
   * SVG text is not measured - on the same 0.6em character width the placement uses.
   */
  private legLabelBox(leg: ISceneLeg): { left: number; right: number; top: number; bottom: number } {
    const F = this.LEG_FONT;
    const width = leg.label.length * F * 0.6;
    const left = leg.anchor === 'start' ? leg.labelX
      : leg.anchor === 'end' ? leg.labelX - width : leg.labelX - width / 2;
    return { left, right: left + width, top: leg.labelY - F * 0.75, bottom: leg.labelY + F * 0.25 };
  }

  /**
   * The last word on the two labels not overlapping. Placing each on the side of its leg
   * away from the other keeps them apart on its own, but holding a label inside the
   * drawing can push it back across; then the across label slides on along its own leg,
   * towards the line, until it is clear.
   *
   * @param towardsLine Which way the across leg runs from the corner on screen.
   */
  private separateLegLabels(zone: ISceneLeg, across: ISceneLeg, towardsLine: number): void {
    const a = this.legLabelBox(zone), b = this.legLabelBox(across);
    const gap = 2;
    if (a.right + gap <= b.left || b.right + gap <= a.left
      || a.bottom + gap <= b.top || b.bottom + gap <= a.top) return;
    const shift = towardsLine < 0 ? b.bottom - a.top + gap : a.bottom - b.top + gap;
    across.labelY += (towardsLine < 0 ? -1 : 1) * shift;
  }

  /**
   * A distance in metres, in whatever length unit the widget is configured for - so the
   * legs, and the line's own length, all read in the same units.
   *
   * @param unit Defaults to the unit the line length is displayed in.
   */
  private formatDistance(metres: number, unit?: string): string {
    const to = unit ?? this.lengthUnit();
    const value = this.units.convertToUnit(to, metres) ?? metres;
    // Nautical miles and kilometres need decimals to say anything at these distances.
    const decimals = to === 'nm' || to === 'km' || to === 'mi' ? 2 : 0;
    return `${value.toFixed(decimals)}${this.unitSuffix(to)}`;
  }

  /**
   * The VMG the plugin would divide a leg by: the collected best, or the one the boat is
   * achieving right now if that is better - the same rule as the plugin's own
   * effectiveVmg. Only used against a plugin that does not publish that directly.
   * In metres per second, as the collected bests arrive.
   */
  private deriveEffectiveVmg(name: TVmgName, lineBearingDeg: number): number {
    let best = this.bestVmg()[name] ?? 0;

    const cog = this.cog(), sog = this.sog();
    if (cog != null && sog != null) {
      const angle = cog - lineBearingDeg * Math.PI / 180;
      // Positive towards the course side, and towards the port end, matching the
      // plugin's own decomposition.
      const normal = sog * Math.sin(angle);
      const tangent = sog * Math.cos(angle);
      const instant = name === 'toCourseSide' ? normal
        : name === 'fromCourseSide' ? -normal
          : name === 'toPortEnd' ? tangent : -tangent;
      if (instant > 0) best = Math.max(best, instant);
    }
    // The same floor the plugin puts under its effective VMGs, so this fallback agrees
    // with the published time to line rather than undercutting it.
    return Math.max(best, MIN_EFFECTIVE_VMG);
  }

  /**
   * An arrow in the top corner showing where the wind sits relative to the line.
   *
   * The whole drawing is rotated so the line lies flat, which is what makes the wind
   * worth drawing here: against a fixed line the arrow's angle *is* the wind's angle to
   * the line, so which end is favoured can be read off it directly without doing the
   * arithmetic between two bearings. It points downwind - the way the air is going - and
   * is drawn faintly, being context rather than part of the approach.
   */
  private buildWind(geo: ILineGeometry, W: number): IScene['wind'] {
    const from = this.twd();
    if (from == null) return null;

    // Downwind, in the drawing's own frame.
    const dir = screenVector(from + Math.PI, geo.bearing);
    // Kept clear of the viewBox edges at its full size, whichever way it points.
    const cx = W - 40, cy = 38;
    const perp = { x: -dir.y, y: dir.x };
    const at = (fwd: number, side: number) =>
      `${(cx + dir.x * fwd + perp.x * side).toFixed(1)},${(cy + dir.y * fwd + perp.y * side).toFixed(1)}`;
    // Tip, head barbs, then the shaft back to the tail.
    const points = [
      at(30, 0), at(4, 16), at(4, 6), at(-30, 6),
      at(-30, -6), at(4, -6), at(4, -16)
    ].join(' ');

    const degrees = ((from * 180 / Math.PI) % 360 + 360) % 360;
    // Angle off the line, so the reading the arrow gives has a number behind it.
    const offLine = (((from * 180 / Math.PI) - geo.bearing) % 360 + 360) % 360;
    const acute = offLine > 180 ? 360 - offLine : offLine;
    return {
      points,
      title: `Wind from ${degrees.toFixed(0).padStart(3, '0')}\u00b0T, `
        + `${acute.toFixed(0)}\u00b0 to the line`
    };
  }

  /**
   * The pin and the committee boat marking the ends. Both stand for a 10m object, drawn
   * at an exaggerated multiple of the line's own scale and then clamped, so they read as
   * landmarks whether the drawing is zoomed out to a distant line or in on a close one.
   */
  private buildEnds(stbX: number, lineY: number, scale: number): ISceneEnds {
    const size = Math.min(Math.max(
      this.END_METRES * scale * this.END_EXAGGERATION, 12), this.END_SIZE_MAX);
    // The committee boat's shape is drawn at 24 units wide, so scale it to `size`.
    const k = size / 24;
    return {
      pinRadius: size * 0.29,
      hull: `${stbX - 13 * k},${lineY - 4 * k} ${stbX + 11 * k},${lineY - 4 * k} ` +
        `${stbX + 9 * k},${lineY + 4 * k} ${stbX - 7 * k},${lineY + 4 * k}`,
      cabin: { x: stbX - 3 * k, y: lineY - 10 * k, width: 9 * k, height: 6 * k }
    };
  }

  /**
   * The boat, and the projection running from it along the current COG.
   *
   * While the timer counts down the projection runs for the distance the boat will
   * actually cover before the gun, so its tip shows where it gets to at zero: short of
   * the line is late, beyond it is early. With no timer running there is nothing to
   * project against, so it degrades to a short stub showing course only.
   */
  private buildBoat(scene: IScene, geo: ILineGeometry, bx: number, by: number,
    ocs: boolean, scale: number): void {
    // Clamped past the far corner of the viewBox: a long countdown projects well off
    // the drawing, and it is clipped there anyway.
    const tts = this.timeToStart() ?? 0;
    const project = (speed: number) => Math.min(speed * tts * scale, 600);

    let courseLabel: string | null = null;
    const cog = this.cog();
    if (cog != null) {
      const running = this.timerRunning() && tts > 0;
      const v = screenVector(cog, geo.bearing);
      const sog = this.sog();

      if (running) {
        if (sog != null) {
          const len = project(sog);
          scene.projections.push({
            x1: bx, y1: by, x2: bx + v.x * len, y2: by + v.y * len,
            width: 6, opacity: 0.55, title: LEGEND_CURRENT
          });
          courseLabel = LEGEND_CURRENT;
        }
      } else {
        scene.projections.push({
          x1: bx, y1: by, x2: bx + v.x * 40, y2: by + v.y * 40,
          width: 6, opacity: 0.55, title: LEGEND_STUB
        });
        courseLabel = LEGEND_STUB;
      }
    }

    const heading = this.heading() ?? cog;
    const v = heading != null ? screenVector(heading, geo.bearing) : { x: 0, y: -1 };
    const dx = v.x, dy = v.y, px = -dy, py = dx;

    // The hull is drawn solid at the drawing's own scale, but with a minimum size set by MIN_HULL_DISPLAY_UNITS
    const boatMetres = this.boatLength() ?? this.DEFAULT_BOAT_METRES;
    const hullLength = (boatMetres * scale) < this.MIN_HULL_DISPLAY_UNITS ? this.MIN_HULL_DISPLAY_UNITS : boatMetres * scale;
    // The fix is the bow, not the middle of the boat: that is where the Signalk reports the position
    // to be, it is what the plugin measures its distance to the line from, and it
    // is the end that decides whether you are over. So the hull is hung aft of the fix
    // rather than centred on it, which also makes a change of heading swing the stern
    // around a bow that stays put - what the boat actually does, and what stops the bow
    // wandering across the line when only the heading moves.
    const sternward = hullLength / 2;
    const cx = bx - dx * sternward, cy = by - dy * sternward;
    // A point on the hull, given in boat coordinates: forward, and out to starboard.
    const at = (fwd: number, stbd: number) =>
      `${(cx + dx * fwd + px * stbd).toFixed(1)},${(cy + dy * fwd + py * stbd).toFixed(1)}`;
    const path = this.hullPath(at, hullLength);

    // Hovering the boat reports what it is doing, and says what the line running from
    // it means - it is only described here, to keep the drawing uncluttered.
    const tip = [`SOG ${this.formatKnots(this.sog())}  COG ${this.formatBearing(cog)}`];
    if (courseLabel) tip.push(courseLabel);

    scene.boat = { path, ocs, title: tip.join('\n') };
  }

  /**
   * One closed hull outline of the given length, centred on whatever origin `at` maps
   * (0, 0) to and pointing along the boat: a fine entry at the bow, maximum beam a
   * little aft of midships, and a transom across the stern.
   *
   * @param at Maps a point in boat coordinates - forward, and out to starboard - to the
   *   drawing.
   * @param length Overall length of this outline, in viewBox units.
   */
  private hullPath(at: (fwd: number, stbd: number) => string, length: number): string {
    const h = length / 2, b = length * this.HULL_BEAM_RATIO / 2;
    return `M${at(h, 0)} C${at(h * 0.55, b * 0.42)} ${at(-h * 0.15, b)} ${at(-h, b * 0.55)}` +
      ` L${at(-h, -b * 0.55)} C${at(-h * 0.15, -b)} ${at(h * 0.55, -b * 0.42)} ${at(h, 0)} Z`;
  }

  private latLon(latitude: number | null, longitude: number | null): ILatLon | null {
    return latitude == null || longitude == null ? null : { latitude, longitude };
  }

  private unitSuffix(unit: string | null | undefined): string {
    if (!unit) return '';
    if (unit === 'feet') return '′';
    if (unit === 'knots') return 'kn';
    return unit;
  }

  private formatKnots(metresPerSecond: number | null): string {
    return metresPerSecond == null ? '--'
      : `${(this.units.convertToUnit('knots', metresPerSecond) ?? 0).toFixed(1)}kn`;
  }

  private formatBearing(radians: number | null): string {
    if (radians == null) return '--';
    const degrees = ((radians * 180 / Math.PI) % 360 + 360) % 360;
    return `${degrees.toFixed(0).padStart(3, '0')}°T`;
  }

  /** Previous trace sample, for differencing the ground actually covered. */
  private lastTrace: { at: number; a: number; c: number } | null = null;
  /** Running totals, which average out the noise in any single pair of samples. */
  private traceTotals = { seconds: 0, ground: 0, bySog: 0 };

  /**
   * Log one row of the approach, when the console has set
   * `window.skipRacerStartLineDebug = true`. Rows also accumulate in
   * `window.skipRacerStartLineTrace` so a whole run can be copied out at once.
   *
   * The point of the trace is one invariant. While COG and SOG hold steady, the tip of
   * the current-course projection sits a fixed distance from the line: the boat closes
   * the line at `vPerp` and the projection shortens at exactly the same rate, so
   * `gapAtGun = across - vPerp * timeToStart` should not move. If it drifts - the tip
   * creeping towards and through the line as the countdown runs - then the boat is
   * covering more ground than its reported COG and SOG account for, or the countdown is
   * running at the wrong rate.
   *
   * `sogRatio` separates those: it is the speed the boat actually made good between
   * fixes over the SOG it reported, so a value steady above 1 is the boat over-running
   * its own SOG, while a ratio of 1 with a drifting gap points at the clock instead.
   * `trackDeg` against `cogDeg` does the same for direction - the bearing the boat
   * actually moved on, against the one it claims. `ratioCumulative` is the same
   * comparison over the whole run rather than one pair of fixes, so it is the number to
   * trust: a single pair is at the mercy of when the fixes happened to land.
   */
  private traceApproach(geo: ILineGeometry | null): void {
    if (!window.skipRacerStartLineDebug) {
      this.lastTrace = null;
      this.traceTotals = { seconds: 0, ground: 0, bySog: 0 };
      return;
    }
    if (!geo?.boat) return;

    // Signal K's own timestamp for the fix where there is one, so the interval is the
    // one the position actually moved over rather than whenever the browser saw it.
    const wallClock = Date.now();
    const now = this.fixTime() ?? wallClock;
    const { a, c } = geo.boat;
    const previous = this.lastTrace;
    if (previous && now === previous.at) return; // same fix redelivered
    this.lastTrace = { at: now, a, c };

    const sog = this.sog();
    const cog = this.cog();
    const tts = this.timeToStart();
    // The line is crossed towards the course side, 90 degrees clockwise of the line
    // bearing, so that is the direction the boat has to close in.
    const bearingRad = geo.bearing * Math.PI / 180;
    const startBearing = bearingRad + Math.PI / 2;
    // Closing speed the reported COG/SOG accounts for, and the gap the projection tip
    // should therefore hold against the line.
    const vPerpFromSog = sog != null && cog != null ? sog * Math.cos(cog - startBearing) : null;
    const gapAtGun = vPerpFromSog != null && tts != null ? c - vPerpFromSog * tts : null;

    // What the boat actually did on the ground since the last fix.
    let dt: number | null = null;
    let vPerpMeasured: number | null = null;
    let sogMeasured: number | null = null;
    let trackDeg: number | null = null;
    if (previous) {
      dt = (now - previous.at) / 1000;
      if (dt > 0.05) {
        const alongDelta = a - previous.a, acrossDelta = c - previous.c;
        vPerpMeasured = -acrossDelta / dt;
        sogMeasured = Math.hypot(alongDelta, acrossDelta) / dt;
        // Back out of the along/across frame into a compass bearing: along runs on the
        // line's bearing, across 90 degrees anticlockwise of it.
        const east = alongDelta * Math.sin(bearingRad) + acrossDelta * Math.sin(bearingRad - Math.PI / 2);
        const north = alongDelta * Math.cos(bearingRad) + acrossDelta * Math.cos(bearingRad - Math.PI / 2);
        if (Math.hypot(east, north) > 0.01) {
          trackDeg = ((Math.atan2(east, north) * 180 / Math.PI) % 360 + 360) % 360;
        }
        if (sog != null) {
          this.traceTotals.seconds += dt;
          this.traceTotals.ground += sogMeasured * dt;
          this.traceTotals.bySog += sog * dt;
        }
      }
    }

    const round = (value: number | null, places = 2) =>
      value == null || !Number.isFinite(value) ? null : Number(value.toFixed(places));

    const row = {
      time: new Date(now).toISOString().slice(11, 23),
      // How far the browser lagged the fix, to show the clock is not the confound.
      lagMs: round(wallClock - now, 0),
      dt: round(dt),
      // Perpendicular distance to the line, positive on the pre-start side.
      across: round(c, 1),
      // Distance along the line from the starboard end towards the port end.
      along: round(a, 1),
      timeToStart: round(tts, 1),
      sogReported: round(sog, 3),
      sogMeasured: round(sogMeasured, 3),
      sogRatio: round(sogMeasured != null && sog ? sogMeasured / sog : null, 3),
      // The same comparison over the whole run, which is the one to trust.
      ratioCumulative: round(this.traceTotals.bySog > 0
        ? this.traceTotals.ground / this.traceTotals.bySog : null, 3),
      cogDeg: round(cog == null ? null : ((cog * 180 / Math.PI) % 360 + 360) % 360, 1),
      // The bearing the boat actually moved on, which should match cogDeg.
      trackDeg: round(trackDeg, 1),
      startBearingDeg: round((geo.bearing + 90) % 360, 1),
      vPerpFromSog: round(vPerpFromSog, 3),
      vPerpMeasured: round(vPerpMeasured, 3),
      // Should hold constant while COG and SOG do. Positive: short of the line at the
      // gun. Negative: over it.
      gapAtGun: round(gapAtGun, 1)
    };

    (window.skipRacerStartLineTrace ??= []).push(row);
    console.log('[racer-start-line]', row);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}
