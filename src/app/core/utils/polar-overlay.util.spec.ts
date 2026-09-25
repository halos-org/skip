import { describe, expect, it } from 'vitest';
import { Polar, toCanonicalPolarTable } from './polar-engine.util';
import {
  OverlayPoint,
  interpolateOverlay,
  OverlayScale,
  POLAR_CURVE_TWA_STEP,
  VMC_HEADING_STEP,
  normalizeRadians,
  polarCurve,
  polarSpeedProfile,
  speedToRadius,
  vmcCurve,
  vmcDotRadius,
  vmcEdgeRuns
} from './polar-overlay.util';
import hurmaPolar from './polar-engine.hurma-polar.fixture.json';

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const PEAK_RADIUS = 300;
const DIAL_RADIUS = 350;
const FINE_STEP = 0.01 * DEG;
const EXACT = 1e-9;

function polarFrom(source: unknown): Polar {
  const result = toCanonicalPolarTable(source);
  if (!result.ok) throw new Error(`table rejected: ${result.reason}`);
  return new Polar(result.table);
}

function siTable(tws: number[], twaDeg: number[], matrix: number[][]): object {
  return {
    kind: 'polarTable',
    units: { tws: 'm/s', twa: 'rad', boatSpeed: 'm/s' },
    symmetry: { portStarboardSymmetric: true },
    axes: { tws, twa: twaDeg.map(value => value * DEG) },
    values: { boatSpeedMatrix: matrix }
  };
}

/** Beat angle 40° in both columns, peak 6.4 m/s at TWA 110° and TWS 8 m/s. */
const synthetic = polarFrom(siTable(
  [4, 8],
  [40, 50, 60, 75, 90, 110, 130, 150, 165, 180],
  [
    [3.0, 3.4, 3.7, 3.9, 4.0, 3.9, 3.6, 3.2, 2.9, 2.7],
    [4.8, 5.4, 5.8, 6.1, 6.3, 6.4, 6.2, 5.6, 5.1, 4.8]
  ]
));
const SYNTHETIC_TOP_TWS = 8;
const hurma = polarFrom(hurmaPolar);

function scaleFor(polar: Polar): OverlayScale {
  const peakSpeed = polar.peakSpeed();
  if (peakSpeed === null) throw new Error('polar has no peak speed');
  return { peakSpeed, peakRadius: PEAK_RADIUS, dialRadius: DIAL_RADIUS };
}

/** Signed difference a − b wrapped to (−π, π]. */
function angleDiff(a: number, b: number): number {
  const wrapped = ((a - b) % TWO_PI + TWO_PI) % TWO_PI;
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped;
}

function expectAllFinite(points: readonly OverlayPoint[]): void {
  for (const point of points) {
    expect(Number.isFinite(point.angle)).toBe(true);
    expect(Number.isFinite(point.r)).toBe(true);
    expect(point.r).toBeGreaterThanOrEqual(0);
  }
}

/** The heading that maximizes polar speed · cos(heading − BTW), searched at 0.01° resolution. */
function analyticBestHeading(polar: Polar, tws: number, twd: number, btw: number): number {
  let best = { heading: 0, vmc: -Infinity };
  for (let heading = 0; heading < TWO_PI; heading += FINE_STEP) {
    const speed = polar.speedAt({ tws, twa: angleDiff(twd, heading) }).value ?? 0;
    const vmc = speed * Math.cos(heading - btw);
    if (vmc > best.vmc) best = { heading, vmc };
  }
  return best.heading;
}

function longestSpoke(points: readonly OverlayPoint[]): OverlayPoint {
  return points.reduce((best, point) => point.r > best.r ? point : best);
}

function pointAt(points: readonly OverlayPoint[], angle: number): OverlayPoint {
  const match = points.find(point => Math.abs(angleDiff(point.angle, angle)) < EXACT);
  if (!match) throw new Error(`no point at ${angle / DEG}°`);
  return match;
}

