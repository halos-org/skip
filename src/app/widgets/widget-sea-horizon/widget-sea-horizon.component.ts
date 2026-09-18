import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import type { IPathUpdate } from '../../core/services/data.service';
import { ITheme } from '../../core/services/app-service';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective, widgetPathSignature, WidgetRepointTracker } from '../../core/directives/widget-streams.directive';

/**
 * Sea Horizon — a marine attitude indicator.
 *
 * Deliberately NOT an aviation artificial horizon, which is what the older Pitch & Roll widget
 * (widget-horizon, the steelseries `Horizon` gauge) is. An aircraft instrument treats pitch as the
 * primary axis, bank as a commanded input, and rules its scale to 90°. A hull cares about heel over
 * roughly ±40° and trim over ±10°, and a hull pitching 20° is in trouble rather than manoeuvring.
 * So here the ground is sea rather than earth, the pitch ladder is ruled every 2.5° and labelled
 * every 5°, the heel scale stops at 45° and carries nominal / caution / alarm bands with a red
 * limit index at a configurable angle, and the fixed reference symbol is a deck bar with a mast
 * stub rather than an aircraft.
 *
 * It wears the same Classic Steel case as Skip's other steel gauges, but draws it as SVG: bezel,
 * bevel, face vignette, glass crescent, engraved scale and LCD insets are gradients and paths. A
 * fixed viewBox scales for free and stays crisp on a retina MFD, so there is none of
 * widget-horizon's resize plumbing — no size-stabilisation timer, no gauge rebuild on resize.
 *
 * It does observe its own size, for one reason: steelseries specifies its two texture tiles in
 * device pixels rather than as a fraction of the dial, so matching one means knowing how big this
 * dial was painted. That feeds a single number into a pattern transform — no geometry is rebuilt
 * and nothing re-renders beyond the `carbon` and `punchedSheet` faces changing tile scale.
 */

// ---------------------------------------------------------------------------
// Fixed geometry. The viewBox never changes, so every static coordinate below is
// computed once at module load rather than per instance or per frame.
// ---------------------------------------------------------------------------
/** The viewBox is square and never changes; every coordinate below is in its units. */
const VIEWBOX = 300;
const CX = 150;
const CY = 150;

// The case is the steelseries Classic Steel case, reproduced exactly: every radius below is the
// fraction drawFrame.js uses, resolved against this 300x300 viewBox, and the finishes further down
// carry that library's own gradient stops. Skip's Classic Steel widget renders the real library, so
// the two sit side by side on a dashboard and have to agree.
/** Outer edge of the case. */
const FRAME_R = 150;
/** The bright ring between finish and face (0.841121). */
const FRAME_INNER_R = 126.168;
/** The dial face (0.83). */
const FACE_R = 124.5;
/** Radius the face's inner shadow and side vignette are drawn to (0.831775). */
const FACE_SHADOW_R = 124.766;
/**
 * Bounds of the ring a conical finish fills (0.42056 and 0.495327 of the width). The outer bound is
 * also the radius of the circle every other finish paints its gradient on.
 */
const CONIC_INNER_R = 126.168;
const CONIC_OUTER_R = 148.598;

/**
 * The dial — window, scale, reference symbol and LCDs — is laid out against this radius and then
 * scaled onto the real face. Keeping a design radius separate from the face radius means the case
 * can follow steelseries' proportions without every tick and label having to be re-tuned.
 */
const DIAL_R = 112;
/** The window the horizon is drawn through. */
const WIN_R = 78;
/** Pixels per degree of pitch. Aviation ladders run ~5px/deg over ±30°; a hull needs ±15°. */
const PITCH_PX_PER_DEG = 5.8;
/** Largest heel the scale is ruled to. */
const HEEL_SCALE_MAX = 45;
const BAND_R_INNER = DIAL_R - 13;
const BAND_R_OUTER = DIAL_R - 8;
const TICK_R = DIAL_R - 3;
const NUMERAL_R = DIAL_R - 24;
const LIMIT_R_OUTER = DIAL_R - 2;
const LIMIT_R_INNER = DIAL_R - 20;

const COLOR_NOMINAL = '#2FA84F';
const COLOR_CAUTION = '#E8912B';
const COLOR_ALARM = '#CE2A20';

const DEFAULT_CAUTION_ANGLE = 20;
const DEFAULT_ALARM_ANGLE = 30;
/**
 * Longest damping time constant honoured, in seconds. The settings panel offers up to 5; the stored
 * value is not otherwise bounded (the dashboard schema publishes it as a plain number, and external
 * tools write dashboards against that), and a constant of hours would freeze the dial on its first
 * sample. Twice the panel's largest option is generous for a hull in a seaway and still visibly live.
 */
const MAX_DAMPING_S = 10;
const DEFAULT_FRAME_DESIGN = 'anthracite';

export interface IGradientStop { o: string; c: string; }
interface ITick { x1: number; y1: number; x2: number; y2: number; major: boolean; }
interface INumeral { x: number; y: number; text: string; transform: string; }
interface ILadderRung { x1: number; x2: number; y: number; major: boolean; }
interface ILadderLabel { x: number; y: number; text: string; anchor: 'start' | 'end'; }
interface IHeelBand { d: string; fill: string; }
interface ILimitIndex { x1: number; y1: number; x2: number; y2: number; }

