/**
 * Folds a new sample into the running min/max the numeric widget displays.
 *
 * A `null` sample (Signal K emits null on timeout/sensor loss) leaves the tracked
 * extremes untouched — it must not reset them. The min/max update is mutually
 * exclusive per call, matching the widget's long-standing behaviour.
 */
export function reduceMinMax(
  min: number | null,
  max: number | null,
  value: number | null
): { min: number | null; max: number | null } {
  if (value === null) {
    return { min, max };
  }
  if (min === null || value < min) {
    return { min: value, max };
  }
  if (max === null || value > max) {
    return { min, max: value };
  }
  return { min, max };
}
