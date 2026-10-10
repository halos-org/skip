import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetNumericComponent } from './widget-numeric.component';
import { MinigraphComponent } from '../minigraph/minigraph.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { TDurationFormat, UnitsService } from '../../core/services/units.service';
import { CanvasService } from '../../core/services/canvas.service';
import { DataService, IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { ISkDisplayScale } from '../../core/interfaces/signalk-interfaces';
import { HistoryGraphStreamService } from '../../core/services/history-graph-stream.service';
import type { ITheme } from '../../core/services/app-service';

const unitsServiceStub = {
  getUnitDisplaySymbol: (measure: string | null | undefined) => measure ?? '',
  // Mirrors the real rule: nothing to render for the boot placeholder, 'unitless', or a blank symbol.
  getRenderableUnitSymbol: (measure: string | null | undefined) =>
    (!measure || measure === 'unitless') ? '' : measure.trim()
};

interface NumericInternals {
  getValueText: () => string;
  getMinMaxText: () => string;
  labelMeasure: () => string;
  setMiniGraph: (graph: MinigraphComponent) => void;
}

type MiniGraphInputs = Pick<MinigraphComponent,
  'dataPath' | 'dataSource' | 'convertUnitTo' | 'numDecimal' | 'yScaleMin' | 'yScaleMax' | 'inverseYAxis' | 'verticalChart'>;

/**
 * What the widget shows for a set of SI inputs: the value text, the min/max row, the measure the
 * unit label is drawn for, and what it hands the minigraph. Pins the output so a change of the unit
 * the widget computes in cannot move anything on screen.
 *
 * The component is driven headless: it is constructed without ngOnInit, so drawWidget bails before
 * reading the required `theme()` input, and ignoreZones keeps the callback out of the zone branch
 * that reads it too. ngAfterViewInit registers the stream callback through the streams fake.
 */
describe('WidgetNumericComponent output from SI inputs', () => {
  const KNOTS_PER_MS = 3600 / 1852;
  let internals: NumericInternals;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let next: ((u: IPathUpdate) => void) | undefined;
  let metaScale: WritableSignal<ISkDisplayScale | undefined>;
  let metaObserved: string[];

  const makeConfig = (overrides: Partial<IWidgetSvcConfig> = {}, convertUnitTo = 'unitless'): IWidgetSvcConfig => {
    const defaults = structuredClone(WidgetNumericComponent.DEFAULT_CONFIG);
    return {
      ...defaults,
      paths: {
        numericPath: { ...defaults.paths!['numericPath'], path: 'self.environment.test', convertUnitTo }
      },
      ignoreZones: true,
      ...overrides
    } as IWidgetSvcConfig;
  };

  /** An SI sample as the streams directive delivers it to this widget, with its presentation measure. */
  const feed = (si: number | null, measure: string, durationFormat?: TDurationFormat): void => {
    if (!next) throw new Error('numericPath is not observed');
    next({ data: { value: si, timestamp: null, measure, durationFormat }, state: 'normal' } as IPathUpdate);
  };

  const miniGraphInputs = (): MiniGraphInputs => {
    const graph = {} as MinigraphComponent;
    internals.setMiniGraph(graph);
    const { dataPath, dataSource, convertUnitTo, numDecimal, yScaleMin, yScaleMax, inverseYAxis, verticalChart } = graph;
    return { dataPath, dataSource, convertUnitTo, numDecimal, yScaleMin, yScaleMax, inverseYAxis, verticalChart };
  };

  const render = (config: IWidgetSvcConfig): void => {
    options.set(config);
    const component = TestBed.runInInjectionContext(() => new WidgetNumericComponent());
    internals = component as unknown as NumericInternals;
    component.ngAfterViewInit();
  };

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>(undefined);
    next = undefined;
    metaScale = signal<ISkDisplayScale | undefined>(undefined);
    metaObserved = [];
    const streamsFake = {
      observe: (pathName: string, cb: (u: IPathUpdate) => void) => {
        next = cb;
      }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsFake },
        { provide: WidgetMetadataDirective, useValue: { displayScale: metaScale, observe: (key: string) => { metaObserved.push(key); } } },
        // The widget's conversions read no path state, so the real service needs no DataService.
        { provide: DataService, useValue: {} },
        UnitsService
      ]
    });
  });

  it('presents the tracked extremes in the measure current when they are drawn', () => {
    render(makeConfig({ showMin: true, showMax: true }, 'knots'));
    feed(5, 'knots');
    feed(8, 'knots');
    feed(6, 'kph');
    expect({ value: internals.getValueText(), minMax: internals.getMinMaxText() })
      .toEqual({ value: '21.6', minMax: 'Min: 18.0 Max: 28.8' });
  });

  it('re-expresses the extremes after a live switch from Celsius to Fahrenheit (#575)', () => {
    render(makeConfig({ showMin: true, showMax: true, showMiniChart: true }, 'celsius'));
    feed(284.95, 'celsius');
    feed(286.35, 'celsius');
    expect(internals.getMinMaxText()).toBe('Min: 11.8 Max: 13.2');
    feed(285.5, 'fahrenheit');
    expect({
      value: internals.getValueText(),
      minMax: internals.getMinMaxText(),
      graphUnit: miniGraphInputs().convertUnitTo
    }).toEqual({ value: '54.2', minMax: 'Min: 53.2 Max: 55.8', graphUnit: 'fahrenheit' });
  });

  it('renders the placeholder before any value arrives', () => {
    render(makeConfig());
    expect(internals.getValueText()).toBe('--');
  });

  it('shows a speed in the display measure, with that measure as the label', () => {
    render(makeConfig({}, 'knots'));
    feed(5, 'knots');
    expect({ value: internals.getValueText(), label: internals.labelMeasure() })
      .toEqual({ value: '9.7', label: 'knots' });
  });

  it('follows the server measure where it differs from the stored unit', () => {
    render(makeConfig({ showMiniChart: true }, 'celsius'));
    feed(293.15, 'fahrenheit');
    expect({
      value: internals.getValueText(),
      label: internals.labelMeasure(),
      graphUnit: miniGraphInputs().convertUnitTo
    }).toEqual({ value: '68.0', label: 'fahrenheit', graphUnit: 'fahrenheit' });
  });

  it('shows the value as it arrives while the measure is still empty', () => {
    render(makeConfig());
    feed(12.345, '');
    expect({ value: internals.getValueText(), label: internals.labelMeasure() })
      .toEqual({ value: '12.3', label: '' });
  });

  it('goes back to the placeholder on a null sample and keeps the extremes', () => {
    render(makeConfig({ showMin: true, showMax: true }, 'knots'));
    feed(5, 'knots');
    feed(8, 'knots');
    feed(null, 'knots');
    expect({ value: internals.getValueText(), minMax: internals.getMinMaxText() })
      .toEqual({ value: '--', minMax: 'Min: 9.7 Max: 15.6' });
  });

  it('tracks min and max in the display measure', () => {
    render(makeConfig({ showMin: true, showMax: true, numDecimal: 2 }, 'knots'));
    feed(5, 'knots');
    feed(2, 'knots');
    feed(8, 'knots');
    feed(4, 'knots');
    expect(internals.getMinMaxText()).toBe('Min: 3.89 Max: 15.55');
  });

  it('writes a value beyond the chart range as it is, and hands the chart its stored range', () => {
    render(makeConfig({ showMiniChart: true, yScaleMin: 0, yScaleMax: 10 / KNOTS_PER_MS, numDecimal: 0 }, 'knots'));
    feed(100, 'knots');
    expect({ value: internals.getValueText(), graph: miniGraphInputs() }).toEqual({
      value: '194',
      graph: {
        dataPath: 'self.environment.test',
        dataSource: 'default',
        convertUnitTo: 'knots',
        numDecimal: 0,
        yScaleMin: 0,
        yScaleMax: expect.closeTo(10),
        inverseYAxis: false,
        verticalChart: false
      }
    });
  });

  describe('minigraph y range', () => {
    const range = () => { const g = miniGraphInputs(); return [g.yScaleMin, g.yScaleMax]; };

    it('hands the chart an SI range in the measure the value is shown in', () => {
      render(makeConfig({ showMiniChart: true, yScaleMin: 0, yScaleMax: 10 / KNOTS_PER_MS }, 'knots'));
      feed(3, 'knots');
      expect(range()).toEqual([0, expect.closeTo(10)]);
      feed(3, 'm/s');
      expect(range()).toEqual([0, expect.closeTo(5.14)]);
    });

    it("takes the path's meta scale for bounds that are not set", () => {
      render(makeConfig({ showMiniChart: true, yScaleMin: null, yScaleMax: null }, 'knots'));
      metaScale.set({ lower: 0, upper: 20 / KNOTS_PER_MS, type: 'linear' });
      feed(3, 'knots');
      expect(range()).toEqual([0, expect.closeTo(20)]);
    });

    it('uses 0..10 in the presentation measure when neither the config nor meta sets a bound', () => {
      render(makeConfig({ showMiniChart: true, yScaleMin: null, yScaleMax: null }, 'knots'));
      feed(3, 'knots');
      expect(range()).toEqual([0, 10]);
    });

    it('observes its path meta for the scale', () => {
      render(makeConfig({ showMiniChart: true }, 'knots'));
      expect(metaObserved).toContain('numericPath');
    });
  });

  it("appends '%' to a ratio shown as percent", () => {
    render(makeConfig());
    feed(0.555, 'percent');
    expect({ value: internals.getValueText(), label: internals.labelMeasure() })
      .toEqual({ value: '55.5%', label: 'percent' });
  });

  it("appends '%' to a ratio shown as percentraw", () => {
    render(makeConfig());
    feed(0.8, 'percentraw');
    expect(internals.getValueText()).toBe('0.8%');
  });

  it('writes a latitude in degrees, minutes and seconds', () => {
    render(makeConfig());
    feed(60.5125, 'latitudeSec');
    expect(internals.getValueText()).toBe('60° 30\' 45.00" N');
  });

  it('writes the extremes of a latitude in degrees, minutes and seconds too', () => {
    render(makeConfig({ showMin: true, showMax: true }));
    feed(60.5125, 'latitudeSec');
    feed(60.25, 'latitudeSec');
    feed(61, 'latitudeSec');
    expect(internals.getMinMaxText()).toBe('Min: 60° 15\' 00.00" N Max: 61° 0\' 00.00" N');
  });

  it('writes a longitude in degrees and decimal minutes', () => {
    render(makeConfig());
    feed(-24.5, 'longitudeMin');
    expect(internals.getValueText()).toBe('24° 30.00\' W');
  });

  it('writes a duration measure as days and clock time', () => {
    render(makeConfig({}, 'D HH:MM:SS'));
    feed(93784, 'D HH:MM:SS');
    expect({ value: internals.getValueText(), label: internals.labelMeasure() })
      .toEqual({ value: '1d 2:03:04', label: 'D HH:MM:SS' });
  });

  it('formats a seconds value in the server duration format, with no unit label (#627)', () => {
    render(makeConfig());
    feed(1800, 's', 'HH:MM:SS');
    expect({ value: internals.getValueText(), label: internals.labelMeasure() })
      .toEqual({ value: '30:00', label: '' });
    feed(1800, 's');
    expect({ value: internals.getValueText(), label: internals.labelMeasure() })
      .toEqual({ value: '1800.0', label: 's' });
  });

  it('formats min and max in the duration format too', () => {
    render(makeConfig({ showMin: true, showMax: true }));
    feed(1800, 's', 'HH:MM:SS');
    feed(3725, 's', 'HH:MM:SS');
    expect(internals.getMinMaxText()).toBe('Min: 30:00 Max: 1:02:05');
  });
});

