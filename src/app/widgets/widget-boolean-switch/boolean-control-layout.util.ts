import type { IDynamicControl } from '../../core/interfaces/widgets-interface';

export const BOOLEAN_CONTROL_BASE_HEIGHT = 35;
export const BOOLEAN_CONTROL_BASE_FONT_SIZE = 14;

// Minimum per-control height. A long label must never shrink the shared control
// height below a tappable target (#318) — controls stay this tall and the label
// ellipsizes instead. Only sacrificed when the panel itself can't fit one control
// this tall (many controls in a short tile), or when raising the height would
// starve the label lane on a narrow tile (see MIN_BOOLEAN_LABEL_WIDTH).
export const MIN_BOOLEAN_CONTROL_HEIGHT = 44;

// Minimum label lane to preserve. The switch/light shape lane is height-scaled,
// so raising the height widens the shape and eats horizontal label room. On a
// narrow tile the floor would clamp the label lane to zero and hide the label
// entirely; back off from the floor to keep at least this much lane for it.
export const MIN_BOOLEAN_LABEL_WIDTH = 24;

export interface BooleanControlLayout {
  labelX: number;
  labelWidth: number;
  labelFontSize: number;
  shapeLaneWidth: number;
  switchTrackX: number;
  switchTrackY: number;
  switchTrackWidth: number;
  switchTrackHeight: number;
  switchTrackRadius: number;
  switchKnobOffX: number;
  switchKnobOnX: number;
  switchKnobY: number;
  switchKnobRadius: number;
  switchStrokeWidth: number;
  lightCenterX: number;
  lightCenterY: number;
  lightRadius: number;
  lightStrokeWidth: number;
  buttonX: number;
  buttonY: number;
  buttonWidth: number;
  buttonHeight: number;
  buttonRadius: number;
}

function scaleFactor(height: number): number {
  return Math.max(height, 1) / BOOLEAN_CONTROL_BASE_HEIGHT;
}

export function getBooleanControlLayout(type: string, width: number, height: number): BooleanControlLayout {
  const safeWidth = Math.max(width, 0);
  const scale = scaleFactor(height);
  const shapeLaneWidth = type === '2' ? 0 : 48 * scale;
  const rightPadding = type === '2' ? 12 * scale : 6 * scale;
  const labelX = type === '2' ? 12 * scale : shapeLaneWidth;
  const labelWidth = Math.max(0, safeWidth - labelX - rightPadding);

  // Coordinates are the original 180x35 artwork geometry; every value scales by height/35 (see BOOLEAN_CONTROL_BASE_HEIGHT).
  return {
    labelX,
    labelWidth,
    labelFontSize: BOOLEAN_CONTROL_BASE_FONT_SIZE * scale,
    shapeLaneWidth,
    switchTrackX: 6 * scale,
    switchTrackY: 6 * scale,
    switchTrackWidth: 37.714306 * scale,
    switchTrackHeight: 22 * scale,
    switchTrackRadius: 11 * scale,
    switchKnobOffX: 17.5 * scale,
    switchKnobOnX: 32.5 * scale,
    switchKnobY: 17 * scale,
    switchKnobRadius: 10 * scale,
    switchStrokeWidth: 1.5 * scale,
    lightCenterX: 24.5 * scale,
    lightCenterY: 17.5 * scale,
    lightRadius: 13.5 * scale,
    lightStrokeWidth: 3 * scale,
    buttonX: 6 * scale,
    buttonY: 5 * scale,
    buttonWidth: Math.max(0, safeWidth - (12 * scale)),
    buttonHeight: 25.025183 * scale,
    buttonRadius: 3.6672263 * scale,
  };
}

export function measureBooleanControlsHeight(
  panelWidth: number,
  panelHeight: number,
  controls: Pick<IDynamicControl, 'type' | 'ctrlLabel'>[],
  measureTextWidth: (text: string, fontSize: number) => number,
): number {
  if (controls.length === 0) {
    return 0;
  }

  const maxByPanel = Math.max(1, Math.floor(panelHeight / controls.length));
  let low = 1;
  let high = maxByPanel;
  let best = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const fits = controls.every(ctrl => {
      const layout = getBooleanControlLayout(ctrl.type, panelWidth, mid);
      return measureTextWidth(ctrl.ctrlLabel ?? '', layout.labelFontSize) <= layout.labelWidth;
    });

    if (fits) {
      best = mid;
      low = mid + 1;
      continue;
    }

    high = mid - 1;
  }

  // Floor the shared height at a tappable minimum: a label too long to fit is
  // ellipsized (see the SVG templates) rather than collapsing every control.
  // Never exceed what the panel can fit, so a short/crowded tile still degrades
  // to the largest height it allows.
  // Start at the tappable floor, then back off toward `best` (where every label
  // fully fits) one step at a time while any *labeled* control's height-scaled
  // shape lane would starve its label lane below a legible minimum. The height-
  // scaled shape lane means a taller control leaves less room for its label, so a
  // narrow tile trades a little height for a visible label; a roomy tile keeps the
  // full floor and ellipsizes. Backing off is monotonic in the tile dimensions
  // (no all-or-nothing jump), and an empty/whitespace label is skipped — there is
  // nothing to keep legible, so it never forces a control below the floor.
  let height = Math.min(maxByPanel, Math.max(best, MIN_BOOLEAN_CONTROL_HEIGHT));
  while (
    height > best &&
    controls.some(ctrl =>
      (ctrl.ctrlLabel ?? '').trim() !== '' &&
      getBooleanControlLayout(ctrl.type, panelWidth, height).labelWidth < MIN_BOOLEAN_LABEL_WIDTH)
  ) {
    height--;
  }

  return height;
}
