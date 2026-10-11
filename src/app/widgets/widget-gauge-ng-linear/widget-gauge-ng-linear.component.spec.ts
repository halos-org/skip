import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LinearGaugeOptions } from '@godind/ng-canvas-gauges';
import { WidgetGaugeNgLinearComponent } from './widget-gauge-ng-linear.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { UnitsService } from '../../core/services/units.service';
import { IWidgetSvcConfig, IPathArray, IDataHighlight } from '../../core/interfaces/widgets-interface';
import { ISkDisplayScale, ISkZone, States } from '../../core/interfaces/signalk-interfaces';
import { adjustLinearScaleAndMajorTicks } from '../../core/utils/dataScales.util';
import { DataService, IPathUpdate } from '../../core/services/data.service';

/**
 * The label and the unit are rendered by the component as one header row on the card, so the gauge
 * library must not also reserve its own title and units bands — leaving both options unset is what
 * hands that height to the bar. Sizes are fed to the library only when both axes are positive: it
 * derives arc radii from them and throws from inside its own mutation observer on a non-positive
 * value, past the component's try/catch, leaving the canvas blank.
 *
 * Harness follows the radial gauge spec: the three host directives are faked and the
 * @godind/ng-canvas-gauges lib is aliased to a no-op shim in the test build.
 */