interface DrawnText {
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  maxHeight: number;
  weight: string;
  color: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  floorPx: number;
}

interface LayoutInternals {
  cssWidth: number;
  cssHeight: number;
  maxValueTextWidth: number;
  maxValueTextHeight: number;
  maxMinMaxTextHeight: number;
  labelBaselineY: () => number;
  calculateMaxMinTextDimensions: () => void;
  drawLabelRow: (ctx: CanvasRenderingContext2D, displayName: string, unit: string, haloColor: string | undefined) => void;
  drawValue: (ctx: CanvasRenderingContext2D) => void;
}

/** A glyph is 0.6em wide, 0.65em when bold, so a width is a character count times the font size. */
const fontSizeOf = (font: string): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0);
const glyphEm = (weight: string): number => weight === 'bold' ? 0.65 : 0.6;
const widthOf = (text: string, size: number, weight: string): number => text.length * glyphEm(weight) * size;

/**
 * Stands in for CanvasService with the two behaviours the label row is laid out against: text width
 * scales with the font size and weight (so a width reserved at one size is wrong at another), and
 * the fitted size is raised to the caller's floor — the case where CanvasService drops its own width
 * cap and lets floored text overflow, which is the whole reason the label is truncated.
 */
const canvasFake = {
  EDGE_BUFFER: 10,
  MIN_LABEL_PX: 16,
  MIN_UNIT_PX: 12,
  DEFAULT_FONT: 'Roboto',
  scaleFactor: 1,
  drawn: [] as DrawnText[],
  measureTextWidth: (text: string, font: string) =>
    widthOf(text, fontSizeOf(font), font.startsWith('bold') ? 'bold' : 'normal'),
  calculateOptimalFontSize: (
    ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxHeight: number,
    weight = 'normal', floorPx = 0
  ) => {
    void ctx;
    let size = Math.max(1, Math.floor(maxHeight));
    while (size > 1 && widthOf(text, size, weight) > maxWidth) size--;
    return floorPx > 0 ? Math.max(size, Math.round(floorPx)) : size;
  },
  drawText: (
    ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number,
    maxHeight: number, weight = 'normal', color = '', align: CanvasTextAlign = 'center',
    baseline: CanvasTextBaseline = 'middle', halo?: string, floorPx = 0
  ) => {
    void ctx; void halo;
    canvasFake.drawn.push({ text, x, y, maxWidth, maxHeight, weight, color, align, baseline, floorPx });
  },
  whenFontsReady: () => Promise.resolve()
};

