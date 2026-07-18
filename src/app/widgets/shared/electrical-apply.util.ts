import { States, type TState } from '../../core/interfaces/signalk-interfaces';

/**
 * Shared value-apply helpers for the electrical widget family: the dirty-check
 * snapshot writers, the raw-value coercers, and the severity fold used when a
 * parsed Signal K value is written onto a widget's snapshot. Extracted from the
 * verbatim copies the charger/alternator/inverter/ac widgets carried.
 *
 * solar-charger keeps its own `toStringValue` (which stringifies non-strings)
 * and `resolveMostSevereState` (rank-based ordering); bms uses a different
 * write path entirely. Those variants are behaviorally distinct — see #351.
 */

export function setValue<T, K extends keyof T>(target: T, key: K, nextValue: T[K]): boolean {
  if (Object.is(target[key], nextValue)) {
    return false;
  }

  target[key] = nextValue;
  return true;
}

export function setMetricValue<T, K extends keyof T, S extends keyof T>(
  target: T,
  key: K,
  stateKey: S,
  nextValue: T[K],
  state: TState | null
): boolean {
  const valueChanged = !Object.is(target[key], nextValue);
  const stateChanged = !Object.is(target[stateKey], state);
  if (!valueChanged && !stateChanged) {
    return false;
  }

  target[key] = nextValue;
  target[stateKey] = state as T[S];
  return true;
}

export function toStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
  }

  return null;
}

export function resolveMostSevereState(...states: (TState | null | undefined)[]): TState | null {
  if (states.some(state => state === States.Alert)) return States.Alert;
  if (states.some(state => state === States.Alarm)) return States.Alarm;
  if (states.some(state => state === States.Warn)) return States.Warn;
  if (states.some(state => state === States.Normal)) return States.Normal;
  return null;
}
