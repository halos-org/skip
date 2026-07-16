import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { extractWidgetCatalog } from './generate';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('extractWidgetCatalog', () => {
  const widgets = extractWidgetCatalog({ projectRoot });

  it('extracts the full active widget catalog', () => {
    // KIP ships ~32 active widgets; guard against an empty or truncated parse.
    expect(widgets.length).toBeGreaterThanOrEqual(30);
  });

  it('includes widget-numeric as a Core widget with sizing and component class', () => {
    const numeric = widgets.find((w) => w.selector === 'widget-numeric');
    expect(numeric).toBeDefined();
    expect(numeric?.name).toBe('Numeric');
    expect(numeric?.category).toBe('Core');
    expect(numeric?.componentClassName).toBe('WidgetNumericComponent');
    expect(numeric?.defaultWidth).toBe(4);
    expect(numeric?.defaultHeight).toBe(6);
    expect(numeric?.requiredPlugins).toEqual([]);
  });

  it('includes the live electrical widgets (alternator, inverter, ac)', () => {
    for (const selector of ['widget-alternator', 'widget-inverter', 'widget-ac']) {
      const widget = widgets.find((w) => w.selector === selector);
      expect(widget, selector).toBeDefined();
    }
  });

  it('captures the four required plugins for Freeboard-SK', () => {
    const freeboard = widgets.find((w) => w.selector === 'widget-freeboardsk');
    expect(freeboard?.requiredPlugins).toEqual(
      expect.arrayContaining(['freeboard-sk', 'tracks', 'resources-provider', 'course-provider']),
    );
  });

  it('returns widgets sorted by selector for stable, consistent diffs', () => {
    const selectors = widgets.map((w) => w.selector);
    const sorted = [...selectors].sort((a, b) => a.localeCompare(b));
    expect(selectors).toEqual(sorted);
  });
});
