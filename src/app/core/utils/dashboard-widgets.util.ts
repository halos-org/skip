import type { NgGridStackWidget } from 'gridstack/dist/angular';
import cloneDeep from 'lodash-es/cloneDeep';
import { UUID } from './uuid.util';

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

/** A value that can live in a saved dashboard: no DOM nodes, functions, or class instances. */
function isJsonSafe(value: unknown): boolean {
  if (value == null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Object.values(value).every(isJsonSafe);
  }
  return false;
}

/**
 * A copy of a widget node for duplicate, clipboard, and paste. The root omits `x`, `y`, and `id`
 * so the page can place it and {@link assignFreshWidgetIds} can name it. Nested children keep
 * their place inside the group, including id, until that walk rewrites them. Config is deep-copied.
 * Live grid objects, DOM nodes, and `autoOpenOptionsOnCreate` are left out.
 */
export function cloneWidgetSnapshot(source: NgGridStackWidget): NgGridStackWidget {
  return cloneWidgetNode(source, false);
}

function cloneWidgetNode(source: NgGridStackWidget, keepPlacement: boolean): NgGridStackWidget {
  const props = source.input?.widgetProperties;
  const snapshot: NgGridStackWidget = {
    w: source.w,
    h: source.h,
    selector: source.selector
  };
  if (keepPlacement) {
    if (source.id != null) snapshot.id = source.id;
    if (source.x != null) snapshot.x = source.x;
    if (source.y != null) snapshot.y = source.y;
    if (source.minW != null) snapshot.minW = source.minW;
    if (source.minH != null) snapshot.minH = source.minH;
    if (source.maxW != null) snapshot.maxW = source.maxW;
    if (source.maxH != null) snapshot.maxH = source.maxH;
  }
  if (props?.type) {
    snapshot.input = {
      widgetProperties: {
        type: props.type,
        uuid: props.uuid,
        config: cloneDeep(props.config)
      }
    };
  }
  const opts = source.subGridOpts;
  if (opts) {
    const { children, ...rest } = opts;
    const safeRest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (isJsonSafe(value)) safeRest[key] = cloneDeep(value);
    }
    const clonedChildren = Array.isArray(children)
      ? children.map(child => cloneWidgetNode(child as NgGridStackWidget, true))
      : undefined;
    snapshot.subGridOpts = {
      ...safeRest,
      ...(clonedChildren ? { children: clonedChildren } : {})
    } as NgGridStackWidget['subGridOpts'];
  }
  return snapshot;
}

/**
 * Gives `widget` and every nested group child a new id, kept in sync with `widgetProperties.uuid`.
 * A node with no properties keeps its id; `onMissingProperties` is told, and its children are still walked.
 */
export function assignFreshWidgetIds(
  widget: NgGridStackWidget | null | undefined,
  onMissingProperties?: (widget: NgGridStackWidget | null | undefined) => void
): void {
  const props = widget?.input?.widgetProperties;
  if (!widget || !props) {
    onMissingProperties?.(widget);
  } else {
    const id = UUID.create();
    widget.id = id;
    props.uuid = id;
  }
  const children = widget?.subGridOpts?.children;
  if (!Array.isArray(children)) return;
  for (const child of children) assignFreshWidgetIds(child, onMissingProperties);
}