/** Degrees measured from 12 o'clock, clockwise positive — starboard heel is positive. */
function polar(r: number, deg: number): [number, number] {
  const a = (deg - 90) * Math.PI / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/**
 * A filled arc segment between two radii, used for the nominal / caution / alarm bands. Angles are
 * in the same 12-o'clock-clockwise frame as {@link polar}, so a span reads port-to-starboard.
 */
function bandPath(rIn: number, rOut: number, a0: number, a1: number): string {
  const [ox0, oy0] = polar(rOut, a0);
  const [ox1, oy1] = polar(rOut, a1);
  const [ix1, iy1] = polar(rIn, a1);
  const [ix0, iy0] = polar(rIn, a0);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${ox0.toFixed(2)},${oy0.toFixed(2)}` +
    ` A${rOut},${rOut} 0 ${large} 1 ${ox1.toFixed(2)},${oy1.toFixed(2)}` +
    ` L${ix1.toFixed(2)},${iy1.toFixed(2)}` +
    ` A${rIn},${rIn} 0 ${large} 0 ${ix0.toFixed(2)},${iy0.toFixed(2)} Z`;
}

/** Confine a value to an inclusive range. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Heel scale: a tick every 5°, major every 10°. */
const HEEL_TICKS: ITick[] = (() => {
  const ticks: ITick[] = [];
  for (let a = -HEEL_SCALE_MAX; a <= HEEL_SCALE_MAX; a += 5) {
    const major = a % 10 === 0;
    const [x1, y1] = polar(TICK_R, a);
    const [x2, y2] = polar(TICK_R - (major ? 13 : 7), a);
    ticks.push({ x1, y1, x2, y2, major });
  }
  return ticks;
})();

/**
 * Only 20 and 40 carry numerals. Numbering every major mark crowds the top of the scale to the
 * point of illegibility at tile size, and the ticks already locate 10 and 30.
 */
const HEEL_NUMERALS: INumeral[] = [-40, -20, 20, 40].map(a => {
  const [x, y] = polar(NUMERAL_R, a);
  return { x, y: y + 3.96, text: String(Math.abs(a)), transform: `rotate(${a} ${x.toFixed(2)} ${y.toFixed(2)})` };
});

/** Pitch ladder: a rung every 2.5°, labelled every 5°. */
const LADDER_RUNGS: ILadderRung[] = [];
const LADDER_LABELS: ILadderLabel[] = [];
for (const p of [-15, -12.5, -10, -7.5, -5, -2.5, 2.5, 5, 7.5, 10, 12.5, 15]) {
  const major = Math.abs(p) % 5 === 0;
  const half = major ? 26 : 11;
  const y = CY - p * PITCH_PX_PER_DEG;
  LADDER_RUNGS.push({ x1: CX - half, x2: CX + half, y, major });
  if (major) {
    LADDER_LABELS.push({ x: CX - half - 6, y: y + 3.2, text: String(Math.abs(p)), anchor: 'end' });
    LADDER_LABELS.push({ x: CX + half + 6, y: y + 3.2, text: String(Math.abs(p)), anchor: 'start' });
  }
}

/** The rim index the heel scale is read against. Points inward from the bezel. */
const POINTER_PATH = `M${CX},${CY - (DIAL_R - 1) + 15} l-8.5,-15 l17,0 Z`;

/**
 * The glass. This is drawForeground.js's type-1 highlight, its bezier control points resolved
 * against the viewBox — the dome across the upper half that makes the steel gauges read as glazed.
 */
const GLASS_PATH =
  'M25.234,152.804' +
  ' C61.682,134.579 100.934,124.766 150,124.766' +
  ' C201.869,124.766 236.916,133.178 274.766,152.804' +
  ' C274.766,82.710 221.495,25.234 150,25.234' +
  ' C78.505,25.234 25.234,82.710 25.234,152.804 Z';
const GLASS_GRAD = { y1: 26.636, y2: 147.196 };

/** LCD insets: the rect, plus the baseline of the text centred in it. */
const LCD_HEEL = { x: CX - 56, y: CY + 46, w: 112, h: 30, size: 20, textY: CY + 46 + 15 + 20 * 0.36 };
const LCD_TRIM = { x: CX - 40, y: CY + 82, w: 80, h: 17, size: 10.5, textY: CY + 82 + 8.5 + 10.5 * 0.36 };

/** A finish is a stack of filled circles, or — for the brushed ones — a ring of conical wedges. */
interface IFrameGradient {
  kind: 'linear' | 'radial';
  x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; r?: number;
  stops: IGradientStop[];
}
interface IFrameLayer { r: number; grad?: number; fill?: string; }
interface IFrameDesign {
  gradients: IFrameGradient[];
  layers: IFrameLayer[];
  /** Brushed finishes are a conical sweep, which SVG has no primitive for — see conicalWedges(). */
  conical?: { fractions: number[]; colors: string[] };
}

/** One wedge of an approximated conical sweep: an annulus segment and the colours of its two edges. */
interface IFrameWedge { a0: number; d: string; x1: number; y1: number; x2: number; y2: number; c0: string; c1: string; }

/**
 * Bezel finishes, taken from steelseries' drawFrame.js and resolved against this viewBox, keyed by
 * the same `gauge.faceColor` values Skip's steel gauges already store. Generated from that source
 * rather than transcribed, so a finish reads identically here and on a Classic Steel gauge next to it.
 */
const FRAME_DESIGNS: Record<string, IFrameDesign> = {
  metal: {
    gradients: [
      { kind: 'linear', x1: 0, y1: 1.402, x2: 0, y2: 297.196,
        stops: [{ o: '0.0', c: '#FEFEFE' }, { o: '0.07', c: '#D2D2D2' }, { o: '0.12', c: '#B3B3B3' }, { o: '1.0', c: '#D5D5D5' }] },
    ],
    layers: [{ r: 148.598, grad: 0 }]
  },
  brass: {
    gradients: [
      { kind: 'linear', x1: 0, y1: 1.402, x2: 0, y2: 297.196,
        stops: [{ o: '0.0', c: '#F9F39B' }, { o: '0.05', c: '#F6E265' }, { o: '0.1', c: '#F0E184' }, { o: '0.5', c: '#5A3916' }, { o: '0.9', c: '#F9ED8B' }, { o: '0.95', c: '#F3E26C' }, { o: '1.0', c: '#CAB671' }] },
    ],
    layers: [{ r: 148.598, grad: 0 }]
  },
  steel: {
    gradients: [
      { kind: 'linear', x1: 0, y1: 1.402, x2: 0, y2: 297.196,
        stops: [{ o: '0.0', c: '#E7EDED' }, { o: '0.05', c: '#BDC7C6' }, { o: '0.1', c: '#C0C9C8' }, { o: '0.5', c: '#171F21' }, { o: '0.9', c: '#C4CDCC' }, { o: '0.95', c: '#C2CCCB' }, { o: '1.0', c: '#BDC9C7' }] },
    ],
    layers: [{ r: 148.598, grad: 0 }]
  },
  gold: {
    gradients: [
      { kind: 'linear', x1: 0, y1: 1.402, x2: 0, y2: 297.196,
        stops: [{ o: '0.0', c: '#FFFFCF' }, { o: '0.15', c: '#FFED60' }, { o: '0.22', c: '#FEC739' }, { o: '0.3', c: '#FFF9CB' }, { o: '0.38', c: '#FFC740' }, { o: '0.44', c: '#FCC23C' }, { o: '0.51', c: '#FFCC3B' }, { o: '0.6', c: '#D5861D' }, { o: '0.68', c: '#FFC938' }, { o: '0.75', c: '#D4871D' }, { o: '1.0', c: '#F7EE65' }] },
    ],
    layers: [{ r: 148.598, grad: 0 }]
  },
  anthracite: {
    gradients: [
      { kind: 'linear', x1: 0, y1: 1.402, x2: 0, y2: 298.598,
        stops: [{ o: '0.0', c: '#767587' }, { o: '0.06', c: '#4A4A52' }, { o: '0.12', c: '#323236' }, { o: '1.0', c: '#4F4F57' }] },
    ],
    layers: [{ r: 148.598, grad: 0 }]
  },
  tiltedGray: {
    gradients: [
      { kind: 'linear', x1: 70.093, y1: 25.234, x2: 243.774, y2: 273.276,
        stops: [{ o: '0.0', c: '#FFFFFF' }, { o: '0.07', c: '#D2D2D2' }, { o: '0.16', c: '#B3B3B3' }, { o: '0.33', c: '#FFFFFF' }, { o: '0.55', c: '#C5C5C5' }, { o: '0.79', c: '#FFFFFF' }, { o: '1.0', c: '#666666' }] },
    ],
    layers: [{ r: 148.598, grad: 0 }]
  },
  tiltedBlack: {
    gradients: [
      { kind: 'linear', x1: 68.691, y1: 23.832, x2: 240.764, y2: 269.577,
        stops: [{ o: '0.0', c: '#666666' }, { o: '0.21', c: '#000000' }, { o: '0.47', c: '#666666' }, { o: '0.99', c: '#000000' }, { o: '1.0', c: '#000000' }] },
    ],
    layers: [{ r: 148.598, grad: 0 }]
  },
  glossyMetal: {
    gradients: [
      { kind: 'radial', cx: 150.0, cy: 150.0, r: 150.0,
        stops: [{ o: '0.0', c: '#CFCFCF' }, { o: '0.96', c: '#CDCCCD' }, { o: '1.0', c: '#F4F4F4' }] },
      { kind: 'linear', x1: 0, y1: 8.411, x2: 0, y2: 291.589,
        stops: [{ o: '0.0', c: '#F9F9F9' }, { o: '0.23', c: '#C8C3BF' }, { o: '0.36', c: '#FFFFFF' }, { o: '0.59', c: '#1D1D1D' }, { o: '0.76', c: '#C8C2C0' }, { o: '1.0', c: '#D1D1D1' }] },
    ],
    layers: [{ r: 148.598, grad: 0 }, { r: 146.094, grad: 1 }, { r: 130.374, fill: '#F6F6F6' }, { r: 127.5, fill: '#333333' }]
  },
  blackMetal: {
    gradients: [], layers: [],
    conical: {
      fractions: [0.0, 0.125, 0.347222, 0.5, 0.680555, 0.875, 1.0],
      colors: ['#FEFEFE', '#000000', '#999999', '#000000', '#999999', '#000000', '#FEFEFE']
    }
  },
  shinyMetal: {
    gradients: [], layers: [],
    conical: {
      fractions: [0.0, 0.125, 0.25, 0.347222, 0.5, 0.652777, 0.75, 0.875, 1.0],
      colors: ['#FEFEFE', '#D2D2D2', '#B3B3B3', '#EEEEEE', '#A0A0A0', '#EEEEEE', '#B3B3B3', '#D2D2D2', '#FEFEFE']
    }
  },
  chrome: {
    gradients: [], layers: [],
    conical: {
      fractions: [0.0, 0.09, 0.12, 0.16, 0.25, 0.29, 0.33, 0.38, 0.48, 0.52, 0.63, 0.68, 0.8, 0.83, 0.87, 0.97, 1.0],
      colors: ['#FFFFFF', '#FFFFFF', '#88888A', '#A4B9BE', '#9EB3B6', '#707070', '#DDE3E3', '#9BB0B3', '#9CB0B1', '#FEFFFF', '#FFFFFF', '#9CB4B4', '#C6D1D3', '#F6F8F7', '#CCD8D8', '#A4BCBE', '#FFFFFF']
    }
  },
};

/** Linear RGB interpolation between two #rrggbb colours, which is what steelseries' sweep uses. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => {
    const va = (pa >> sh) & 255, vb = (pb >> sh) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/**
 * Colour of a conical sweep at a screen angle, measured clockwise from 12 o'clock.
 *
 * steelseries builds these per-pixel from `atan2` and then flips the buffer vertically, which works
 * out to fraction = 1 - deg/360. That mapping was confirmed against a rendered gauge rather than
 * derived on paper: sampling the real blackMetal bezel gives white at 0°, black at 45°/180°/315°
 * and grey at 115°/235°, which is exactly what this returns.
 */
function conicalColorAt(fractions: number[], colors: string[], deg: number): string {
  const f = clamp(1 - (((deg % 360) + 360) % 360) / 360, 0, 1);
  for (let i = 0; i < fractions.length - 1; i++) {
    if (f >= fractions[i] && f <= fractions[i + 1]) {
      const span = fractions[i + 1] - fractions[i];
      return mixHex(colors[i], colors[i + 1], span === 0 ? 0 : (f - fractions[i]) / span);
    }
  }
  return colors[colors.length - 1];
}

/**
 * SVG has no conical gradient, so a sweep is drawn as a fan of wedges, each carrying a linear
 * gradient between the colours of its own two edges. The sweep is linear in angle within a colour
 * segment, so matching both edges makes each wedge accurate to the width of the arc it spans.
 *
 * `rIn` of 0 gives pie wedges filling a disc (the face), anything else an annulus (the bezel ring).
 */
function wedgePath(rIn: number, rOut: number, a0: number, a1: number): string {
  if (rIn > 0) return bandPath(rIn, rOut, a0, a1);
  const [ox0, oy0] = polar(rOut, a0);
  const [ox1, oy1] = polar(rOut, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${CX},${CY} L${ox0.toFixed(2)},${oy0.toFixed(2)}` +
    ` A${rOut},${rOut} 0 ${large} 1 ${ox1.toFixed(2)},${oy1.toFixed(2)} Z`;
}

/** A regular subdivision of the circle, in degrees, ends included. */
function uniformBoundaries(steps: number): number[] {
  return Array.from({ length: steps + 1 }, (_, i) => (i * 360) / steps);
}

/**
 * The same subdivision plus the angle of every colour stop, so no wedge straddles a stop and each
 * one's two-colour gradient is exact rather than an average across a colour change. The bezel ring
 * is thin enough that a plain subdivision is indistinguishable; the face is not.
 */
function snappedBoundaries(fractions: number[], steps: number): number[] {
  const edges = new Set(uniformBoundaries(steps));
  for (const f of fractions) edges.add(clamp(360 * (1 - f), 0, 360));
  return [...edges].sort((a, b) => a - b);
}

/**
 * Subdivision the bezel ring's sweep is drawn at. Snapped to the colour stops like the face's:
 * measured against the real bezel, a plain 24-way split leaves chrome — 17 stops, several of them
 * narrow — averaging 3.8 RGB counts out with excursions of 29 where a wedge straddles a stop.
 */
const FRAME_WEDGE_STEPS = 24;

/** How far past its trailing edge each wedge is painted — see conicalWedges(). */
const WEDGE_OVERLAP_DEG = 0.4;

/**
 * A wedge's gradient is linear across a chord while the sweep it stands in for is linear in angle,
 * so the two agree exactly only on the circle the gradient's endpoints sit on. On the face that
 * circle is put through the middle of the ring left visible around the horizon window, rather than
 * halfway to the centre — the centre is under the window and never seen.
 */
const FACE_WEDGE_GRAD_R = (WIN_R * (FACE_R / DIAL_R) + FACE_SHADOW_R) / 2;

function conicalWedges(
  fractions: number[], colors: string[], rIn: number, rOut: number, boundaries: number[],
  gradR = (rIn + rOut) / 2
): IFrameWedge[] {
  const wedges: IFrameWedge[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const d0 = boundaries[i];
    const d1 = boundaries[i + 1];
    if (d1 - d0 < 1e-6) continue;
    const [x1, y1] = polar(gradR, d0);
    const [x2, y2] = polar(gradR, d1);
    wedges.push({
      a0: d0,
      // Painted a shade past its trailing edge so neighbours butt rather than meet: two antialiased
      // edges over the same seam composite to a hairline, which on a large face reads as spokes.
      // The gradient still runs between the true edges, so no colour moves.
      d: wedgePath(rIn, rOut, d0, d1 + WEDGE_OVERLAP_DEG),
      x1, y1, x2, y2,
      c0: conicalColorAt(fractions, colors, d0),
      c1: conicalColorAt(fractions, colors, d1)
    });
  }
  return wedges;
}

/**
 * The face's inner shadow and its side vignette, both from drawBackground.js. Together they are what
 * stops the face reading as flat paint under the glass.
 */
const FACE_SHADOW_STOPS: IGradientStop[] = [
  { o: '0', c: 'rgba(0,0,0,0)' }, { o: '0.7', c: 'rgba(0,0,0,0)' }, { o: '0.71', c: 'rgba(0,0,0,0)' },
  { o: '0.86', c: 'rgba(0,0,0,0.03)' }, { o: '0.92', c: 'rgba(0,0,0,0.07)' },
  { o: '0.97', c: 'rgba(0,0,0,0.15)' }, { o: '1', c: 'rgba(0,0,0,0.3)' }
];
const FACE_VIGNETTE_STOPS: IGradientStop[] = [
  { o: '0', c: 'rgba(0,0,0,0.25)' }, { o: '0.5', c: 'rgba(0,0,0,0)' }, { o: '1', c: 'rgba(0,0,0,0.25)' }
];

/** The LCD inset, from createLcdBackgroundImage.js with the STANDARD colour set. */
const LCD_BEZEL_STOPS: IGradientStop[] = [
  { o: '0', c: '#4C4C4C' }, { o: '0.08', c: '#666666' }, { o: '0.92', c: '#666666' }, { o: '1', c: '#E6E6E6' }
];
const LCD_FACE_STOPS: IGradientStop[] = [
  { o: '0', c: 'rgb(131,133,119)' }, { o: '0.03', c: 'rgb(176,183,167)' }, { o: '0.49', c: 'rgb(165,174,153)' },
  { o: '0.5', c: 'rgb(166,175,156)' }, { o: '1', c: 'rgb(175,184,165)' }
];


// ---------------------------------------------------------------------------
// The dial face — drawBackground.js, and the same 18 finishes Skip's Classic Steel widget already
// offers under `gauge.backgroundColor`, so the two gauges agree face-for-face as well as
// bezel-for-bezel. Twelve are plain gradients and two are textures, all reproduced exactly; two are
// conical sweeps, exact to the width of a wedge; the two brushed ones are the only approximations
// (see brushedGradient below).
// ---------------------------------------------------------------------------

/** Where drawBackground.js runs the face gradient: y = width * 0.084112 down to the face diameter. */
const FACE_GRAD_Y1 = 25.234;
const FACE_GRAD_Y2 = 249.532;

interface ITextureShape { d: string; fill?: string; grad?: number; }
/** A repeating tile, drawn in its own coordinate system and sized in viewBox units. */
interface ITextureTile { size: number; gradients: IFrameGradient[]; shapes: ITextureShape[]; }
/** One scribed turning circle of the `turned` finish. */
interface IScribe { cx: number; cy: number; r: number; stroke: string; }

interface IBackgroundDesign {
  /** The plain finishes: one gradient across the face. */
  gradient?: IFrameGradient;
  /** stainless and turned: a conical sweep across the whole face. */
  conical?: { fractions: number[]; colors: string[] };
  /** turned only: the scribed turning circles laid over that sweep. */
  scribed?: boolean;
  /** carbon and punchedSheet: a repeating tile. */
  texture?: ITextureTile;
  /**
   * steelseries paints its side vignette before the brushed texture goes down and after the two
   * tiles do, so of the four finishes that reach that branch only carbon and punchedSheet actually
   * end up wearing it — the brushed pair paint straight over theirs.
   */
  vignette?: boolean;
  /** Dial ink, from the same definition's labelColor and symbolColor. */
  label: string;
  symbol: string;
  /** The face colour the engraved numerals are haloed against, so they read on a light face too. */
  halo: string;
}

function faceGradient(start: string, fraction: string, stop: string): IFrameGradient {
  return {
    kind: 'linear', x1: 0, y1: FACE_GRAD_Y1, x2: 0, y2: FACE_GRAD_Y2,
    stops: [{ o: '0', c: start }, { o: '0.4', c: fraction }, { o: '1', c: stop }]
  };
}

/** A rectangle as path data, so a texture tile is a list of one kind of element. */
function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${x},${y} h${w} v${h} h${-w} Z`;
}

/**
 * The brushed finishes are per-pixel noise over a base colour, lit by a sinusoidal sheen across the
 * image (brushedMetalTexture.js with shine 0.5, so the centre column sits at base + 127.5). The
 * sheen is the whole of what reads at a glance and is reproduced here; the grain is not, because SVG
 * can only make noise through a raster filter pass — the per-frame cost this widget exists to avoid.
 * These two are therefore the only finishes that are an approximation rather than a reproduction.
 */
function brushedGradient(base: string): IFrameGradient {
  const n = parseInt(base.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const stops: IGradientStop[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const shine = 127.5 * Math.sin(Math.PI * t);
    const [r, g, b] = channels.map(c => Math.round(clamp(c + shine, 0, 255)));
    stops.push({ o: t.toFixed(3), c: `rgb(${r}, ${g}, ${b})` });
  }
  return { kind: 'linear', x1: 0, y1: 0, x2: 300, y2: 0, stops };
}

/**
 * carbonBuffer.js, 1:1. Eight gradient-filled rectangles in a 12-unit tile. steelseries tiles this
 * at 12 device pixels whatever the gauge size; here it is 12 viewBox units, so it matches exactly at
 * 300px and scales with the tile instead of getting finer — which is the behaviour a resizable
 * vector instrument wants anyway.
 */
const CARBON_TILE: ITextureTile = {
  size: 12,
  gradients: [
    { kind: 'linear', x1: 0, y1: 0, x2: 0, y2: 6, stops: [{ o: '0', c: 'rgb(35, 35, 35)' }, { o: '1', c: 'rgb(23, 23, 23)' }] },
    { kind: 'linear', x1: 0, y1: 0, x2: 0, y2: 5, stops: [{ o: '0', c: 'rgb(38, 38, 38)' }, { o: '1', c: 'rgb(30, 30, 30)' }] },
    { kind: 'linear', x1: 0, y1: 6, x2: 0, y2: 12, stops: [{ o: '0', c: 'rgb(35, 35, 35)' }, { o: '1', c: 'rgb(23, 23, 23)' }] },
    { kind: 'linear', x1: 0, y1: 6, x2: 0, y2: 11, stops: [{ o: '0', c: 'rgb(38, 38, 38)' }, { o: '1', c: 'rgb(30, 30, 30)' }] },
    { kind: 'linear', x1: 0, y1: 0, x2: 0, y2: 6, stops: [{ o: '0', c: '#303030' }, { o: '1', c: 'rgb(40, 40, 40)' }] },
    { kind: 'linear', x1: 0, y1: 1, x2: 0, y2: 6, stops: [{ o: '0', c: 'rgb(53, 53, 53)' }, { o: '1', c: 'rgb(45, 45, 45)' }] },
    { kind: 'linear', x1: 0, y1: 6, x2: 0, y2: 12, stops: [{ o: '0', c: '#303030' }, { o: '1', c: '#282828' }] },
    { kind: 'linear', x1: 0, y1: 7, x2: 0, y2: 12, stops: [{ o: '0', c: '#353535' }, { o: '1', c: '#2D2D2D' }] }
  ],
  shapes: [
    { d: rectPath(0, 0, 6, 6), grad: 0 },
    { d: rectPath(1, 0, 4, 5), grad: 1 },
    { d: rectPath(6, 6, 6, 6), grad: 2 },
    { d: rectPath(7, 6, 4, 5), grad: 3 },
    { d: rectPath(6, 0, 6, 6), grad: 4 },
    { d: rectPath(7, 1, 4, 5), grad: 5 },
    { d: rectPath(0, 6, 6, 6), grad: 6 },
    { d: rectPath(1, 7, 4, 5), grad: 7 }
  ]
};

/** punchedSheetBuffer.js, 1:1: a 15-unit tile, its beziers resolved to whole units. */
const PUNCHED_SHEET_TILE: ITextureTile = {
  size: 15,
  gradients: [
    { kind: 'linear', x1: 0, y1: 1, x2: 0, y2: 7, stops: [{ o: '0', c: '#000000' }, { o: '1', c: '#444444' }] },
    { kind: 'linear', x1: 0, y1: 8, x2: 0, y2: 14, stops: [{ o: '0', c: '#000000' }, { o: '1', c: '#444444' }] }
  ],
  shapes: [
    { d: rectPath(0, 0, 15, 15), fill: '#1D2123' },
    { d: 'M0,4 C0,6 1,7 3,7 C5,7 6,6 6,4 C6,2 5,1 3,1 C1,1 0,2 0,4 Z', grad: 0 },
    { d: 'M0,3 C0,5 1,6 3,6 C5,6 6,5 6,3 C6,1 5,0 3,0 C1,0 0,1 0,3 Z', fill: '#050506' },
    { d: 'M7,11 C7,13 8,14 10,14 C12,14 13,13 13,11 C13,9 12,8 10,8 C8,8 7,9 7,11 Z', grad: 1 },
    { d: 'M7,10 C7,12 8,13 10,13 C12,13 13,12 13,10 C13,8 12,7 10,7 C8,7 7,8 7,10 Z', fill: '#050506' }
  ]
};

/** The sweep stainless and turned share, from drawBackground.js. */
const STAINLESS_CONICAL = {
  fractions: [0, 0.03, 0.1, 0.14, 0.24, 0.33, 0.38, 0.5, 0.62, 0.67, 0.76, 0.81, 0.85, 0.97, 1],
  colors: [
    '#FDFDFD', '#FDFDFD', '#B2B2B4', '#ACACAE', '#FDFDFD', '#8E8E8E', '#8E8E8E', '#FDFDFD',
    '#8E8E8E', '#8E8E8E', '#FDFDFD', '#ACACAE', '#B2B2B4', '#FDFDFD', '#FDFDFD'
  ]
};
const FACE_WEDGE_BOUNDARIES = snappedBoundaries(STAINLESS_CONICAL.fractions, 48);

/**
 * The turnings of the `turned` finish: a lathe circle stepped round the face, each one followed by a
 * darker copy a fraction of a step behind it to read as the shadow of the cut. Step size, radius and
 * both stroke colours are drawBackground.js's.
 */
const TURNED_SCRIBES: IScribe[] = (() => {
  const turnRadius = FACE_SHADOW_R * 0.55;
  const step = (Math.PI / 180) * (500 / FACE_SHADOW_R);
  const end = 2 * Math.PI - step * 0.3;
  const scribes: IScribe[] = [];
  const passes: [number, string][] = [[0, 'rgba(240,240,255,0.25)'], [0.3, 'rgba(25,10,10,0.1)']];
  for (let a = 0; a < end; a += step) {
    for (const [phase, stroke] of passes) {
      const t = a + step * phase;
      scribes.push({ cx: CX + turnRadius * Math.cos(t), cy: CY + turnRadius * Math.sin(t), r: turnRadius, stroke });
    }
  }
  return scribes;
})();

/** Keyed by the same `gauge.backgroundColor` values Skip's Classic Steel widget already stores. */
const BACKGROUND_DESIGNS: Record<string, IBackgroundDesign> = {
  darkGray: { gradient: faceGradient('#000000', '#333333', '#999999'), label: '#FFFFFF', symbol: '#B4B4B4', halo: '#333333' },
  satinGray: { gradient: faceGradient('#2D3939', '#2D3939', '#2D3939'), label: '#A7B8B4', symbol: '#899A96', halo: '#2D3939' },
  lightGray: { gradient: faceGradient('#828282', '#B5B5B5', '#FDFDFD'), label: '#000000', symbol: '#505050', halo: '#B5B5B5' },
  white: { gradient: faceGradient('#FFFFFF', '#FFFFFF', '#FFFFFF'), label: '#000000', symbol: '#505050', halo: '#FFFFFF' },
  black: { gradient: faceGradient('#000000', '#000000', '#000000'), label: '#FFFFFF', symbol: '#969696', halo: '#000000' },
  beige: { gradient: faceGradient('#B2AC96', '#CCCDB8', '#E7E7D6'), label: '#000000', symbol: '#505050', halo: '#CCCDB8' },
  brown: { gradient: faceGradient('#F5E1C1', '#F5E1C1', '#FFFAF0'), label: '#6D492F', symbol: '#59351B', halo: '#F5E1C1' },
  red: { gradient: faceGradient('#C65D5F', '#D48486', '#F2DADA'), label: '#000000', symbol: '#5A0000', halo: '#D48486' },
  green: { gradient: faceGradient('#417828', '#81AB5F', '#DAEDCA'), label: '#000000', symbol: '#005A00', halo: '#81AB5F' },
  blue: { gradient: faceGradient('#2D537A', '#7390AA', '#E3EAEE'), label: '#000000', symbol: '#00005A', halo: '#7390AA' },
  anthracite: { gradient: faceGradient('#323236', '#2F2F33', '#45454A'), label: '#FAFAFA', symbol: '#B4B4B4', halo: '#2F2F33' },
  mud: { gradient: faceGradient('#505652', '#464C48', '#393E3A'), label: '#FFFFF0', symbol: '#E1E1D2', halo: '#464C48' },
  punchedSheet: { texture: PUNCHED_SHEET_TILE, vignette: true, label: '#FFFFFF', symbol: '#B4B4B4', halo: '#1D2123' },
  carbon: { texture: CARBON_TILE, vignette: true, label: '#FFFFFF', symbol: '#B4B4B4', halo: '#232323' },
  stainless: { conical: STAINLESS_CONICAL, label: '#000000', symbol: '#505050', halo: '#DCDCDC' },
  brushedMetal: { gradient: brushedGradient('#45454A'), label: '#000000', symbol: '#505050', halo: '#8A8A8F' },
  brushedStainless: { gradient: brushedGradient('#6E6E70'), label: '#000000', symbol: '#505050', halo: '#A8A8AA' },
  turned: { conical: STAINLESS_CONICAL, scribed: true, label: '#000000', symbol: '#505050', halo: '#DCDCDC' }
};

const DEFAULT_BACKGROUND_DESIGN = 'carbon';

@Component({
  selector: 'widget-sea-horizon',
  templateUrl: './widget-sea-horizon.component.html',
  styleUrls: ['./widget-sea-horizon.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WidgetSeaHorizonComponent {
  // Host2 inputs
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();

  protected readonly runtime = inject(WidgetRuntimeDirective);
  private readonly streams = inject(WidgetStreamsDirective);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);

  /**
   * Edge length the instrument is actually painted at, in CSS pixels. Only the texture tiles need
   * it. Defaults to the viewBox, so a widget that never gets a measurement — jsdom, a detached tile,
   * a browser without ResizeObserver — still draws them at their authored size.
   */
  private readonly paintedPx = signal(VIEWBOX);

  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    supportAutomaticHistoricalSeries: false,
    displayName: 'Sea Horizon',
    filterSelfPaths: true,
    paths: {
      // pathType stays 'number' though the path is the whole navigation.attitude object: the
      // streams pipeline extracts the pitch/roll sub-field (observe below) BEFORE the number-type
      // conversion runs, so it converts the scalar rad->deg. Switching to 'object' would skip that
      // conversion and render radians. Both paths are fixed (isPathConfigurable:false) — no Paths tab.
      gaugePitchPath: {
        description: 'Attitude Pitch Data',
        path: 'self.navigation.attitude',
        source: 'default',
        pathType: 'number',
        pathRequired: false,
        isPathConfigurable: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        convertUnitTo: 'deg',
        showConvertUnitTo: false
      },
      gaugeRollPath: {
        description: 'Attitude Roll Data',
        path: 'self.navigation.attitude',
        source: 'default',
        pathType: 'number',
        pathRequired: false,
        isPathConfigurable: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        convertUnitTo: 'deg',
        showConvertUnitTo: false
      }
    },
    gauge: {
      type: 'seaHorizon',
      noFrameVisible: true,
      faceColor: 'anthracite',
      backgroundColor: 'carbon',
      invertPitch: false,
      invertRoll: false,
      heelCautionAngle: 20,
      heelAlarmAngle: 30,
      damping: 0
    },
    numDecimal: 1,
    updateInterval: 1000,
    enableTimeout: true,
    dataTimeout: 5
  };

  // ---- live readings -------------------------------------------------------
  // Raw (un-inverted) degrees are what the signals hold, so flipping an axis in the config takes
  // effect at once rather than at the next sample.
  private readonly rawPitch = signal<number | null>(null);
  private readonly rawRoll = signal<number | null>(null);
  private lastPitchAt: number | null = null;
  private lastRollAt: number | null = null;
  /**
   * Path identity behind each reading; see {@link WidgetRepointTracker}. Both paths ship with
   * `isPathConfigurable: false`, so today only a source change or a stored-config edit can re-point
   * them — the trackers exist so the widget clears correctly if that ever stops being true, without
   * a second copy of the rule the three ng-gauges and the steel compass share.
   */
  private readonly pitchRepoint = new WidgetRepointTracker();
  private readonly rollRepoint = new WidgetRepointTracker();

  /**
   * Whether the world and pointer groups animate between readings. Off until the first reading has
   * painted, so the step from a level dial to the first real attitude is instant rather than a slow
   * sweep up from zero; off again whenever the reading is lost or re-pointed, so recovery snaps too.
   */
  protected readonly ready = signal(false);
  private transitionFrame: number | null = null;

  protected readonly pitchDeg = computed(() => {
    const v = this.rawPitch();
    if (v == null) return null;
    return this.runtime.options()?.gauge?.invertPitch ? -v : v;
  });
  protected readonly rollDeg = computed(() => {
    const v = this.rawRoll();
    if (v == null) return null;
    return this.runtime.options()?.gauge?.invertRoll ? -v : v;
  });

  /** Neither axis has produced a reading, or both have timed out. */
  protected readonly noData = computed(() => this.pitchDeg() === null && this.rollDeg() === null);

  // ---- static geometry, exposed to the template ----------------------------
  protected readonly heelTicks = HEEL_TICKS;
  protected readonly heelNumerals = HEEL_NUMERALS;
  protected readonly ladderRungs = LADDER_RUNGS;
  protected readonly ladderLabels = LADDER_LABELS;
  protected readonly pointerPath = POINTER_PATH;
  protected readonly glassPath = GLASS_PATH;
  protected readonly glassGrad = GLASS_GRAD;
  protected readonly lcdHeel = LCD_HEEL;
  protected readonly lcdTrim = LCD_TRIM;
  protected readonly lcdBezelStops = LCD_BEZEL_STOPS;
  protected readonly lcdFaceStops = LCD_FACE_STOPS;
  protected readonly faceShadowStops = FACE_SHADOW_STOPS;
  protected readonly faceVignetteStops = FACE_VIGNETTE_STOPS;
  protected readonly frameR = FRAME_R;
  protected readonly frameInnerR = FRAME_INNER_R;
  protected readonly faceR = FACE_R;
  protected readonly faceShadowR = FACE_SHADOW_R;
  protected readonly winR = WIN_R;
  protected readonly cx = CX;
  protected readonly cy = CY;

  // ---- configuration-derived geometry --------------------------------------
  /** "Show Frame" binds straight to noFrameVisible, so true means draw the bezel. */
  protected readonly frameVisible = computed(() => this.runtime.options()?.gauge?.noFrameVisible ?? false);

  /** With the bezel hidden the dial grows into the space the bezel would have occupied. */
  protected readonly dialTransform = computed(() => {
    // The dial is drawn against DIAL_R and scaled onto whatever it has to fill: the steelseries face
    // when the case is on, the whole tile when it is off.
    const scale = (this.frameVisible() ? FACE_R : FRAME_R) / DIAL_R;
    return `translate(${CX} ${CY}) scale(${scale.toFixed(4)}) translate(${-CX} ${-CY})`;
  });

  /**
   * Face shading and glass are authored at the steelseries face radius, so with the case on they
   * already sit on the dial's edge and need no transform. With it off the dial grows to fill the
   * tile, and they have to grow with it — otherwise the vignette and the glass dome stop short of
   * the edge and the dial reads as a small gauge floating in a dark ring.
   */
  protected readonly overlayTransform = computed(() => {
    if (this.frameVisible()) return null;
    const scale = FRAME_R / FACE_R;
    return `translate(${CX} ${CY}) scale(${scale.toFixed(4)}) translate(${-CX} ${-CY})`;
  });

  protected readonly cautionAngle = computed(() => {
    const raw = this.runtime.options()?.gauge?.heelCautionAngle;
    return clamp(typeof raw === 'number' && isFinite(raw) ? raw : DEFAULT_CAUTION_ANGLE, 1, HEEL_SCALE_MAX - 1);
  });

  protected readonly alarmAngle = computed(() => {
    const raw = this.runtime.options()?.gauge?.heelAlarmAngle;
    const alarm = clamp(typeof raw === 'number' && isFinite(raw) ? raw : DEFAULT_ALARM_ANGLE, 2, HEEL_SCALE_MAX);
    // An alarm angle at or below the caution angle would render a zero-width caution band and an
    // alarm band starting before the caution it is meant to escalate from.
    return Math.max(alarm, this.cautionAngle() + 1);
  });

  /** Nominal / caution / alarm arcs, mirrored port and starboard. */
  protected readonly heelBands = computed<IHeelBand[]>(() => {
    const caution = this.cautionAngle();
    const alarm = this.alarmAngle();
    const spans: [number, number, string][] = [
      [0, caution, COLOR_NOMINAL],
      [caution, alarm, COLOR_CAUTION],
      [alarm, HEEL_SCALE_MAX + 1, COLOR_ALARM]
    ];
    const bands: IHeelBand[] = [];
    for (const [from, to, fill] of spans) {
      if (to <= from) continue;
      bands.push({ d: bandPath(BAND_R_INNER, BAND_R_OUTER, from, to), fill });
      bands.push({ d: bandPath(BAND_R_INNER, BAND_R_OUTER, -to, -from), fill });
    }
    return bands;
  });

  /** The red index marking the configured alarm angle, port and starboard. */
  protected readonly limitIndexes = computed<ILimitIndex[]>(() =>
    [this.alarmAngle(), -this.alarmAngle()].map(a => {
      const [x1, y1] = polar(LIMIT_R_OUTER, a);
      const [x2, y2] = polar(LIMIT_R_INNER, a);
      return { x1, y1, x2, y2 };
    })
  );

  /** The finish the stored `gauge.faceColor` selects, falling back to the default it ships with. */
  private readonly frameDesign = computed<IFrameDesign>(() => {
    const key = this.runtime.options()?.gauge?.faceColor ?? DEFAULT_FRAME_DESIGN;
    return FRAME_DESIGNS[key] ?? FRAME_DESIGNS[DEFAULT_FRAME_DESIGN];
  });

  protected readonly frameGradients = computed(() =>
    this.frameDesign().gradients.map((g, i) => ({ ...g, id: `skh-fg${i}-${this.id()}` }))
  );

  /** Filled circles making up the finish, innermost last, with gradient references resolved. */
  protected readonly frameLayers = computed(() => {
    const grads = this.frameGradients();
    return this.frameDesign().layers.map(l => ({
      r: l.r,
      fill: l.grad === undefined ? (l.fill ?? 'none') : `url(#${grads[l.grad].id})`
    }));
  });

  /** Empty for every finish but the three brushed ones. */
  protected readonly frameWedges = computed(() => {
    const conical = this.frameDesign().conical;
    if (!conical) return [];
    const suffix = this.id();
    return conicalWedges(
      conical.fractions, conical.colors, CONIC_INNER_R, CONIC_OUTER_R,
      snappedBoundaries(conical.fractions, FRAME_WEDGE_STEPS))
      .map((w, i) => ({ ...w, id: `skh-wg${i}-${suffix}` }));
  });

  // ---- dial face -----------------------------------------------------------
  /** The face the stored `gauge.backgroundColor` selects, falling back to the one it ships with. */
  private readonly backgroundDesign = computed<IBackgroundDesign>(() => {
    const key = this.runtime.options()?.gauge?.backgroundColor ?? DEFAULT_BACKGROUND_DESIGN;
    return BACKGROUND_DESIGNS[key] ?? BACKGROUND_DESIGNS[DEFAULT_BACKGROUND_DESIGN];
  });

  /** Set for the twelve plain finishes and the two brushed ones; null for a texture or a sweep. */
  protected readonly backgroundGradient = computed(() => {
    const g = this.backgroundDesign().gradient;
    return g ? { ...g, id: this.ids().background } : null;
  });

  /** Set for carbon and punchedSheet only, with every tile gradient reference already resolved. */
  protected readonly backgroundTexture = computed(() => {
    const tile = this.backgroundDesign().texture;
    if (!tile) return null;
    const suffix = this.id();
    const gradients = tile.gradients.map((g, i) => ({ ...g, id: `skh-tg${i}-${suffix}` }));
    return {
      id: this.ids().background,
      size: tile.size,
      gradients,
      shapes: tile.shapes.map(shape => ({
        d: shape.d,
        fill: shape.grad === undefined ? (shape.fill ?? 'none') : `url(#${gradients[shape.grad].id})`
      }))
    };
  });

  /**
   * Keeps a texture tile the size steelseries draws it, 12 or 15 device pixels, whatever the widget
   * is painted at. Without it the tile is a fixed fraction of the dial instead, which is right only
   * where the dial happens to be 300px wide and grows with the widget everywhere else: at 380px the
   * weave comes out 27% coarser than a Classic Steel gauge beside it on the same dashboard.
   */
  protected readonly texturePatternTransform = computed(() => {
    // The face is painted inside the overlay group, so that group's own scale is part of how a
    // tile's units end up as pixels.
    const groupScale = this.frameVisible() ? 1 : FRAME_R / FACE_R;
    return `scale(${(VIEWBOX / (this.paintedPx() * groupScale)).toFixed(5)})`;
  });

  /**
   * steelseries scribes its turnings with a half-pixel stroke, so this follows the painted size too.
   * The *number* of turnings is size-dependent there as well (its step is derived from the radius in
   * pixels); regenerating ~180 circles on every resize would cost far more than the difference shows,
   * so the count stays the one the reference draws at 300px.
   */
  protected readonly scribeStrokeWidth = computed(() => {
    const groupScale = this.frameVisible() ? 1 : FRAME_R / FACE_R;
    return (0.5 * VIEWBOX / (this.paintedPx() * groupScale)).toFixed(4);
  });

  /** Set for stainless and turned only. */
  protected readonly backgroundWedges = computed(() => {
    const conical = this.backgroundDesign().conical;
    if (!conical) return [];
    const suffix = this.id();
    return conicalWedges(conical.fractions, conical.colors, 0, FACE_SHADOW_R, FACE_WEDGE_BOUNDARIES, FACE_WEDGE_GRAD_R)
      .map((w, i) => ({ ...w, id: `skh-bw${i}-${suffix}` }));
  });

  /** The lathe turnings, for the one finish that has them. */
  protected readonly turnedScribes = computed(() => this.backgroundDesign().scribed ? TURNED_SCRIBES : []);

  /**
   * What the face disc itself is painted with. A sweep covers it with wedges, so there it is only
   * the backstop that keeps the hairlines between wedges from showing the tile behind.
   */
  protected readonly faceFill = computed(() => {
    const design = this.backgroundDesign();
    return design.gradient || design.texture ? `url(#${this.ids().background})` : design.halo;
  });

  /** steelseries lays its side vignette over the textured finishes only. */
  protected readonly faceVignette = computed(() => this.backgroundDesign().vignette === true);

  // Dial ink follows the face, exactly as steelseries' tick labels follow their background's
  // labelColor / symbolColor. Without this a white or beige face would carry white numerals.
  protected readonly labelColor = computed(() => this.backgroundDesign().label);
  protected readonly symbolColor = computed(() => this.backgroundDesign().symbol);
  protected readonly haloColor = computed(() => this.backgroundDesign().halo);

  // ---- animated transforms -------------------------------------------------
  protected readonly worldTransform = computed(() => {
    const roll = this.rollDeg() ?? 0;
    const pitch = clamp(this.pitchDeg() ?? 0, -40, 40);
    return `rotate(${(-roll).toFixed(2)} ${CX} ${CY}) translate(0 ${(pitch * PITCH_PX_PER_DEG).toFixed(2)})`;
  });

  protected readonly pointerTransform = computed(() => {
    // The scale stops at 45°, so past that the index parks just off the last mark rather than
    // running round the dial, while the horizon itself keeps rotating truthfully.
    const roll = clamp(this.rollDeg() ?? 0, -HEEL_SCALE_MAX - 3, HEEL_SCALE_MAX + 3);
    return `rotate(${roll.toFixed(2)} ${CX} ${CY})`;
  });

  protected readonly motionTransition = computed(() => {
    const ms = this.runtime.options()?.updateInterval ?? 1000;
    return `transform ${Math.max(100, ms * 0.95)}ms linear`;
  });

  // ---- readouts ------------------------------------------------------------
  private readonly decimals = computed(() => this.runtime.options()?.numDecimal ?? 1);

  protected readonly heelText = computed(() => {
    const roll = this.rollDeg();
    if (roll == null) return '--';
    const side = roll > 0.35 ? 'STBD' : roll < -0.35 ? 'PORT' : 'LEVEL';
    return `${Math.abs(roll).toFixed(this.decimals())}° ${side}`;
  });

  protected readonly trimText = computed(() => {
    const pitch = this.pitchDeg();
    if (pitch == null) return 'TRIM --';
    return `TRIM ${pitch >= 0 ? '+' : '−'}${Math.abs(pitch).toFixed(this.decimals())}°`;
  });

  protected readonly ariaLabel = computed(() =>
    this.noData() ? 'Sea horizon: no attitude data' : `Sea horizon: heel ${this.heelText()}, ${this.trimText()}`
  );

  // ---- gradient / clip ids, namespaced per widget instance ------------------
  // Several of these gauges can share a dashboard, and a duplicate gradient id would have every
  // instance paint with whichever definition the document happened to resolve first.
  protected readonly ids = computed(() => {
    const suffix = this.id();
    return {
      sky: `skh-sky-${suffix}`,
      sea: `skh-sea-${suffix}`,
      glass: `skh-glass-${suffix}`,
      shadow: `skh-shadow-${suffix}`,
      vignette: `skh-vignette-${suffix}`,
      lcdBezel: `skh-lcdb-${suffix}`,
      lcdFace: `skh-lcdf-${suffix}`,
      window: `skh-window-${suffix}`,
      background: `skh-bg-${suffix}`,
      face: `skh-face-${suffix}`
    };
  });

  protected readonly url = computed(() => {
    const r = this.ids();
    return {
      sky: `url(#${r.sky})`, sea: `url(#${r.sea})`, glass: `url(#${r.glass})`,
      shadow: `url(#${r.shadow})`, vignette: `url(#${r.vignette})`,
      lcdBezel: `url(#${r.lcdBezel})`, lcdFace: `url(#${r.lcdFace})`, window: `url(#${r.window})`,
      background: `url(#${r.background})`, face: `url(#${r.face})`
    };
  });

  constructor() {
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      const pathCfg = cfg.paths?.['gaugePitchPath'];
      const signature = widgetPathSignature(pathCfg);
      untracked(() => {
        // A re-point rebuilds the subscription, but suppressBootstrapNull filters the replayed
        // leading null — against a path that reports nothing the callback never runs, and the
        // previous path's reading would stay on the dial as a live reading of the new one.
        if (this.pitchRepoint.repointed(signature)) {
          this.rawPitch.set(null);
          this.lastPitchAt = null;
          this.disarmTransitions();
        }
        if (!pathCfg?.path) return;
        // The callback is a stable class field: the streams directive rebuilds the whole pipeline
        // when it is handed a different function, so a fresh closure here would tear down and
        // re-subscribe both paths on every unrelated config edit (finish, damping, an invert flag).
        this.streams.observe('gaugePitchPath', this.onPitch, 'pitch');
      });
    });

    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      const pathCfg = cfg.paths?.['gaugeRollPath'];
      const signature = widgetPathSignature(pathCfg);
      untracked(() => {
        if (this.rollRepoint.repointed(signature)) {
          this.rawRoll.set(null);
          this.lastRollAt = null;
          this.disarmTransitions();
        }
        if (!pathCfg?.path) return;
        this.streams.observe('gaugeRollPath', this.onRoll, 'roll');
      });
    });

    this.observePaintedSize();
    this.destroyRef.onDestroy(() => this.disarmTransitions());
  }

  /**
   * Track the painted edge length for the texture tiles. `preserveAspectRatio="xMidYMid meet"` puts
   * the instrument in the largest square that fits, so that is the smaller of the two box sides.
   *
   * Floored to whole pixels: `contentRect` is fractional, and during a drag every frame would
   * otherwise carry a new value and re-tile the face. A sub-pixel difference in a 12px tile is
   * invisible, and an unchanged whole number is dropped by the signal's own equality check, so a
   * drag re-tiles only when the side actually crosses a pixel — the same "skip a resize that does
   * not change the side" rule the steel compass applies, without its repaint debounce, which is
   * there for the library's layer rebuild and has nothing to gate here.
   */
  private observePaintedSize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const painted = Math.floor(Math.min(box.width, box.height));
      if (painted > 0) this.paintedPx.set(painted);
    });
    observer.observe(this.host.nativeElement as HTMLElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  /** Stream callback for the pitch sub-field: damp the sample, then settle the transition gate. */
  private readonly onPitch = (pkt: IPathUpdate): void => {
    this.rawPitch.set(this.damp(this.rawPitch(), pkt?.data?.value as number | null | undefined, 'pitch'));
    this.settleTransitions();
  };

  /** Stream callback for the roll sub-field: damp the sample, then settle the transition gate. */
  private readonly onRoll = (pkt: IPathUpdate): void => {
    this.rawRoll.set(this.damp(this.rawRoll(), pkt?.data?.value as number | null | undefined, 'roll'));
    this.settleTransitions();
  };

  /**
   * Arm transitions one frame after a reading lands, so that reading is drawn without one and only
   * later readings animate; drop them the moment the dial has nothing to show.
   */
  private settleTransitions(): void {
    if (this.noData()) {
      this.disarmTransitions();
      return;
    }
    if (this.ready() || this.transitionFrame !== null) return;
    this.transitionFrame = requestAnimationFrame(() => {
      this.transitionFrame = null;
      this.ready.set(true);
    });
  }

  private disarmTransitions(): void {
    if (this.transitionFrame !== null) {
      cancelAnimationFrame(this.transitionFrame);
      this.transitionFrame = null;
    }
    this.ready.set(false);
  }

  /**
   * The damping time constant as honoured, in seconds: the stored value confined to [0, MAX_DAMPING_S]
   * the same way the heel angles are confined to the scale, so an off-menu value cannot freeze the
   * dial. Anything that is not a finite number is no damping.
   */
  private readonly dampingSeconds = computed(() => {
    const raw = this.runtime.options()?.gauge?.damping;
    return clamp(typeof raw === 'number' && isFinite(raw) ? raw : 0, 0, MAX_DAMPING_S);
  });

  /**
   * Exponential smoothing with a configurable time constant. Attitude off a real IMU in a seaway is
   * noisy at a level an aviation instrument never has to handle, and an undamped dial in 20 knots
   * reads as broken. A time constant of 0 passes the sample straight through.
   */
  private damp(previous: number | null, next: number | null | undefined, axis: 'pitch' | 'roll'): number | null {
    if (next == null || !isFinite(next)) return null;
    const tau = this.dampingSeconds();
    const now = Date.now();
    const last = axis === 'pitch' ? this.lastPitchAt : this.lastRollAt;
    if (axis === 'pitch') this.lastPitchAt = now; else this.lastRollAt = now;

    if (!(tau > 0) || previous == null || last == null) return next;
    const dt = (now - last) / 1000;
    if (dt <= 0) return previous;
    const alpha = 1 - Math.exp(-dt / tau);
    return previous + alpha * (next - previous);
  }
}