describe('WidgetGaugeNgLinearComponent header row and sizing', () => {
  let fixture: ComponentFixture<WidgetGaugeNgLinearComponent>;
  let component: WidgetGaugeNgLinearComponent;
  let internals: LinearInternals;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let sizeUpdates: LinearGaugeOptions[];
  let capturedNext: ((u: IPathUpdate) => void) | undefined;
  let observeCount: number;
  let replayOnObserve: IPathUpdate | undefined;

  interface LinearInternals {
    effectiveUnit: WritableSignal<string>;
    dataAvailable: WritableSignal<boolean>;
    currentState: WritableSignal<string>;
    value: () => number | null | undefined;
    barColor: (cfg: IWidgetSvcConfig, theme: unknown, state: string) => string;
    optionsReady: () => boolean;
    textValue: () => string;
    gaugeOptions: LinearGaugeOptions;
    unitSymbol: () => string;
    buildGaugeOptions: (cfg: IWidgetSvcConfig, theme: unknown, scale: unknown) => void;
    adjustedScale: () => { min: number; max: number; majorTicks: number[] };
  }

  const theme = {
    contrast: '#fff', contrastDim: '#ccc', contrastDimmer: '#999',
    cardColor: '#111', background: '#000'
  };

  const makeConfig = (subType = 'vertical', path: string | null = 'self.navigation.speedOverGround'): IWidgetSvcConfig => {
    const dflt = WidgetGaugeNgLinearComponent.DEFAULT_CONFIG;
    const gaugePath = (dflt.paths as IPathArray)['gaugePath'];
    return {
      ...dflt,
      ignoreZones: true,
      gauge: { ...dflt.gauge, type: 'ngLinear', subType },
      paths: { gaugePath: { ...gaugePath, path, convertUnitTo: 'knots' } }
    };
  };

  const update = (value: unknown, measure?: string): IPathUpdate =>
    ({ data: { value, timestamp: null, measure }, state: States.Normal }) as unknown as IPathUpdate;

  const unitsFake = {
    // Identity: these specs feed readings already expressed in the tagged measure.
    convertToUnit: (_measure: string, value: number): number => value,
    getUnitDisplaySymbol: (measure: string | null | undefined): string => measure ?? '',
    getRenderableUnitSymbol: (measure: string | null | undefined): string =>
      (!measure || measure === 'unitless') ? '' : measure.trim(),
    resolvePathMeasure: (path: string): string => path
  };

  const resizeEntry = (width: number, height: number): ResizeObserverEntry =>
    ({ contentRect: { width, height } } as ResizeObserverEntry);

  beforeEach(async () => {
    options = signal<IWidgetSvcConfig | undefined>(makeConfig());
    sizeUpdates = [];
    capturedNext = undefined;
    observeCount = 0;
    replayOnObserve = undefined;

    await TestBed.configureTestingModule({
      imports: [WidgetGaugeNgLinearComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: { observe: (_p: string, next: (u: IPathUpdate) => void) => {
          capturedNext = next;
          observeCount++;
          // The real directive replays a BehaviorSubject, so a path holding a value delivers it
          // synchronously inside the same effect run as the clear.
          if (replayOnObserve) next(replayOnObserve);
        } } },
        { provide: WidgetMetadataDirective, useValue: { zones: () => [], displayScale: () => undefined, observe: () => undefined } },
        { provide: UnitsService, useValue: unitsFake }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetGaugeNgLinearComponent);
    fixture.componentRef.setInput('id', 'gauge-1');
    fixture.componentRef.setInput('type', 'widget-gauge-ng-linear');
    fixture.componentRef.setInput('theme', theme);
    fixture.detectChanges();
    component = fixture.componentInstance;
    internals = component as unknown as LinearInternals;
    // Record what the component hands the library, in place of the shimmed gauge.
    (component as unknown as { ngGauge: () => { update: (o: LinearGaugeOptions) => void } }).ngGauge =
      () => ({ update: (o: LinearGaugeOptions) => { sizeUpdates.push(o); } });
  });

  it('leaves the library title and units unset so neither band is reserved', () => {
    internals.buildGaugeOptions(makeConfig(), theme, internals.adjustedScale());

    expect(internals.gaugeOptions.title).toBeUndefined();
    expect(internals.gaugeOptions.units).toBeUndefined();
  });

  it('renders the label and the unit in the header row', () => {
    internals.effectiveUnit.set('kn');
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('.gaugeHeader');
    expect(header.querySelector('.gaugeLabel').textContent.trim()).toBe('Gauge Label');
    expect(header.querySelector('.gaugeUnit').textContent.trim()).toBe('kn');
  });

  it('renders no unit before a measure is tagged, or for one that carries no symbol', () => {
    for (const measure of ['', 'unitless', ' ']) {
      internals.effectiveUnit.set(measure);
      fixture.detectChanges();
      expect(internals.unitSymbol(), `measure "${measure}"`).toBe('');
      expect(fixture.nativeElement.querySelector('.gaugeUnit'), `measure "${measure}"`).toBeNull();
    }
  });

  it('runs a vertical gauge the full height of its box', () => {
    component.onResized(resizeEntry(340, 400));

    expect(sizeUpdates).toHaveLength(1);
    expect(sizeUpdates[0].height).toBeCloseTo(390);  // the full 400px less the 10px inset
    expect(sizeUpdates[0].width).toBeCloseTo(120);   // thinned to a third of the length
  });

  it('runs a horizontal gauge the full width of its box, thinning it rather than shortening it', () => {
    // A wide, short tile: keeping a fixed aspect would have cut the length to height/0.3 and left
    // most of the card empty on either side of the bar.
    options.set(makeConfig('horizontal'));
    component.onResized(resizeEntry(690, 79));

    expect(sizeUpdates[0].width).toBeCloseTo(690);
    expect(sizeUpdates[0].height).toBeCloseTo(69);
    // The library reads the orientation off which axis is longer, so the cap must hold.
    expect(sizeUpdates[0].height as number).toBeLessThan(sizeUpdates[0].width as number);
  });

  it('sizes the gauge the same when it measures its own box as when a resize reports it', () => {
    // An options rebuild after the view is ready re-measures the element; the size it applies must
    // match the resize path's, or the canvas depends on which of the two ran last.
    options.set(makeConfig('horizontal'));
    (component as unknown as { gauge: () => { nativeElement: { getBoundingClientRect: () => { width: number; height: number } } } }).gauge =
      () => ({ nativeElement: { getBoundingClientRect: () => ({ width: 690, height: 79 }) } });
    component.onResized(resizeEntry(690, 79));
    (component as unknown as { applyInitialSize: () => void }).applyInitialSize();

    expect(sizeUpdates).toHaveLength(2);
    expect(sizeUpdates[1]).toEqual(sizeUpdates[0]);
  });

  it('caps the thickness at a third of the length on a box that is not short', () => {
    options.set(makeConfig('horizontal'));
    component.onResized(resizeEntry(300, 400));

    expect(sizeUpdates[0].width).toBeCloseTo(300);
    expect(sizeUpdates[0].height).toBeCloseTo(80); // 0.3 x 300, less the inset
  });

  it('sends the library no size at all when the header leaves the box too short to draw', () => {
    // A one-row tile: the header takes a fixed height, so what is left cannot absorb the inset.
    component.onResized(resizeEntry(45, 6));

    expect(sizeUpdates).toEqual([]);
  });

  it('sends no size for a collapsed box', () => {
    component.onResized(resizeEntry(0, 0));

    expect(sizeUpdates).toEqual([]);
  });
  describe('no-data state', () => {
    it('mounts the gauge before any datapoint, with a placeholder reading', () => {
      // The whole template used to sit behind a data-dependent @if, so a silent path drew nothing.
      expect(internals.optionsReady()).toBe(true);
      expect(fixture.nativeElement.querySelector('linear-gauge')).not.toBeNull();
      expect(internals.textValue()).toBe('--');
    });

    it('keeps barProgress on and hides the bar by colour instead', () => {
      // Switching barProgress off makes the library skip the pass that computes barDimensions,
      // which every later draw step reads — it throws on construction and kills the canvas.
      const cfg = makeConfig();
      internals.dataAvailable.set(false);
      internals.buildGaugeOptions(cfg, theme, internals.adjustedScale());
      expect(internals.gaugeOptions.barProgress).toBe(true);
      expect(internals.gaugeOptions.colorBarProgress).toBe('rgba(0,0,0,0)');

      internals.dataAvailable.set(true);
      internals.buildGaugeOptions(cfg, theme, internals.adjustedScale());
      expect(internals.gaugeOptions.barProgress).toBe(true);
      expect(internals.gaugeOptions.colorBarProgress).not.toBe('rgba(0,0,0,0)');
    });

    it('suppresses the needle only while no reading is in hand', () => {
      const cfg = makeConfig();
      cfg.gauge = { ...cfg.gauge, type: 'ngLinear', enableNeedle: true };

      internals.dataAvailable.set(false);
      internals.buildGaugeOptions(cfg, theme, internals.adjustedScale());
      expect(internals.gaugeOptions.needle).toBe(false);

      internals.dataAvailable.set(true);
      internals.buildGaugeOptions(cfg, theme, internals.adjustedScale());
      expect(internals.gaugeOptions.needle).toBe(true);
    });

    it('leaves the bar in the widget palette when zones are ignored', () => {
      // The zone-state effect returns early under ignoreZones, so a zone colour applied anywhere
      // else would stick with nothing to correct it.
      const themed = { ...theme, zoneAlarm: '#f00' };
      const cfg = makeConfig();
      internals.dataAvailable.set(true);

      cfg.ignoreZones = true;
      expect(internals.barColor(cfg, themed, States.Alarm)).not.toBe('#f00');

      cfg.ignoreZones = false;
      expect(internals.barColor(cfg, themed, States.Alarm)).toBe('#f00');
    });

    it('paints the bar transparent with no reading, whatever the zone state', () => {
      const themed = { ...theme, zoneAlarm: '#f00' };
      const cfg = makeConfig();
      cfg.ignoreZones = false;
      internals.dataAvailable.set(false);
      expect(internals.barColor(cfg, themed, States.Alarm)).toBe('rgba(0,0,0,0)');
    });
  });

  // #534: a rebuilt subscription against a silent path replays nothing (the leading null is
  // suppressed), so the callback never runs and the previous path's reading stayed on the bar.
  describe('re-point', () => {
    it('clears the reading when re-pointed at a path that reports nothing', () => {
      capturedNext?.(update(6.5, 'knots'));
      expect(internals.dataAvailable()).toBe(true);
      expect(internals.value()).toBe(6.5);

      options.set(makeConfig('vertical', 'self.environment.depth.belowTransducer'));
      fixture.detectChanges();

      expect(internals.dataAvailable()).toBe(false);
      expect(internals.value()).toBeUndefined();
      expect(internals.textValue()).toBe('--');
      expect(internals.effectiveUnit()).toBe('');
    });

    // The same effect re-runs on a theme change, so an unconditional clear would blink the bar off
    // and back on at every switch.
    it('shows the new path\'s reading immediately when it has one, without surfacing the clear', () => {
      capturedNext?.(update(6.5, 'knots'));

      replayOnObserve = update(31.2, 'm');
      options.set(makeConfig('vertical', 'self.environment.depth.belowTransducer'));
      fixture.detectChanges();

      expect(internals.dataAvailable()).toBe(true);
      expect(internals.value()).toBe(31.2);
      // The rendered header, not just the signal: this is what the user reads.
      expect(fixture.nativeElement.querySelector('.gaugeUnit').textContent.trim()).toBe('m');
    });

    // Clearing the path entirely drops the subscription, so the reading has to go with it. This is
    // what pins the clear ahead of the no-path bail-out rather than after it.
    it('clears the reading when the path is cleared entirely', () => {
      capturedNext?.(update(6.5, 'knots'));
      expect(internals.dataAvailable()).toBe(true);

      options.set(makeConfig('vertical', null));
      fixture.detectChanges();

      expect(internals.dataAvailable()).toBe(false);
      expect(internals.value()).toBeUndefined();
      expect(internals.textValue()).toBe('--');
    });

    // currentState drives the value text's colour independently of dataAvailable, so without the
    // reset an alarm-red readout from the old path survives onto the new one.
    it('clears the zone state on a re-point', () => {
      capturedNext?.({ ...update(6.5, 'knots'), state: States.Alarm });
      expect(internals.currentState()).toBe(States.Alarm);

      options.set(makeConfig('vertical', 'self.environment.depth.belowTransducer'));
      fixture.detectChanges();

      expect(internals.currentState()).toBe(States.Normal);
    });

    it('keeps the reading when the config changes without changing the path', () => {
      capturedNext?.(update(6.5, 'knots'));
      expect(internals.dataAvailable()).toBe(true);
      const before = observeCount;

      fixture.componentRef.setInput('theme', { ...theme, cardColor: '#eee', background: '#fff' });
      fixture.detectChanges();

      // Positive control: the effect really did re-run, so "no clear" is a decision, not a no-op.
      expect(observeCount).toBeGreaterThan(before);
      expect(internals.dataAvailable()).toBe(true);
      expect(internals.value()).toBe(6.5);
      expect(internals.effectiveUnit()).toBe('knots');
    });
  });
});

/**
 * What the gauge draws for a set of SI inputs, through the real UnitsService: the value handed to
 * the library after clamping, the scale bounds and major ticks, the header's unit and the zone
 * highlights, with ticks on (nice tick range) and off (bounds as they are). The vertical and
 * horizontal subtypes differ only in geometry. Pins the output so a change of the unit the widget
 * computes in cannot move anything on screen. The stored scale is 0..100 °C, in SI; the server may
 * present the path in another measure.
 */
describe('WidgetGaugeNgLinearComponent output from SI inputs', () => {
  let fixture: ComponentFixture<WidgetGaugeNgLinearComponent>;
  let next: ((u: IPathUpdate) => void) | undefined;
  let metaObserved: string[];

  interface LinearOutput {
    value: () => number | null | undefined;
    textValue: () => string;
    gaugeOptions: LinearGaugeOptions;
    highlights: () => IDataHighlight[];
  }

  const KELVIN = 273.15;
  const theme = {
    contrast: '#fff', contrastDim: '#ccc', contrastDimmer: '#999', cardColor: '#111', background: '#000',
    zoneNominal: '#0f0', zoneAlert: '#00f', zoneWarn: '#ff0', zoneAlarm: '#f00', zoneEmergency: '#f0f'
  };
  // Zones are SI: warn 50..70 °C, alarm 70..100 °C.
  const temperatureZones: ISkZone[] = [
    { state: States.Warn, lower: KELVIN + 50, upper: KELVIN + 70 },
    { state: States.Alarm, lower: KELVIN + 70, upper: KELVIN + 100 }
  ];

  /** An SI sample as the streams directive delivers it to this widget, with its presentation measure. */
  const feed = (si: number | null, measure: string): void => {
    next?.({ data: { value: si, timestamp: null, measure }, state: States.Normal });
    fixture.detectChanges();
  };

  interface RenderOptions {
    displayScale?: IWidgetSvcConfig['displayScale'];
    convertUnitTo?: string;
    metaScale?: ISkDisplayScale;
    ignoreZones?: boolean;
  }

  const render = (enableTicks: boolean, over: RenderOptions = {}): void => {
    const dflt = WidgetGaugeNgLinearComponent.DEFAULT_CONFIG;
    const gaugePath = (dflt.paths as IPathArray)['gaugePath'];
    const cfg: IWidgetSvcConfig = {
      ...dflt,
      ignoreZones: over.ignoreZones ?? false,
      // 0..100 °C, in SI.
      displayScale: over.displayScale ?? { lower: KELVIN, upper: KELVIN + 100, type: 'linear' },
      gauge: { ...dflt.gauge, type: 'ngLinear', subType: 'vertical', enableTicks },
      paths: { gaugePath: { ...gaugePath, path: 'self.propulsion.main.temperature', convertUnitTo: over.convertUnitTo ?? 'celsius' } }
    };
    metaObserved = [];
    TestBed.configureTestingModule({
      imports: [WidgetGaugeNgLinearComponent],
      providers: [
        UnitsService,
        { provide: DataService, useValue: {} },
        { provide: WidgetRuntimeDirective, useValue: { options: signal(cfg) } },
        { provide: WidgetStreamsDirective, useValue: {
          observe: (_p: string, n: (u: IPathUpdate) => void) => { next = n; }
        } },
        { provide: WidgetMetadataDirective, useValue: {
          zones: signal(temperatureZones),
          displayScale: signal(over.metaScale),
          observe: (key: string) => { metaObserved.push(key); }
        } }
      ]
    });
    fixture = TestBed.createComponent(WidgetGaugeNgLinearComponent);
    fixture.componentRef.setInput('id', 'gauge-1');
    fixture.componentRef.setInput('type', 'widget-gauge-ng-linear');
    fixture.componentRef.setInput('theme', theme);
    fixture.detectChanges();
  };

  const shown = () => {
    const c = fixture.componentInstance as unknown as LinearOutput;
    const o = c.gaugeOptions;
    return {
      value: c.value(),
      text: c.textValue(),
      min: o.minValue,
      max: o.maxValue,
      ticks: o.majorTicks,
      unit: (fixture.nativeElement.querySelector('.gaugeUnit')?.textContent ?? '').trim(),
      highlights: c.highlights()
    };
  };

  describe('with ticks', () => {
    beforeEach(() => render(true));

    it('shows a reading in the stored measure on the stored scale, with its zones', () => {
      feed(KELVIN + 42.5, 'celsius');
      const s = shown();
      expect(s.value).toBeCloseTo(42.5);
      expect(s.text).toBe('');
      expect([s.min, s.max, s.unit]).toEqual([0, 100, '°C']);
      expect(s.ticks).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
      expect(s.highlights).toEqual([
        { from: expect.closeTo(50), to: expect.closeTo(70), color: '#ff0' },
        { from: expect.closeTo(70), to: expect.closeTo(100), color: '#f00' }
      ]);
    });

    it('re-expresses the stored scale and the zones in a server measure that differs', () => {
      feed(KELVIN + 42.5, 'fahrenheit');
      const s = shown();
      expect(s.value).toBeCloseTo(108.5);
      // 32..212 °F, widened to the nice tick range.
      expect([s.min, s.max, s.unit]).toEqual([20, 220, '°F']);
      expect(s.ticks).toEqual([20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220]);
      expect(s.highlights).toEqual([
        { from: expect.closeTo(122), to: expect.closeTo(158), color: '#ff0' },
        { from: expect.closeTo(158), to: expect.closeTo(212), color: '#f00' }
      ]);
    });

    it('clamps a reading above the scale to the re-expressed upper bound, not the tick range', () => {
      feed(KELVIN + 150, 'fahrenheit');
      expect(shown().value).toBeCloseTo(212);
    });

    it('clamps a reading below the scale to its lower bound', () => {
      feed(KELVIN - 40, 'celsius');
      expect(shown().value).toBeCloseTo(0);
    });

    it('rests the bar at the re-expressed lower bound with a placeholder on a null reading', () => {
      feed(null, 'fahrenheit');
      const s = shown();
      expect(s.value).toBeCloseTo(32);
      expect(s.text).toBe('--');
    });
  });

  describe('without ticks', () => {
    beforeEach(() => render(false));

    it('uses the bounds as they are, with no ticks but with its zones', () => {
      feed(KELVIN + 42.5, 'celsius');
      const s = shown();
      expect(s.value).toBeCloseTo(42.5);
      expect([s.min, s.max, s.unit]).toEqual([0, 100, '°C']);
      expect(s.ticks).toEqual([]);
      expect(s.highlights).toEqual([
        { from: expect.closeTo(50), to: expect.closeTo(70), color: '#ff0' },
        { from: expect.closeTo(70), to: expect.closeTo(100), color: '#f00' }
      ]);
    });

    it('re-expresses the bounds in a server measure that differs and clamps against them', () => {
      feed(KELVIN + 150, 'fahrenheit');
      const s = shown();
      expect(s.value).toBeCloseTo(212);
      expect(s.min).toBeCloseTo(32);
      expect(s.max).toBeCloseTo(212);
      expect(s.unit).toBe('°F');
      expect(s.highlights).toEqual([
        { from: expect.closeTo(122), to: expect.closeTo(158), color: '#ff0' },
        { from: expect.closeTo(158), to: expect.closeTo(212), color: '#f00' }
      ]);
    });
  });

  describe('scale bounds', () => {
    it('draws 0..60 Hz as 0..3600 rpm, with the ticks a 0..3600 range gets', () => {
      render(true, { displayScale: { lower: 0, upper: 60, type: 'linear' }, convertUnitTo: 'rpm', ignoreZones: true });
      feed(30, 'rpm');
      const s = shown();
      expect(s.value).toBeCloseTo(1800);
      expect({ min: s.min, max: s.max, majorTicks: s.ticks }).toEqual(adjustLinearScaleAndMajorTicks(0, 3600));
      expect(s.unit).toBe('rpm');
    });

    it('draws 273.15..393.15 K as 0..120 °C, and as 32..248 °F when the server shows fahrenheit', () => {
      render(false, { displayScale: { lower: KELVIN, upper: KELVIN + 120, type: 'linear' } });
      feed(KELVIN + 20, 'celsius');
      expect([shown().min, shown().max]).toEqual([0, 120]);
      feed(KELVIN + 20, 'fahrenheit');
      expect([shown().min, shown().max]).toEqual([32, 248]);
    });

    it("takes the path's meta scale for bounds that are not set", () => {
      render(false, {
        displayScale: { lower: null, upper: null, type: 'linear' },
        metaScale: { lower: KELVIN, upper: KELVIN + 120, type: 'linear' }
      });
      feed(KELVIN + 20, 'fahrenheit');
      expect([shown().min, shown().max]).toEqual([32, 248]);
    });

    it('draws 0..100 in the presentation measure when neither the config nor meta sets a bound', () => {
      render(false, { displayScale: { lower: null, upper: null, type: 'linear' } });
      feed(KELVIN + 20, 'fahrenheit');
      expect([shown().min, shown().max]).toEqual([0, 100]);
      expect(shown().value).toBeCloseTo(68);
    });

    it('observes the path meta for its scale even when zones are ignored', () => {
      render(false, { ignoreZones: true });
      expect(metaObserved).toContain('gaugePath');
    });
  });
});
