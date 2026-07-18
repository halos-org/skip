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

  it('includes the widget schemas and the design system', () => {
    expect(schema.widgets.length).toBeGreaterThanOrEqual(30);
    expect(schema.widgets.some((w) => w.selector === 'widget-numeric')).toBe(true);
    expect(schema.designSystem.grid.column).toBe(24);
    expect(schema.designSystem.colors).toHaveLength(8);
  });
});
