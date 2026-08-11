/*
 * Test shim for chart.js and its plugins, aliased in vitest.config.ts the same way gridstack and
 * canvas-gauges are.
 *
 * Chart.js cannot instantiate under jsdom: it acquires a real 2D context and reads layout from the
 * canvas, so a chart built against the environment's canvas stub ends up with a falsy `ctx` and
 * silently drops everything a component feeds it. Specs used to guard against that with a per-file
 * `vi.mock('chart.js')`, which only works if that file is the first in its worker to pull the module
 * in. `widget-numeric` reaches chart.js through `MinichartComponent` without mocking it, so whenever
 * that spec loaded first the real library won and minichart's own mock arrived too late — an
 * order-dependent failure that looked like a flake (#544).
 *
 * Aliasing removes the race: every spec gets this module, whoever loads it first.
 */

/** Minimal stand-in: records what it was constructed with and exposes the surface widgets touch. */
export class Chart {
  public static defaults = { elements: { line: {} as Record<string, unknown> } };
  public static register(): void { /* noop */ }
  public static unregister(): void { /* noop */ }
  /** Truthy so a streaming callback's `if (!chart.ctx) return` guard passes, as it does in a browser. */
  public ctx: unknown = {};
  public canvas: unknown;
  public data: unknown;
  public options: unknown;
  public scales: Record<string, unknown> = {};

  constructor(ctx: unknown, config?: { data?: unknown; options?: unknown }) {
    this.ctx = ctx ?? {};
    this.canvas = (ctx as { canvas?: unknown })?.canvas ?? {};
    this.data = config?.data;
    this.options = config?.options;
  }

  public update(): void { /* noop */ }
  public resize(): void { /* noop */ }
  public destroy(): void { /* noop */ }
  public getDatasetMeta(): Record<string, unknown> { return {}; }
}

// Registerable building blocks: identity tokens, since register() is a noop.
export const registerables: unknown[] = [];
export const LineController = {};
export const LineElement = {};
export const PointElement = {};
export const LinearScale = {};
export const TimeScale = {};
export const CategoryScale = {};
export const Filler = {};
export const Legend = {};
export const Tooltip = {};
export const Title = {};
export const SubTitle = {};
export const Scale = {};

export default Chart;
