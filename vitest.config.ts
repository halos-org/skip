import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'gridstack/dist/angular': fileURLToPath(new URL('./src/test-shims/gridstack-angular-shim.ts', import.meta.url)),
      'gridstack': fileURLToPath(new URL('./src/test-shims/gridstack-shim.ts', import.meta.url)),
      '@godind/canvas-gauges': fileURLToPath(new URL('./src/test-shims/canvas-gauges-shim.ts', import.meta.url)),
      '@godind/ng-canvas-gauges': fileURLToPath(new URL('./src/test-shims/ng-canvas-gauges-shim.ts', import.meta.url)),
      // chart.js cannot instantiate under jsdom, and a per-spec vi.mock only wins when that spec is
      // the first in its worker to load the module — which made #544 look like a flake. Aliasing
      // applies to every spec regardless of order.
      'chart.js': fileURLToPath(new URL('./src/test-shims/chartjs-shim.ts', import.meta.url)),
      'chartjs-plugin-annotation': fileURLToPath(new URL('./src/test-shims/chartjs-annotation-shim.ts', import.meta.url)),
      'chartjs-adapter-date-fns': fileURLToPath(new URL('./src/test-shims/chartjs-plugin-shim.ts', import.meta.url)),
      '@aziham/chartjs-plugin-streaming': fileURLToPath(new URL('./src/test-shims/chartjs-streaming-shim.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test.ts']
  }
});
