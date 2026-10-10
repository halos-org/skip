import { describe, expect, it } from 'vitest';
import type { NgGridStackWidget } from 'gridstack/dist/angular';
import { allWidgets } from './dashboard-widgets.util';

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