describe('polar-overlay.util', () => {
  describe('speedToRadius', () => {
    const scale: OverlayScale = { peakSpeed: 6, peakRadius: PEAK_RADIUS, dialRadius: DIAL_RADIUS };

    it('maps the peak speed to the peak radius and half the peak to half of it', () => {
      expect(speedToRadius(6, scale)).toBeCloseTo(PEAK_RADIUS, 9);
      expect(speedToRadius(3, scale)).toBeCloseTo(PEAK_RADIUS / 2, 9);
    });

    it('leaves a radius between the peak and the dial radius unclamped', () => {
      expect(speedToRadius(6.6, scale)).toBeCloseTo(330, 9);
    });

    it('clamps a radius past the dial radius to the dial radius', () => {
      expect(speedToRadius(9, scale)).toBe(DIAL_RADIUS);
      expect(speedToRadius(Infinity, scale)).toBe(DIAL_RADIUS);
    });

    it('maps zero, negative and non-finite speeds, and a zero peak, to zero', () => {
      expect(speedToRadius(0, scale)).toBe(0);
      expect(speedToRadius(-1, scale)).toBe(0);
      expect(speedToRadius(Number.NaN, scale)).toBe(0);
      expect(speedToRadius(3, { ...scale, peakSpeed: 0 })).toBe(0);
    });
  });

  describe('polarCurve', () => {
    const scale = scaleFor(synthetic);

    it('is an open arc from beat angle to beat angle with no sample inside the in-irons wedge', () => {
      const points = polarCurve(synthetic, 6, 1, scale);
      const range = synthetic.rangeAt({ tws: 6 }).value;
      if (!range) throw new Error('no range');

      expect(points.some(point => point.r === 0 && point.angle === 0)).toBe(false);
      for (const point of points) {
        expect(Math.abs(point.angle)).toBeGreaterThanOrEqual(range.minTwa - EXACT);
        expect(Math.abs(point.angle)).toBeLessThanOrEqual(range.maxTwa + EXACT);
      }
      expect(points[0].angle).toBeCloseTo(-range.minTwa, 9);
      expect(points[points.length - 1].angle).toBeCloseTo(range.minTwa, 9);
    });

    it('samples TWA no coarser than the fixed step', () => {
      const points = polarCurve(synthetic, 6, 1, scale);
      const half = points.slice(0, points.length / 2);
      for (let i = 1; i < half.length; i += 1) {
        expect(Math.abs(half[i].angle - half[i - 1].angle)).toBeLessThanOrEqual(POLAR_CURVE_TWA_STEP + EXACT);
      }
    });

    it('is symmetric about the wind axis', () => {
      const points = polarCurve(hurma, 5, 1, scaleFor(hurma));
      const n = points.length;
      for (let i = 0; i < n; i += 1) {
        expect(points[i].angle).toBeCloseTo(-points[n - 1 - i].angle, 12);
        expect(points[i].r).toBeCloseTo(points[n - 1 - i].r, 12);
      }
    });

    it('puts the sample for TWA α at heading −α from the wind, radius from the polar speed at |α|', () => {
      const points = polarCurve(synthetic, 6, 1, scale);
      for (const point of points) {
        const twa = -point.angle;
        const speed = synthetic.speedAt({ tws: 6, twa: Math.abs(twa) }).value ?? 0;
        expect(point.r).toBeCloseTo(speedToRadius(speed, scale), 9);
      }
      expect(points.some(point => point.angle > 0 && point.r > 0)).toBe(true);
      expect(points.some(point => point.angle < 0 && point.r > 0)).toBe(true);
    });

    it('reaches the peak radius at the peak TWS and never exceeds it at performance factor 1', () => {
      const points = polarCurve(synthetic, SYNTHETIC_TOP_TWS, 1, scale);
      const peakTwa = 110 * DEG;
      const nearPeak = points.filter(point => Math.abs(Math.abs(point.angle) - peakTwa) <= POLAR_CURVE_TWA_STEP);
      expect(Math.max(...nearPeak.map(point => point.r))).toBeGreaterThan(PEAK_RADIUS * 0.99);
      expect(Math.max(...points.map(point => point.r))).toBeLessThanOrEqual(PEAK_RADIUS + EXACT);
    });

    it('draws the highest-column curve for a TWS above the table', () => {
      expect(polarCurve(synthetic, 20, 1, scale)).toEqual(polarCurve(synthetic, SYNTHETIC_TOP_TWS, 1, scale));
    });

    it('scales the curve down in proportion toward zero for a TWS below the lowest column', () => {
      const lowest = polarCurve(synthetic, 4, 1, scale);
      const half = polarCurve(synthetic, 2, 1, scale);
      expect(half.length).toBe(lowest.length);
      expect(Math.max(...half.map(point => point.r))).toBeGreaterThan(0);
      half.forEach((point, index) => {
        expect(point.angle).toBeCloseTo(lowest[index].angle, 12);
        expect(Math.abs(point.r - lowest[index].r / 2)).toBeLessThan(0.01);
      });
    });

    it('shrinks radii by the performance factor against the fixed scale', () => {
      const full = polarCurve(synthetic, 6, 1, scale);
      const reduced = polarCurve(synthetic, 6, 0.8, scale);
      expect(reduced.length).toBe(full.length);
      reduced.forEach((point, index) => {
        expect(point.angle).toBe(full[index].angle);
        expect(point.r).toBeCloseTo(full[index].r * 0.8, 9);
      });
    });

    it('lets a performance factor above 1 exceed the peak radius and clamps at the dial', () => {
      const points = polarCurve(synthetic, SYNTHETIC_TOP_TWS, 1.5, scale);
      expect(Math.max(...points.map(point => point.r))).toBe(DIAL_RADIUS);
    });

    it('gives a degenerate curve without NaN at TWS 0', () => {
      const points = polarCurve(synthetic, 0, 1, scale);
      expectAllFinite(points);
      expect(points.every(point => point.r === 0)).toBe(true);
    });

    it('gives a degenerate curve without NaN for an all-zero table', () => {
      const empty = polarFrom(siTable([3, 6], [45, 90], [[0, 0], [0, 0]]));
      const points = polarCurve(empty, 5, 1, { peakSpeed: 0, peakRadius: PEAK_RADIUS, dialRadius: DIAL_RADIUS });
      expectAllFinite(points);
      expect(points.every(point => point.r === 0)).toBe(true);
    });

    it('stays finite and inside the dial for the test-server polar across its TWS range', () => {
      const hurmaScale = scaleFor(hurma);
      for (const tws of [0, 1, 2.5722, 4, 6.1733, 9.26, 15]) {
        const points = polarCurve(hurma, tws, 1, hurmaScale);
        expectAllFinite(points);
        expect(Math.max(...points.map(point => point.r))).toBeLessThanOrEqual(PEAK_RADIUS + EXACT);
      }
    });
  });

  describe('vmcCurve', () => {
    const scale = scaleFor(synthetic);
    const profile = polarSpeedProfile(synthetic, 6, 1);

    it('samples the full circle of headings at the fixed step', () => {
      const points = vmcCurve(profile, 0.3, 1.2, scale);
      expect(points.length).toBe(Math.round(TWO_PI / VMC_HEADING_STEP));
      points.forEach((point, index) => {
        const next = points[(index + 1) % points.length];
        expect(angleDiff(next.angle, point.angle)).toBeCloseTo(VMC_HEADING_STEP, 9);
      });
    });

    it('computes each spoke as polar speed · cos(heading − BTW), clipped at zero', () => {
      const twd = 0.3;
      const btw = 1.2;
      for (const point of vmcCurve(profile, twd, btw, scale)) {
        const speed = synthetic.speedAt({ tws: 6, twa: angleDiff(twd, point.angle) }).value ?? 0;
        const vmc = Math.max(0, speed * Math.cos(point.angle - btw));
        expect(point.r).toBeCloseTo(speedToRadius(vmc, scale), 9);
      }
    });

    const optimumCases: { label: string; polar: Polar; tws: number; twd: number; btw: number }[] = [
      { label: 'synthetic, beat to a waypoint 30° off the wind', polar: synthetic, tws: 6, twd: 0, btw: 30 * DEG },
      { label: 'synthetic, reach', polar: synthetic, tws: 6, twd: 200 * DEG, btw: 310 * DEG },
      { label: 'synthetic, run to a waypoint 20° off dead downwind', polar: synthetic, tws: 8, twd: 350 * DEG, btw: 190 * DEG },
      { label: 'test-server polar, beat', polar: hurma, tws: 5, twd: 1.0, btw: 1.3 },
      { label: 'test-server polar, broad reach', polar: hurma, tws: 7, twd: 4.0, btw: 4.0 + 2.8 }
    ];
    for (const { label, polar, tws, twd, btw } of optimumCases) {
      it(`puts the longest spoke within one step of the best heading (${label})`, () => {
        const points = vmcCurve(polarSpeedProfile(polar, tws, 1), twd, btw, scaleFor(polar));
        const best = analyticBestHeading(polar, tws, twd, btw);
        expect(Math.abs(angleDiff(longestSpoke(points).angle, best))).toBeLessThanOrEqual(VMC_HEADING_STEP + EXACT);
      });
    }

    it('gives two symmetric tack lobes for a waypoint dead upwind', () => {
      const twd = 40 * DEG;
      const points = vmcCurve(profile, twd, twd, scale);
      for (const point of points) {
        const offset = angleDiff(point.angle, twd);
        expect(point.r).toBeCloseTo(pointAt(points, twd - offset).r, 9);
        if (Math.abs(offset) >= Math.PI / 2) expect(point.r).toBeCloseTo(0, 9);
      }
      expect(points.some(point => angleDiff(point.angle, twd) > 0 && point.r > 0)).toBe(true);
      expect(points.some(point => angleDiff(point.angle, twd) < 0 && point.r > 0)).toBe(true);
      expect(pointAt(points, twd).r).toBe(0);
    });

    it('gives a lobe on the downwind side only for a waypoint dead downwind', () => {
      const twd = 40 * DEG;
      const btw = twd + Math.PI;
      const points = vmcCurve(profile, twd, btw, scale);
      expect(points.some(point => point.r > 0)).toBe(true);
      for (const point of points) {
        if (Math.cos(point.angle - btw) <= 0) expect(point.r).toBe(0);
      }
    });

    it('leaves the losing tack empty for a waypoint 60° left of the wind with a 40° beat', () => {
      const twd = 0;
      const btw = -60 * DEG;
      const points = vmcCurve(profile, twd, btw, scale);
      // TWA = TWD − heading is negative (wind over port) for headings right of the wind.
      const portTack = points.filter(point => angleDiff(twd, point.angle) < 0);
      const starboardTack = points.filter(point => angleDiff(twd, point.angle) > 0);
      expect(portTack.length).toBeGreaterThan(0);
      expect(portTack.every(point => point.r === 0)).toBe(true);
      expect(starboardTack.some(point => point.r > 0)).toBe(true);
    });

    it('has no gaps or NaN while TWD sweeps across 0 and ±π', () => {
      const expectedLength = Math.round(TWO_PI / VMC_HEADING_STEP);
      for (const twd of [-Math.PI, -Math.PI + 1e-6, -1e-6, 0, 1e-6, Math.PI - 1e-6, Math.PI, 3 * Math.PI, -5]) {
        const points = vmcCurve(profile, twd, 1.0, scale);
        expect(points.length).toBe(expectedLength);
        expectAllFinite(points);
        for (const point of points) {
          expect(point.angle).toBeGreaterThanOrEqual(0);
          expect(point.angle).toBeLessThan(TWO_PI);
        }
        points.forEach((point, index) => {
          const next = points[(index + 1) % points.length];
          expect(angleDiff(next.angle, point.angle)).toBeCloseTo(VMC_HEADING_STEP, 9);
        });
        expect(points.some(point => point.r > 0)).toBe(true);
      }
    });

    it('draws the highest-column curve for a TWS above the table', () => {
      expect(vmcCurve(polarSpeedProfile(synthetic, 20, 1), 0.3, 1.2, scale))
        .toEqual(vmcCurve(polarSpeedProfile(synthetic, SYNTHETIC_TOP_TWS, 1), 0.3, 1.2, scale));
    });

    it('shrinks radii by the performance factor against the fixed scale', () => {
      const full = vmcCurve(polarSpeedProfile(synthetic, 6, 1), 0.3, 1.2, scale);
      const reduced = vmcCurve(polarSpeedProfile(synthetic, 6, 0.8), 0.3, 1.2, scale);
      reduced.forEach((point, index) => expect(point.r).toBeCloseTo(full[index].r * 0.8, 9));
    });

    it('gives a degenerate curve without NaN for TWS 0 and for an all-zero table', () => {
      const zeroTws = vmcCurve(polarSpeedProfile(synthetic, 0, 1), 0.3, 1.2, scale);
      const empty = polarFrom(siTable([3, 6], [45, 90], [[0, 0], [0, 0]]));
      const zeroTable = vmcCurve(polarSpeedProfile(empty, 5, 1), 0.3, 1.2,
        { peakSpeed: 0, peakRadius: PEAK_RADIUS, dialRadius: DIAL_RADIUS });
      for (const points of [zeroTws, zeroTable]) {
        expectAllFinite(points);
        expect(points.every(point => point.r === 0)).toBe(true);
      }
    });
  });

  describe('vmcEdgeRuns', () => {
    const loop = (...radii: number[]): OverlayPoint[] => radii.map((r, index) => ({ angle: index, r }));
    const angles = (runs: OverlayPoint[][]): number[][] => runs.map(run => run.map(point => point.angle));

    it('splits the loop at zero-radius samples into one run per tack', () => {
      expect(angles(vmcEdgeRuns(loop(0, 100, 100, 0, 100, 100)))).toEqual([[1, 2], [4, 5]]);
    });

    it('keeps a run that spans the end of the list whole', () => {
      expect(angles(vmcEdgeRuns(loop(100, 0, 0, 100, 100)))).toEqual([[3, 4, 0]]);
    });

    it('drops a single-sample run, which would stroke nothing', () => {
      expect(angles(vmcEdgeRuns(loop(0, 100, 0, 100, 100)))).toEqual([[3, 4]]);
    });

    it('treats a NaN radius as zero', () => {
      expect(angles(vmcEdgeRuns(loop(100, 100, NaN, 100, 100)))).toEqual([[3, 4, 0, 1]]);
    });

    it('returns no runs when every sample is zero, and the closed loop when none is', () => {
      expect(vmcEdgeRuns(loop(0, 0, 0))).toEqual([]);
      expect(angles(vmcEdgeRuns(loop(100, 100, 100)))).toEqual([[0, 1, 2, 0]]);
    });

    it('outlines each tack of a beat to a waypoint dead upwind, with no sample at the center', () => {
      const runs = vmcEdgeRuns(vmcCurve(polarSpeedProfile(synthetic, 6, 1), 0, 0, scaleFor(synthetic)));
      expect(runs.length).toBe(2);
      expect(runs.flat().every(point => point.r > 0)).toBe(true);
    });
  });

  describe('interpolateOverlay', () => {
    it('moves each sample part way in radius and along the shorter arc in angle', () => {
      const from: OverlayPoint[] = [{ angle: 350 * DEG, r: 100 }, { angle: 90 * DEG, r: 0 }];
      const to: OverlayPoint[] = [{ angle: 10 * DEG, r: 200 }, { angle: 80 * DEG, r: 40 }];
      const [first, second] = interpolateOverlay(from, to, 0.25);
      expect(angleDiff(first.angle, 355 * DEG)).toBeCloseTo(0, 9);
      expect(first.r).toBeCloseTo(125, 9);
      expect(second.angle).toBeCloseTo(87.5 * DEG, 9);
      expect(second.r).toBeCloseTo(10, 9);
    });

    it('lands exactly on the target at the end', () => {
      const to: OverlayPoint[] = [{ angle: 1, r: 50 }];
      expect(interpolateOverlay([{ angle: 2, r: 10 }], to, 1)).toBe(to);
    });

    it('takes the target when the sample counts differ', () => {
      const to: OverlayPoint[] = [{ angle: 1, r: 50 }, { angle: 2, r: 60 }];
      expect(interpolateOverlay([{ angle: 2, r: 10 }], to, 0.5)).toBe(to);
    });
  });

  describe('polarSpeedProfile', () => {
    it('holds the polar speed at every multiple of the heading step from 0 to π, null as zero', () => {
      const profile = polarSpeedProfile(synthetic, 6, 1);
      expect(profile.length).toBe(Math.round(Math.PI / VMC_HEADING_STEP) + 1);
      profile.forEach((speed, k) => {
        const twa = Math.min(Math.PI, k * VMC_HEADING_STEP);
        expect(speed).toBeCloseTo(synthetic.speedAt({ tws: 6, twa }).value ?? 0, 12);
      });
      expect(profile[0]).toBe(0);
      expect(profile[profile.length - 1]).toBeGreaterThan(0);
    });
  });

  describe('dots', () => {
    const scale: OverlayScale = { peakSpeed: 6, peakRadius: PEAK_RADIUS, dialRadius: DIAL_RADIUS };

    it('gives the polar dot the STW radius, which the curve mirrors at negative TWA', () => {
      const curve = polarCurve(synthetic, 6, 1, scaleFor(synthetic));
      const starboard = curve.find(point => point.angle < 0 && point.r > 0);
      if (!starboard) throw new Error('no starboard sample');
      expect(pointAt(curve, -starboard.angle).r).toBeCloseTo(starboard.r, 12);
      expect(speedToRadius(4.5, scale)).toBeCloseTo(225, 9);
    });

    it('gives the VMC dot the scaled STW · cos(HDG − BTW)', () => {
      expect(vmcDotRadius(4, 1.0, 1.0, scale)).toBeCloseTo(200, 9);
      expect(vmcDotRadius(4, 1.0 + 60 * DEG, 1.0, scale)).toBeCloseTo(100, 9);
      expect(vmcDotRadius(4, 350 * DEG, 10 * DEG, scale)).toBeCloseTo(200 * Math.cos(20 * DEG), 9);
    });

    it('returns null for the VMC dot when VMC is zero or less', () => {
      expect(vmcDotRadius(4, 1.0 + 91 * DEG, 1.0, scale)).toBeNull();
      expect(vmcDotRadius(4, 1.0 + 120 * DEG, 1.0, scale)).toBeNull();
      expect(vmcDotRadius(0, 1.0, 1.0, scale)).toBeNull();
    });

    it('clamps the VMC dot to the dial radius', () => {
      expect(vmcDotRadius(20, 1.0, 1.0, scale)).toBe(DIAL_RADIUS);
    });
  });

  describe('normalizeRadians', () => {
    it.each([
      [0, 0],
      [Math.PI, Math.PI],
      [2 * Math.PI, 0],
      [-Math.PI / 2, 1.5 * Math.PI],
      [5 * Math.PI, Math.PI]
    ])('maps %f rad into [0, 2π) as %f', (angle, expected) => {
      expect(normalizeRadians(angle)).toBeCloseTo(expected, 12);
    });
  });
});
