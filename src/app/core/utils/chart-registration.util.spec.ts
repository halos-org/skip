import { describe, it, expect, vi } from 'vitest';

// Chart.js cannot instantiate under jsdom; the behaviour under test is the module-level
// register-once guard and the exact minimal component union it registers. The suite shares module
// state, so other chart specs may have already imported (and tripped) the util — reset the module
// registry inside the test and re-import fresh so the guard starts clean regardless of run order.
// Each mocked component is a distinct sentinel string so the assertion can name the exact set.
vi.mock('chart.js', () => ({
  Chart: { register: vi.fn() },
  LineController: 'LineController',
  LineElement: 'LineElement',
  PointElement: 'PointElement',
  LinearScale: 'LinearScale',
  TimeScale: 'TimeScale',
  Filler: 'Filler',
  Legend: 'Legend',
  Tooltip: 'Tooltip',
  Title: 'Title',
  SubTitle: 'SubTitle'
}));
vi.mock('chartjs-plugin-annotation', () => ({ default: 'annotationPlugin' }));
vi.mock('@aziham/chartjs-plugin-streaming', () => ({ default: 'ChartStreaming' }));

describe('registerChartComponents', () => {
  it('registers the minimal line/time chart component union exactly once', async () => {
    vi.resetModules();
    const { Chart } = await import('chart.js');
    const { registerChartComponents } = await import('./chart-registration.util');

    registerChartComponents();
    registerChartComponents();

    const register = vi.mocked(Chart.register);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(
      'LineController',
      'LineElement',
      'PointElement',
      'LinearScale',
      'TimeScale',
      'Filler',
      'Legend',
      'Tooltip',
      'Title',
      'SubTitle',
      'annotationPlugin',
      'ChartStreaming'
    );
  });
});