/** Horizontal extent of a recorded draw at the size CanvasService would actually paint it. */
const inkBounds = (d: DrawnText): { left: number; right: number } => {
  const size = canvasFake.calculateOptimalFontSize(
    {} as CanvasRenderingContext2D, d.text, d.maxWidth, d.maxHeight, d.weight, d.floorPx);
  const width = widthOf(d.text, size, d.weight);
  return d.align === 'right' ? { left: d.x - width, right: d.x } : { left: d.x, right: d.x + width };
};

/**
 * Layout of the top row: the label and the unit occupy one band together — label in the left
 * corner, unit in the right — leaving the rest of the tile to the value.
 */
describe('WidgetNumericComponent label row layout', () => {
  const ctx = {} as CanvasRenderingContext2D;
  let component: WidgetNumericComponent;
  let internals: LayoutInternals;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;

  const makeComponent = (width: number, height: number): void => {
    canvasFake.drawn = [];
    TestBed.resetTestingModule();
    options = signal<IWidgetSvcConfig | undefined>({ ...WidgetNumericComponent.DEFAULT_CONFIG, ignoreZones: true });
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: { observe: () => undefined } },
        { provide: WidgetMetadataDirective, useValue: { displayScale: () => undefined, observe: () => undefined } },
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: CanvasService, useValue: canvasFake }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetNumericComponent());
    internals = component as unknown as LayoutInternals;
    internals.cssWidth = width;
    internals.cssHeight = height;
  };

  beforeEach(() => makeComponent(400, 200));

  it('draws the unit in the top-right corner, on the label’s baseline', () => {
    internals.drawLabelRow(ctx, 'SOG', 'knots', undefined);

    const label = canvasFake.drawn.find(d => d.text === 'SOG');
    const unit = canvasFake.drawn.find(d => d.text === 'knots');
    expect(label?.x).toBe(10);
    expect(label?.align).toBe('left');
    expect(unit?.x).toBe(400 - 10);
    expect(unit?.align).toBe('right');
    expect(unit?.y).toBe(label?.y);
    expect(label?.y).toBe(30); // EDGE_BUFFER + 10% of a 200px tile
    // One shared baseline is what makes the two read as a single row despite their different sizes.
    expect(label?.baseline).toBe('alphabetic');
    expect(unit?.baseline).toBe('alphabetic');
  });

  it('keeps the label clear of the unit at every tile width', () => {
    // The invariant the row exists to hold: whatever each is truncated or floored to, the painted
    // label never reaches the painted unit.
    for (const width of [33, 43, 60, 90, 150, 320, 700]) {
      makeComponent(width, 120);
      internals.drawLabelRow(ctx, 'Port Engine Coolant Temperature', 'nm/kWh', undefined);

      const unit = canvasFake.drawn.find(d => d.align === 'right');
      const label = canvasFake.drawn.find(d => d.align === 'left');
      expect(unit, `unit dropped at width ${width}`).toBeDefined();
      if (label) {
        expect(inkBounds(label).right, `overlap at width ${width}`)
          .toBeLessThanOrEqual(inkBounds(unit as DrawnText).left);
      }
    }
  });

  it('narrows the label by the width the unit will actually take', () => {
    internals.drawLabelRow(ctx, 'SOG', 'knots', undefined);

    const unit = canvasFake.drawn.find(d => d.align === 'right') as DrawnText;
    const label = canvasFake.drawn.find(d => d.align === 'left');
    const unitWidth = inkBounds(unit).right - inkBounds(unit).left;
    expect(label?.maxWidth).toBe(400 - 20 - unitWidth - 10);
  });

  it('ellipsises a name too long for its share of the row', () => {
    makeComponent(150, 200);
    internals.drawLabelRow(ctx, 'Speed Over Ground', 'knots', undefined);

    const label = canvasFake.drawn.find(d => d.align === 'left');
    expect(label?.text).toMatch(/…$/);
    expect(label?.text.length ?? 0).toBeLessThan('Speed Over Ground'.length);
  });

  it('drops the label rather than overprint the unit when the row has no room left', () => {
    makeComponent(40, 120);
    internals.drawLabelRow(ctx, 'Speed Over Ground', 'knots', undefined);

    expect(canvasFake.drawn.map(d => d.align)).toEqual(['right']);
  });

  it('keeps an emoji in the name whole when it ellipsises', () => {
    makeComponent(150, 200);
    internals.drawLabelRow(ctx, 'Engine 🔧🔧🔧 Temp', 'knots', undefined);

    const label = canvasFake.drawn.find(d => d.align === 'left');
    expect(label?.text ?? '').not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('omits the unit for a measure that carries no symbol', () => {
    internals.drawLabelRow(ctx, 'Ratio', 'unitless', undefined);

    expect(canvasFake.drawn).toHaveLength(1);
    expect(canvasFake.drawn[0].text).toBe('Ratio');
    expect(canvasFake.drawn[0].maxWidth).toBe(400 - 20);
  });

  it('omits the unit for a measure whose symbol is blank', () => {
    // 'No unit label' is a whitespace measure — reserving row width for it would cost the name
    // space and paint nothing.
    internals.drawLabelRow(ctx, 'Rudder', ' ', undefined);

    expect(canvasFake.drawn).toHaveLength(1);
    expect(canvasFake.drawn[0].maxWidth).toBe(400 - 20);
  });

  it('gives the value the card between the label row and the bottom edge', () => {
    internals.calculateMaxMinTextDimensions();
    internals.drawValue(ctx);

    expect(internals.labelBaselineY()).toBe(30);
    expect(internals.maxValueTextHeight).toBe(170);
    expect(internals.maxValueTextWidth).toBe(360);
    const value = canvasFake.drawn.find(d => d.align === undefined || d.align === 'center');
    expect(value?.x).toBe(200);
    expect(value?.y).toBe(115); // centred between the label baseline and the card bottom
  });

  it('holds the value box off the min/max row when one is shown', () => {
    options.update(cfg => ({ ...cfg, showMin: true, showMax: true }));
    internals.calculateMaxMinTextDimensions();
    internals.drawValue(ctx);

    expect(internals.maxValueTextHeight + internals.labelBaselineY() + internals.maxMinMaxTextHeight)
      .toBe(internals.cssHeight);
    const value = canvasFake.drawn.find(d => d.align === undefined || d.align === 'center');
    expect(value?.y).toBe(105); // recentred above the min/max row
  });
});

