import type { NgGridStackNode, NgGridStackWidget } from 'gridstack/dist/angular';
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

/**
 * A copy of a widget node for duplicate, clipboard, and paste. The root omits `x`, `y`, `id`, and
 * its min/max size limits so the page can place it and {@link assignFreshWidgetIds} can name it.
 * Nested children keep their place and limits inside the group, including id, until that walk
 * rewrites them. Config is deep-copied. Live grid objects, DOM nodes, grid options other than
 * `children`, and `autoOpenOptionsOnCreate` are left out.
 */
export function cloneWidgetSnapshot(source: NgGridStackWidget): NgGridStackWidget {
  return cloneWidgetNode(source, false);
}

/**
 * A group's current children. A live node's `subGridOpts.children` is the list it was loaded with
 * and gridstack never updates it, so a live group is read from its sub-grid the way `grid.save` does.
 */
function groupChildren(source: NgGridStackWidget): NgGridStackWidget[] | undefined {
  const subGrid = (source as NgGridStackNode).subGrid;
  if (subGrid) return subGrid.save(false, false, undefined, source.w) as NgGridStackWidget[];
  const children = source.subGridOpts?.children;
  return Array.isArray(children) ? children : undefined;
}

function cloneWidgetNode(source: NgGridStackWidget, isNestedChild: boolean): NgGridStackWidget {
  const props = source.input?.widgetProperties;
  const snapshot: NgGridStackWidget = {
    w: source.w,
    h: source.h,
    selector: source.selector
  };
  if (isNestedChild) {
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
  if (source.subGridOpts) {
    const children = groupChildren(source);
    snapshot.subGridOpts = children ? { children: children.map(child => cloneWidgetNode(child, true)) } : {};
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
