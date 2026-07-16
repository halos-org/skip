import { describe, expect, it } from 'vitest';
import { getBooleanControlLayout, measureBooleanControlsHeight, MIN_BOOLEAN_CONTROL_HEIGHT, MIN_BOOLEAN_LABEL_WIDTH } from './boolean-control-layout.util';

describe('boolean-control-layout util', () => {
  const measureTextWidth = (text: string, fontSize: number): number => text.length * fontSize * 0.6;

  it('uses the full vertical budget when labels fit', () => {
    const height = measureBooleanControlsHeight(
      320,
      200,
      [
        { type: '1', ctrlLabel: 'Port' },
        { type: '3', ctrlLabel: 'Stbd' },
      ],
      measureTextWidth,
    );

    expect(height).toBe(100);
  });

  it('floors the control height at the touch-target minimum instead of collapsing to fit a long label (#318)', () => {
    const height = measureBooleanControlsHeight(
      180,
      200,
      [{ type: '1', ctrlLabel: 'Very long generator control label' }],
      measureTextWidth,
    );

    // Old behaviour shrank the control to a sub-tap sliver (~19px) so the label fit;
    // now the label ellipsizes and the control stays tappable.
    expect(height).toBe(MIN_BOOLEAN_CONTROL_HEIGHT);
  });

  it('does not shrink every control in a panel just because one label is long (#318)', () => {
    const height = measureBooleanControlsHeight(
      220,
      300,
      [
        { type: '1', ctrlLabel: 'Nav' },
        { type: '3', ctrlLabel: 'Aux' },
        { type: '2', ctrlLabel: 'Emergency Bilge Pump Override Switch' },
      ],
      measureTextWidth,
    );

    // maxByPanel = 100; the one long label would collapse all three to ~23px, but
    // the shared height floors at the minimum instead.
    expect(height).toBe(MIN_BOOLEAN_CONTROL_HEIGHT);
  });

  it('backs a narrow switch tile off the floor to keep its label visible (#318)', () => {
    const height = measureBooleanControlsHeight(
      60,
      200,
      [{ type: '1', ctrlLabel: 'Nav' }],
      measureTextWidth,
    );

    // At the 44px floor the height-scaled shape lane would clamp the label lane to 0
    // and hide the label, so the height backs off toward the fit-height where the
    // label is still visible.
    const layout = getBooleanControlLayout('1', 60, height);
    expect(height).toBeLessThan(MIN_BOOLEAN_CONTROL_HEIGHT);
    expect(layout.labelWidth).toBeGreaterThan(0);
    expect(measureTextWidth('Nav', layout.labelFontSize)).toBeLessThanOrEqual(layout.labelWidth);
  });

  it('is monotonic in tile height: a taller tile never shrinks the control (#318)', () => {
    const controls = [{ type: '1', ctrlLabel: 'Navigation Lights' }];
    // panelWidth 91 is the band where the switch label lane straddles 24px across
    // floored 43 vs 44 — the case an all-or-nothing gate collapsed on resize.
    const heights = [40, 43, 44, 60, 200].map(ph => measureBooleanControlsHeight(91, ph, controls, measureTextWidth));
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
    }
    // and it settles near the floor, never crashing back to the tiny fit-height.
    expect(heights[heights.length - 1]).toBeGreaterThanOrEqual(40);
  });

  it('does not drop a clean control to the fit-height because a sibling label is marginal (#318)', () => {
    const height = measureBooleanControlsHeight(
      91,
      400,
      [
        { type: '1', ctrlLabel: '' },
        { type: '1', ctrlLabel: 'Navigation Lights' },
      ],
      measureTextWidth,
    );

    // The empty control renders fine at the floor; a sibling whose lane is ~1px
    // short must not collapse the whole panel to a sub-tap height.
    expect(height).toBeGreaterThanOrEqual(40);
  });

  it('holds the tap-target floor for an empty-labeled shape control on a narrow tile (#318)', () => {
    const height = measureBooleanControlsHeight(
      80,
      300,
      [
        { type: '1', ctrlLabel: '' },
        { type: '2', ctrlLabel: 'Emergency Bilge Pump Override Switch' },
      ],
      measureTextWidth,
    );

    // The empty switch has no label to keep legible, so it must not drag the shared
    // height below the floor — that would reintroduce #318's sub-tap slivers.
    expect(height).toBe(MIN_BOOLEAN_CONTROL_HEIGHT);
  });

  it('treats a whitespace-only label as empty for the floor (#318)', () => {
    const height = measureBooleanControlsHeight(
      80,
      300,
      [{ type: '1', ctrlLabel: '   ' }],
      measureTextWidth,
    );

    expect(height).toBe(MIN_BOOLEAN_CONTROL_HEIGHT);
  });

  it('keeps a legible label lane at the floor on a roomy tile (does not over-ellipsize)', () => {
    const height = measureBooleanControlsHeight(
      180,
      200,
      [{ type: '1', ctrlLabel: 'Very long generator control label' }],
      measureTextWidth,
    );

    // 180px is wide enough that the floored 44px control still leaves a usable lane.
    expect(height).toBe(MIN_BOOLEAN_CONTROL_HEIGHT);
    expect(getBooleanControlLayout('1', 180, height).labelWidth).toBeGreaterThanOrEqual(MIN_BOOLEAN_LABEL_WIDTH);
  });

  it('lets a long-labeled button drive the backoff without an empty switch sibling blocking or over-scaling it (#318)', () => {
    const height = measureBooleanControlsHeight(
      50,
      300,
      [
        { type: '2', ctrlLabel: 'Emergency Bilge Pump Override' },
        { type: '1', ctrlLabel: '' },
      ],
      measureTextWidth,
    );

    // The button's starved lane drives the shared height down; the empty switch
    // neither blocks that backoff nor is scaled above the floor by it.
    expect(height).toBeLessThan(MIN_BOOLEAN_CONTROL_HEIGHT);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('degrades to the largest height the panel allows when it cannot fit even the floor', () => {
    const controls = [
      { type: '1', ctrlLabel: 'C0' }, { type: '1', ctrlLabel: 'C1' }, { type: '1', ctrlLabel: 'C2' },
      { type: '1', ctrlLabel: 'C3' }, { type: '1', ctrlLabel: 'C4' }, { type: '1', ctrlLabel: 'C5' },
    ];
    const height = measureBooleanControlsHeight(320, 120, controls, measureTextWidth);

    // 6 controls in 120px => 20px each, below the floor: take all the panel allows, never less.
    expect(height).toBe(20);
    expect(height).toBeLessThan(MIN_BOOLEAN_CONTROL_HEIGHT);
  });

  it('gives button labels more horizontal room than switch labels', () => {
    const switchLayout = getBooleanControlLayout('1', 220, 35);
    const buttonLayout = getBooleanControlLayout('2', 220, 35);

    expect(buttonLayout.labelWidth).toBeGreaterThan(switchLayout.labelWidth);
  });

  it('scales the OFF-state stroke widths with height', () => {
    const base = getBooleanControlLayout('1', 220, 35);
    expect(base.switchStrokeWidth).toBe(1.5);
    expect(base.lightStrokeWidth).toBe(3);

    const doubled = getBooleanControlLayout('3', 220, 70);
    expect(doubled.switchStrokeWidth).toBe(3);
    expect(doubled.lightStrokeWidth).toBe(6);
  });

  it('keeps every geometry field finite and non-negative for degenerate dimensions', () => {
    const cases: [number, number][] = [[0, 0], [-100, 35], [180, -50], [-10, -10]];
    for (const [width, height] of cases) {
      for (const type of ['1', '2', '3']) {
        const layout = getBooleanControlLayout(type, width, height) as unknown as Record<string, number>;
        for (const value of Object.values(layout)) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('returns 0 for an empty control set', () => {
    expect(measureBooleanControlsHeight(320, 200, [], measureTextWidth)).toBe(0);
  });

  it('terminates with a finite height of at least 1 for a label that cannot fit', () => {
    const height = measureBooleanControlsHeight(
      20,
      200,
      [{ type: '1', ctrlLabel: 'A label far wider than a twenty pixel panel can ever hold' }],
      measureTextWidth,
    );

    expect(Number.isFinite(height)).toBe(true);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('returns a finite, non-negative height when the panel height is zero', () => {
    const height = measureBooleanControlsHeight(
      320,
      0,
      [{ type: '1', ctrlLabel: 'Port' }],
      measureTextWidth,
    );

    expect(Number.isFinite(height)).toBe(true);
    expect(height).toBeGreaterThanOrEqual(0);
  });
});
