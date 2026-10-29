import { describe, expect, it } from 'vitest';
import type { NgGridStackWidget } from 'gridstack/dist/angular';
import { allWidgets, assignFreshWidgetIds, cloneWidgetSnapshot } from './dashboard-widgets.util';

const ids = (entries: unknown[]): unknown[] =>
  [...allWidgets(entries as NgGridStackWidget[])].map(e => (e as { id?: unknown } | null)?.id ?? e);

describe('allWidgets', () => {
  it('yields every entry depth first, groups included, through nested groups', () => {
    const entries = [
      { id: 'a' },
      { id: 'g1', subGridOpts: { children: [{ id: 'b' }, { id: 'g2', subGridOpts: { children: [{ id: 'c' }] } }] } },
      { id: 'd' }
    ];
    expect(ids(entries)).toEqual(['a', 'g1', 'b', 'g2', 'c', 'd']);
  });

  it('yields malformed entries as they are and descends only into array children', () => {
    const entries = [null, { id: 'g', subGridOpts: { children: 'x' } }, { id: 'h', subGridOpts: {} }];
    expect(ids(entries)).toEqual([null, 'g', 'h']);
  });
});

describe('cloneWidgetSnapshot', () => {
  const leaf = (id: string, extra: Partial<NgGridStackWidget> = {}): NgGridStackWidget => ({
    id, w: 1, h: 1, selector: 'widget-host2',
    input: { widgetProperties: { type: 'widget-numeric', uuid: id, config: { displayName: id } } },
    ...extra
  });
  const group = (children: NgGridStackWidget[]): NgGridStackWidget => ({
    w: 4, h: 4, selector: 'group-widget',
    input: { widgetProperties: { type: 'group-widget', uuid: 'g', config: { displayName: 'Group' } } },
    subGridOpts: { column: 4, row: 4, maxRow: 4, children }
  });
  const withLiveChildren = (node: NgGridStackWidget, live: NgGridStackWidget[]): NgGridStackWidget =>
    ({ ...node, subGrid: { save: () => live } }) as unknown as NgGridStackWidget;

  it('drops the root placement but keeps a nested child placement, size limits and id', () => {
    const source = group([leaf('c', { x: 2, y: 1, minW: 2 })]);
    const copy = cloneWidgetSnapshot({ ...source, x: 2, y: 3, id: 'g', minW: 3 });
    const child = copy.subGridOpts?.children?.[0];
    expect(copy.x).toBeUndefined();
    expect(copy.y).toBeUndefined();
    expect(copy.id).toBeUndefined();
    expect(copy.minW).toBeUndefined();
    expect(child).toMatchObject({ id: 'c', x: 2, y: 1, minW: 2 });
    expect(child?.input?.widgetProperties.uuid).toBe('c');
  });

  it('deep-copies a nested child config', () => {
    const source = group([leaf('c')]);
    const copy = cloneWidgetSnapshot(source);
    source.subGridOpts!.children![0].input!.widgetProperties.config.displayName = 'Mutated';
    expect(copy.subGridOpts?.children?.[0]?.input?.widgetProperties.config.displayName).toBe('c');
  });

  it('copies a live group from its sub-grid, not the load-time children list', () => {
    const source = withLiveChildren(group([leaf('stale')]), [leaf('a', { x: 0, y: 0 }), leaf('b', { x: 1, y: 0 })]);
    const copy = cloneWidgetSnapshot(source);
    expect(copy.subGridOpts?.children?.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('copies a stored group from its saved children list', () => {
    const copy = cloneWidgetSnapshot(group([leaf('saved')]));
    expect(copy.subGridOpts?.children?.map(c => c.id)).toEqual(['saved']);
  });

  it('keeps only the children of the group grid options', () => {
    const copy = cloneWidgetSnapshot(group([leaf('c')]));
    expect(Object.keys(copy.subGridOpts ?? {})).toEqual(['children']);
  });
});

describe('assignFreshWidgetIds', () => {
  it('rewrites a child and a grandchild, and leaves a property-less id while still walking', () => {
    const tree: NgGridStackWidget = {
      id: 'g',
      input: { widgetProperties: { type: 'group-widget', uuid: 'g', config: {} } },
      subGridOpts: {
        children: [
          { id: 'bare', subGridOpts: { children: [
            { id: 'leaf', input: { widgetProperties: { type: 'widget-numeric', uuid: 'leaf', config: {} } } }
          ] } }
        ]
      }
    };
    const missing: unknown[] = [];
    assignFreshWidgetIds(tree, widget => missing.push(widget));
    expect(tree.id).not.toBe('g');
    expect(tree.input?.widgetProperties.uuid).toBe(tree.id);
    const bare = tree.subGridOpts?.children?.[0];
    expect(bare?.id).toBe('bare');
    const leaf = bare?.subGridOpts?.children?.[0];
    expect(leaf?.id).not.toBe('leaf');
    expect(leaf?.input?.widgetProperties.uuid).toBe(leaf?.id);
    expect(missing).toEqual([bare]);
  });
});
