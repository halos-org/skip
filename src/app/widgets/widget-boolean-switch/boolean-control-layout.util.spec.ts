import { describe, expect, it } from 'vitest';
import { getBooleanControlLayout, measureBooleanControlsHeight } from './boolean-control-layout.util';

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

  it('caps height when a long label would overflow', () => {
    const height = measureBooleanControlsHeight(
      180,
      200,
      [{ type: '1', ctrlLabel: 'Very long generator control label' }],
      measureTextWidth,
    );

    expect(height).toBeLessThan(40);
    expect(height).toBeGreaterThan(0);
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
