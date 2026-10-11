import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildSchema } from './generate';
import {
  LATEST_APP_CONFIG_VERSION,
  REMOTE_CONFIG_FILE_VERSION,
} from '../../src/app/core/constants/config-versions.const';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const schema = buildSchema({ projectRoot });

describe('buildSchema', () => {
  it('stamps meta with the Skip version and the config versions from their source of truth', () => {
    expect(schema.meta).toMatchObject({
      schemaVersion: 1,
      configFileVersion: REMOTE_CONFIG_FILE_VERSION,
      configVersion: LATEST_APP_CONFIG_VERSION,
    });
    expect(schema.meta.skipVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('explains units that follow a path, and a null scale bound', () => {
    expect(schema.meta.optionUnitsRule).toContain("'SI unit of <slot>'");
    expect(schema.meta.optionUnitsRule).toContain('null');
  });

  it('gives every numeric default option a unit: SI in optionUnits, or a widget setting unit', () => {
    expect(schema.meta.optionUnitsRule).toContain('widgetSettingUnits');
    const settings = schema.meta.widgetSettingUnits;
    const missing: string[] = [];
    const walk = (value: unknown, path: string, selector: string, optionUnits: Record<string, string>): void => {
      if (typeof value === 'number') {
        if (!(path in optionUnits) && !(path in settings)) missing.push(`${selector}: ${path}`);
      } else if (Array.isArray(value)) {
        // An array option's unit applies to each element, so its elements share its path.
        for (const element of value) walk(element, path, selector, optionUnits);
      } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (key === 'paths' || key === 'multiChildCtrls') continue;
          walk(child, path ? `${path}.${key}` : key, selector, optionUnits);
        }
      }
    };
    for (const widget of schema.widgets) walk(widget.defaultConfig, '', widget.selector, widget.optionUnits ?? {});
    expect(missing).toEqual([]);
  });

  it('includes the widget schemas and the design system', () => {
    expect(schema.widgets.length).toBeGreaterThanOrEqual(30);
    expect(schema.widgets.some((w) => w.selector === 'widget-numeric')).toBe(true);
    expect(schema.designSystem.grid.column).toBe(24);
    expect(schema.designSystem.colors).toHaveLength(8);
  });
});
