import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Isolated Vitest config for the bundled Freeboard-SK panel plugin.
 *
 * `plugin/index.js` is a plain Node (CommonJS) Signal K server plugin, outside the
 * Angular app's jsdom vitest scope, so it runs in the `node` environment with no
 * Angular setup. Kept separate from vitest.config.ts so `ng test` and `test:plugin`
 * never interfere.
 */
export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  test: {
    globals: true,
    environment: 'node',
    include: ['plugin/**/*.spec.ts'],
  },
});
