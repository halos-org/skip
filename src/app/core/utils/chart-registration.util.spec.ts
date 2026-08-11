import { describe, it, expect, vi } from 'vitest';

// chart.js and its plugins are aliased to test shims (vitest.config.ts), so the util under test
// registers the shims' tokens rather than the real building blocks. The behaviour under test is the
// module-level register-once guard and the exact minimal union it registers. Module state is shared
// across the suite, so another chart spec may already have imported (and tripped) the util — the
// registry is reset inside each test and everything re-imported fresh, which also keeps the token
// identities consistent with the freshly-loaded util.
describe('registerChartComponents', () => {
  it('registers the minimal line/time chart component union exactly once', async () => {
    vi.resetModules();
    const chart = await import('chart.js');
    const annotationPlugin = (await import('chartjs-plugin-annotation')).default;
    const chartStreaming = (await import('@aziham/chartjs-plugin-streaming')).default;
    const register = vi.spyOn(chart.Chart, 'register');
    const { registerChartComponents } = await import('./chart-registration.util');

    registerChartComponents();
    registerChartComponents();

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(
      chart.LineController,
      chart.LineElement,
      chart.PointElement,
      chart.LinearScale,
      chart.TimeScale,
      chart.Filler,
      chart.Legend,
      chart.Tooltip,
      chart.Title,
      chart.SubTitle,
      annotationPlugin,
      chartStreaming
    );
  });

  it('sets the line-element default join to round to prevent miter-spike flicker', async () => {
    vi.resetModules();
    const { Chart } = await import('chart.js');
    const { registerChartComponents } = await import('./chart-registration.util');

    registerChartComponents();

    expect(Chart.defaults.elements.line.borderJoinStyle).toBe('round');
  });
});
