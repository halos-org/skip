import { describe, expect, it } from 'vitest';
import type { ITheme } from '../../core/services/app-service';
import { getBooleanControlColors } from './boolean-control-colors.util';

const NAMED_COLORS = ['contrast', 'blue', 'green', 'pink', 'orange', 'purple', 'grey', 'yellow'] as const;

function makeTheme(): ITheme {
  const theme: Record<string, string> = {};
  for (const color of NAMED_COLORS) {
    theme[color] = color;
    theme[`${color}Dim`] = `${color}Dim`;
    theme[`${color}Dimmer`] = `${color}Dimmer`;
  }
  return theme as unknown as ITheme;
}

describe('boolean-control-colors util', () => {
  const theme = makeTheme();
  const contrastTriple = { offColor: 'contrastDimmer', labelColor: 'contrastDim', valueColor: 'contrast' };

  it.each([...NAMED_COLORS])('resolves the %s triple from its dimmer/dim/base theme keys', (color) => {
    expect(getBooleanControlColors(theme, color)).toEqual({
      offColor: `${color}Dimmer`,
      labelColor: `${color}Dim`,
      valueColor: color,
    });
  });

  it('falls back to the contrast triple for an unknown color name', () => {
    expect(getBooleanControlColors(theme, 'chartreuse')).toEqual(contrastTriple);
    expect(getBooleanControlColors(theme, '')).toEqual(contrastTriple);
  });

  it('resolves an unknown color identically to the contrast case', () => {
    expect(getBooleanControlColors(theme, 'chartreuse')).toEqual(getBooleanControlColors(theme, 'contrast'));
  });
});
