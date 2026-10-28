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
  it('copies a nested child and does not share its config', () => {
    const source: NgGridStackWidget = {
      w: 4, h: 4, selector: 'group-widget',
      input: { widgetProperties: { type: 'group-widget', uuid: 'g', config: { displayName: 'Group' } } },
      subGridOpts: {
        column: 12,
        children: [{
          id: 'c', w: 1, h: 1, selector: 'widget-host2',
          input: { widgetProperties: { type: 'widget-numeric', uuid: 'c', config: { displayName: 'Child' } } }
        }]
      }
    };
    const copy = cloneWidgetSnapshot({ ...source, x: 2, y: 3, id: 'g' });
    const child = copy.subGridOpts?.children?.[0];
    expect(copy.x).toBeUndefined();
    expect(copy.y).toBeUndefined();
    expect(copy.id).toBeUndefined();
    expect(child?.id).toBe('c');
    expect(child?.input?.widgetProperties.uuid).toBe('c');
    expect(child?.input?.widgetProperties.config).toEqual({ displayName: 'Child' });
    source.subGridOpts!.children![0].input!.widgetProperties.config.displayName = 'Mutated';
    expect(child?.input?.widgetProperties.config.displayName).toBe('Child');
    expect(copy.subGridOpts).toMatchObject({ column: 12 });
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