/**
 * The options dialog reconfigures a placed widget in place (WidgetHost2Component.applyRuntimeConfig
 * sets the runtime options) rather than recreating it, so every option has to take effect live.
 */
describe('WidgetNumericComponent reconfigured in place', () => {
  const themeStub = new Proxy({}, { get: () => '#000000' }) as unknown as ITheme;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let deliver: ((u: IPathUpdate) => void) | undefined;

  const config = (showMiniChart: boolean): IWidgetSvcConfig => {
    const defaults = structuredClone(WidgetNumericComponent.DEFAULT_CONFIG);
    return {
      ...defaults,
      paths: { numericPath: { ...defaults.paths!['numericPath'], path: 'self.environment.test' } },
      ignoreZones: true,
      showMiniChart
    } as IWidgetSvcConfig;
  };

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>(config(false));
    deliver = undefined;
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        {
          provide: WidgetStreamsDirective,
          useValue: { observe: (_pathName: string, cb: (u: IPathUpdate) => void) => { deliver = cb; } }
        },
        { provide: WidgetMetadataDirective, useValue: { displayScale: () => undefined, observe: () => undefined } },
        { provide: HistoryGraphStreamService, useValue: { getBackfillThenLive: () => new Subject() } },
        { provide: DataService, useValue: {} },
        UnitsService
      ]
    });
  });

  it('shows and hides the background graph as Show Background Graph is toggled (#594)', async () => {
    const fixture = TestBed.createComponent(WidgetNumericComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.componentRef.setInput('type', 'widget-numeric');
    fixture.componentRef.setInput('theme', themeStub);
    const graphShown = async (): Promise<boolean> => {
      await fixture.whenStable();
      return fixture.nativeElement.querySelector('minigraph') !== null;
    };

    expect(await graphShown()).toBe(false);
    options.set(config(true));
    expect(await graphShown()).toBe(true);
    options.set(config(false));
    expect(await graphShown()).toBe(false);
    fixture.destroy();
  });

  const renderWithGraph = async (): Promise<{ fixture: ComponentFixture<WidgetNumericComponent>; graph: MinigraphComponent }> => {
    options.set(config(true));
    const fixture = TestBed.createComponent(WidgetNumericComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.componentRef.setInput('type', 'widget-numeric');
    fixture.componentRef.setInput('theme', themeStub);
    await fixture.whenStable();
    const graph = fixture.debugElement.query(By.directive(MinigraphComponent)).componentInstance as MinigraphComponent;
    return { fixture, graph };
  };

  const sample = (si: number, measure: string): void => {
    if (!deliver) throw new Error('the widget never subscribed to numericPath');
    deliver({ data: { value: si, timestamp: null, measure }, state: 'normal' } as IPathUpdate);
  };

  it('restarts the graph with the new scale when a graph option changes in place', async () => {
    const { fixture, graph } = await renderWithGraph();
    expect(graph.inverseYAxis).toBe(false);
    const startGraph = vi.spyOn(graph, 'startGraph');

    options.set({ ...config(true), yScaleMax: 42, inverseYAxis: true });
    await fixture.whenStable();

    expect(graph.yScaleMax).toBe(42);
    expect(graph.inverseYAxis).toBe(true);
    expect(startGraph).toHaveBeenCalled();
    fixture.destroy();
  });

  it('restarts the graph in the new unit when the effective unit changes', async () => {
    const { fixture, graph } = await renderWithGraph();
    sample(293.15, 'celsius');
    await fixture.whenStable();
    expect(graph.convertUnitTo).toBe('celsius');
    const startGraph = vi.spyOn(graph, 'startGraph');

    sample(293.15, 'fahrenheit');
    await fixture.whenStable();

    expect(graph.convertUnitTo).toBe('fahrenheit');
    expect(startGraph).toHaveBeenCalled();
    fixture.destroy();
  });

  it('keeps the running chart, and its history, when only an unrelated option changes', async () => {
    const { fixture, graph } = await renderWithGraph();
    // The effect re-runs on any options change; the minigraph's chart signature is what turns that
    // into a no-op, so the chart object itself must survive.
    const chartOf = (): unknown => (graph as unknown as { chart: unknown }).chart;
    const chartBefore = chartOf();
    expect(chartBefore).toBeTruthy();
    const before = { yScaleMax: graph.yScaleMax, inverseYAxis: graph.inverseYAxis, convertUnitTo: graph.convertUnitTo };

    options.set({ ...config(true), displayName: 'Renamed' });
    await fixture.whenStable();

    expect(chartOf()).toBe(chartBefore);
    expect({ yScaleMax: graph.yScaleMax, inverseYAxis: graph.inverseYAxis, convertUnitTo: graph.convertUnitTo }).toEqual(before);
    fixture.destroy();
  });
});
