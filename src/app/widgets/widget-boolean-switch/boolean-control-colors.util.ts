import type { ITheme } from '../../core/services/app-service';

export interface BooleanControlColors {
  offColor: string;
  labelColor: string;
  valueColor: string;
}

/**
 * Resolves a boolean control's OFF/label/value colors from a named theme color.
 * Shared by the switch and light SVG controls; an unknown name falls back to the
 * contrast triple (the `default` case).
 */
export function getBooleanControlColors(theme: ITheme, colorName: string): BooleanControlColors {
  switch (colorName) {
    case 'blue':
      return { offColor: theme.blueDimmer, labelColor: theme.blueDim, valueColor: theme.blue };
    case 'green':
      return { offColor: theme.greenDimmer, labelColor: theme.greenDim, valueColor: theme.green };
    case 'pink':
      return { offColor: theme.pinkDimmer, labelColor: theme.pinkDim, valueColor: theme.pink };
    case 'orange':
      return { offColor: theme.orangeDimmer, labelColor: theme.orangeDim, valueColor: theme.orange };
    case 'purple':
      return { offColor: theme.purpleDimmer, labelColor: theme.purpleDim, valueColor: theme.purple };
    case 'grey':
      return { offColor: theme.greyDimmer, labelColor: theme.greyDim, valueColor: theme.grey };
    case 'yellow':
      return { offColor: theme.yellowDimmer, labelColor: theme.yellowDim, valueColor: theme.yellow };
    case 'contrast':
    default:
      return { offColor: theme.contrastDimmer, labelColor: theme.contrastDim, valueColor: theme.contrast };
  }
}
