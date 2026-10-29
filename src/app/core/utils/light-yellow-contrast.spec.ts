import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** WCAG contrast of a #rrggbb ink against white. */
function contrastOnWhite(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05);
}

describe('light-theme yellow ON ink', () => {
  const line = readFileSync('src/themes/_m3light.scss', 'utf8')
    .split('\n')
    .find(text => text.trimStart().startsWith('yellow:'));

  it('clears 4.1:1 on white, and the dim shades use the same RGB', () => {
    const match = line?.match(
      /yellow:\s*(#[0-9a-fA-F]{6}),\s*yellow-dim:\s*(#[0-9a-fA-F]{8}),\s*yellow-dimmer:\s*(#[0-9a-fA-F]{8})/
    );
    expect(match, 'yellow triple not found in _m3light.scss').toBeTruthy();
    const [, solid, dim, dimmer] = match!;
    // Orange is the lightest other ON accent, at 4.10:1. Yellow has to clear that floor.
    expect(contrastOnWhite(solid)).toBeGreaterThanOrEqual(4.1);
    expect(dim.slice(0, 7).toLowerCase()).toBe(solid.toLowerCase());
    expect(dimmer.slice(0, 7).toLowerCase()).toBe(solid.toLowerCase());
  });
});
