import type { NgGridStackWidget } from 'gridstack/dist/angular';

/**
 * Every widget entry under `entries`, depth first. A group widget hosts a nested gridstack whose
 * children serialize under `subGridOpts.children` as the same node shape, not into the dashboard's
 * flat `configuration`, so a walk of only the top level would skip every grouped widget. Entries are
 * stored data and yielded as they are, malformed ones included.
 */
export function* allWidgets(entries: readonly NgGridStackWidget[]): Generator<NgGridStackWidget> {
  for (const entry of entries) {
    yield entry;
    const children = entry?.subGridOpts?.children;
    if (Array.isArray(children)) yield* allWidgets(children);
  }
}
