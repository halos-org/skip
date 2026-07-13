import { describe, it, expect, vi } from 'vitest';

// Chart.js cannot instantiate under jsdom; the only behaviour under test is the module-level
// register-once guard. The suite shares module state, so other chart specs may have already
// imported (and tripped) the util — reset the module registry inside the test and re-import
// fresh so the guard starts clean regardless of run order.
vi.mock('chart.js', () => ({ Chart: { register: vi.fn() }, registerables: [] }));
vi.mock('chartjs-plugin-annotation', () => ({ default: {} }));
vi.mock('@aziham/chartjs-plugin-streaming', () => ({ default: {} }));

describe('registerChartComponents', () => {
  it('registers the Chart.js components only once across repeated calls', async () => {
    vi.resetModules();
    const { Chart } = await import('chart.js');
    const { registerChartComponents } = await import('./chart-registration.util');

    registerChartComponents();
    registerChartComponents();

    expect(vi.mocked(Chart.register)).toHaveBeenCalledTimes(1);
  });
});
