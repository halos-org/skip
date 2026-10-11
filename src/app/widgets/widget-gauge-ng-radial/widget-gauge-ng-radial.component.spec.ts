import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { WidgetGaugeNgRadialComponent } from './widget-gauge-ng-radial.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { UnitsService } from '../../core/services/units.service';
import { RadialGaugeOptions } from '@godind/ng-canvas-gauges';
import { DataService, IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig, IPathArray, IDataHighlight } from '../../core/interfaces/widgets-interface';
import { IScale, adjustLinearScaleAndMajorTicks } from '../../core/utils/dataScales.util';
import { ISkDisplayScale, ISkZone, States } from '../../core/interfaces/signalk-interfaces';

/**
 * Regression tests for how the gauge presents its displayScale bounds, which are stored in SI.
 *
 * Once the server's resolved measure for the path is tagged onto the live value (effectiveUnit), the
 * gauge converts the SI bounds into that measure, so the scale, the clamp and the null-placeholder
 * value all track the unit actually being displayed. Before the first tagged update the bounds are
 * presented in the stored convertUnitTo.
 *
 * Harness: the three host directives are faked (heel-gauge pattern). The @godind/ng-canvas-gauges lib is
 * aliased to a no-op shim in the test build, so the rendered <radial-gauge> is a bare <canvas> and the
 * component's guarded ngGauge().update(...) calls are harmless no-ops. UnitsService.convertToUnit is
 * faked with a known ×2 factor into 'percent' and identity otherwise, so a conversion is visible as a
 * doubling and a fallback as the untouched SI number.
 */
describe('WidgetGaugeNgRadialComponent displayScale presentation', () => {
  let fixture: ComponentFixture<WidgetGaugeNgRadialComponent>;
  let internals: GaugeInternals;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let capturedNext: ((u: IPathUpdate) => void) | undefined;
  let observeCount: number;
  let lastObservedPath: string;
  let replayOnObserve: IPathUpdate | undefined;

  interface GaugeInternals {
    effectiveUnit: WritableSignal<string>;
    adjustedScale: () => IScale;
    value: () => number | null | undefined;
    textValue: () => string;
    dataAvailable: () => boolean;
    optionsReady: () => boolean;
    pathDataState: () => States | null;
  }

  // SI bounds; convertUnitTo is the stored unit, a tagged measure that differs is what they convert to.
  const makeConfig = (path = 'self.test.soc'): IWidgetSvcConfig => {
    const dflt = WidgetGaugeNgRadialComponent.DEFAULT_CONFIG;
    const gaugePath = (dflt.paths as IPathArray)['gaugePath'];
    return {
      ...dflt,
      ignoreZones: true,
      displayScale: { lower: 10, upper: 100, type: 'linear' },
      gauge: { ...dflt.gauge, type: 'ngRadial', subType: 'capacity' },
      paths: {
        gaugePath: { ...gaugePath, path, convertUnitTo: 'ratio' }
      }
    };
  };

  const update = (value: unknown, measure?: string): IPathUpdate =>
    ({ data: { value, timestamp: null, measure }, state: 'normal' });

  const unitsFake = {
    convertToUnit: (measure: string, value: number): number => measure === 'percent' ? value * 2 : value,
    getUnitDisplaySymbol: (measure: string | null | undefined): string => measure ?? '',
    resolvePathMeasure: (path: string): string => path
  };

  beforeEach(async () => {
    options = signal<IWidgetSvcConfig | undefined>(makeConfig());
    capturedNext = undefined;
    observeCount = 0;
    lastObservedPath = '';

    replayOnObserve = undefined;
    const streamsFake = {
      observe(pathName: string, next: (u: IPathUpdate) => void) {
        lastObservedPath = pathName;
        capturedNext = next;
        observeCount++;
        // The real directive's base is a BehaviorSubject, so a path that already holds a value
        // replays it synchronously, inside the same effect run as the clear.
        if (replayOnObserve) next(replayOnObserve);
      }
    };
    const metadataFake = { zones: () => [], displayScale: () => undefined, observe: () => undefined };

    await TestBed.configureTestingModule({
      imports: [WidgetGaugeNgRadialComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsFake },
        { provide: WidgetMetadataDirective, useValue: metadataFake },
        { provide: UnitsService, useValue: unitsFake }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetGaugeNgRadialComponent);
    fixture.componentRef.setInput('id', 'gauge-1');
    fixture.componentRef.setInput('type', 'widget-gauge-ng-radial');
    fixture.componentRef.setInput('theme', {
      contrast: '#fff', contrastDim: '#ccc', contrastDimmer: '#999',
      cardColor: '#111', background: '#000'
    });
    // Runs the data-subscription and option-building effects, capturing the stream callback. The gauge
    // element renders as soon as the options exist (the lib is a no-op shim here), before any data.
    fixture.detectChanges();
    internals = fixture.componentInstance as unknown as GaugeInternals;
  });

  it('subscribes to the gaugePath stream', () => {
    expect(lastObservedPath).toBe('gaugePath');
    expect(capturedNext).toBeTypeOf('function');
  });

  it('converts the SI displayScale bounds into the tagged measure', () => {
    // SI bounds 10..100, value tagged 'percent' -> both bounds converted (×2).
    internals.effectiveUnit.set('percent');
    expect(internals.adjustedScale()).toEqual({ min: 20, max: 200, majorTicks: [] });
  });

  it('presents the bounds in the stored convertUnitTo before any measure is tagged', () => {
    // effectiveUnit '' (boot) -> fall back to convertUnitTo ('ratio'), identity conversion.
    internals.effectiveUnit.set('');
    expect(internals.adjustedScale()).toEqual({ min: 10, max: 100, majorTicks: [] });
  });

  it('renders the gauge before any datapoint arrives, with no needle and a placeholder reading', () => {
    // The widget must show its dial rather than a blank card while its path is silent.
    expect(internals.optionsReady()).toBe(true);
    expect(fixture.nativeElement.querySelector('radial-gauge')).not.toBeNull();
    expect(internals.dataAvailable()).toBe(false);
    expect(internals.textValue()).toBe('--');
  });

  it('marks data available once a non-null value arrives and blanks the placeholder text', () => {
    capturedNext?.(update(21, 'percent'));
    expect(internals.dataAvailable()).toBe(true);
    expect(internals.textValue()).toBe('');
  });

  it('drops back to the placeholder when a later datapoint is null', () => {
    capturedNext?.(update(21, 'percent'));
    capturedNext?.(update(null, 'percent'));
    expect(internals.dataAvailable()).toBe(false);
    expect(internals.textValue()).toBe('--');
  });

  it('sets the value to the converted lower bound on a null (first/placeholder) datapoint', () => {
    capturedNext?.(update(null, 'percent'));
    // lower bound 10 converted to 'percent' = 20; text stays the placeholder.
    expect(internals.value()).toBe(20);
    expect(internals.textValue()).toBe('--');
    expect(internals.effectiveUnit()).toBe('percent');
  });

  it('clamps a live value against the converted upper bound', () => {
    capturedNext?.(update(125, 'percent'));
    // upper bound 100 converted to 'percent' = 200; the reading, 250 in percent, clamps down to it.
    expect(internals.value()).toBe(200);
  });

  // #534: a rebuilt subscription against a silent path replays nothing (the leading null is
  // suppressed), so the stream callback never runs and the previous path's reading stayed on the
  // dial, presented as a live reading of the new path.
  it('clears the reading when re-pointed at a path that reports nothing', () => {
    capturedNext?.(update(21, 'percent'));
    expect(internals.dataAvailable()).toBe(true);
    expect(internals.value()).toBe(42); // within the converted 20..200 scale, so unclamped

    options.set(makeConfig('self.test.silent'));
    fixture.detectChanges();

    // The new subscription delivers nothing at all — exactly the case that used to leave the old
    // needle in place.
    expect(internals.dataAvailable()).toBe(false);
    expect(internals.value()).toBeUndefined();
    expect(internals.textValue()).toBe('--');
    expect(internals.effectiveUnit()).toBe('');
  });

  // The clear is only correct because it runs in the same synchronous block as the resubscribe: the
  // directive's base is a BehaviorSubject, so a path that already holds a value replays it at once.
  // Separating the two would blank the gauge on every re-point, which is the difference between
  // clearing STALE data and clearing ALL data.
  it('shows the new path\'s reading immediately when it has one, without surfacing the clear', () => {
    capturedNext?.(update(21, 'percent'));
    expect(internals.value()).toBe(42);

    replayOnObserve = update(35.5, 'percent');
    options.set(makeConfig('self.test.live'));
    fixture.detectChanges();

    expect(internals.dataAvailable()).toBe(true);
    expect(internals.value()).toBe(71);
    expect(internals.textValue()).toBe('');
  });

  // Zone colours are driven by the path's state, so carrying an old path's alarm onto a new one is
  // the same lie as carrying its value.
  it('clears the zone state on a re-point, so an old alarm colour cannot carry over', () => {
    capturedNext?.({ data: { value: 21, timestamp: null, measure: 'percent' }, state: States.Alarm });
    expect(internals.pathDataState()).toBe(States.Alarm);

    options.set(makeConfig('self.test.silent'));
    fixture.detectChanges();

    expect(internals.pathDataState()).toBeNull();
  });

  // Clearing the path tears the subscription down in the directive, so the reading has to go too —
  // otherwise the dial keeps a number with nothing feeding it.
  it('clears the reading when the path is cleared entirely', () => {
    capturedNext?.(update(21, 'percent'));
    expect(internals.dataAvailable()).toBe(true);

    const cleared = makeConfig();
    (cleared.paths as IPathArray)['gaugePath'].path = null;
    options.set(cleared);
    fixture.detectChanges();

    expect(internals.dataAvailable()).toBe(false);
    expect(internals.value()).toBeUndefined();
    expect(internals.textValue()).toBe('--');
  });

  // A path-less config has no signature, so it must not read as "nothing has been shown yet" and
  // suppress the clear on the re-point after it.
  it('still clears on the re-point that follows a cleared path', () => {
    capturedNext?.(update(21, 'percent'));

    const cleared = makeConfig();
    (cleared.paths as IPathArray)['gaugePath'].path = null;
    options.set(cleared);
    fixture.detectChanges();

    options.set(makeConfig('self.test.live'));
    fixture.detectChanges();
    capturedNext?.(update(7, 'percent'));
    expect(internals.dataAvailable()).toBe(true);

    options.set(makeConfig('self.test.silent'));
    fixture.detectChanges();
    expect(internals.dataAvailable()).toBe(false);
  });

  // The same effect re-runs on a theme change, so an unconditional clear would blink the needle off
  // and back on at every switch.
  it('keeps the reading when the config changes without changing the path', () => {
    capturedNext?.(update(21, 'percent'));
    expect(internals.dataAvailable()).toBe(true);

    const before = observeCount;
    fixture.componentRef.setInput('theme', {
      contrast: '#000', contrastDim: '#333', contrastDimmer: '#666',
      cardColor: '#eee', background: '#fff'
    });
    fixture.detectChanges();

    // Positive control: the effect really did re-run, so "no clear" is a decision, not a no-op.
    expect(observeCount).toBeGreaterThan(before);
    expect(internals.dataAvailable()).toBe(true);
    expect(internals.value()).toBe(42);
    expect(internals.textValue()).toBe('');
    expect(internals.effectiveUnit()).toBe('percent');
  });
});

/**
 * What the gauge draws for a set of SI inputs, through the real UnitsService: the value handed to
 * the library after clamping, the scale bounds and major ticks, the units label and the zone
 * highlights, for both subtypes. Pins the output so a change of the unit the widget computes in
 * cannot move anything on screen. The stored scale is 0..100 °C, in SI; the server may present the
 * path in another measure.
 */
describe('WidgetGaugeNgRadialComponent output from SI inputs', () => {
  let fixture: ComponentFixture<WidgetGaugeNgRadialComponent>;
  let next: ((u: IPathUpdate) => void) | undefined;
  let zones: WritableSignal<ISkZone[]>;
  let metaObserved: string[];

  interface RadialOutput {
    value: () => number | null | undefined;
    textValue: () => string;
    gaugeOptions: RadialGaugeOptions;
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

  const render = (subType: 'measuring' | 'capacity', over: RenderOptions = {}): void => {
    const dflt = WidgetGaugeNgRadialComponent.DEFAULT_CONFIG;
    const gaugePath = (dflt.paths as IPathArray)['gaugePath'];
    const cfg: IWidgetSvcConfig = {
      ...dflt,
      ignoreZones: over.ignoreZones ?? false,
      // 0..100 °C, in SI.
      displayScale: over.displayScale ?? { lower: KELVIN, upper: KELVIN + 100, type: 'linear' },
      gauge: { ...dflt.gauge, type: 'ngRadial', subType },
      paths: { gaugePath: { ...gaugePath, path: 'self.propulsion.main.temperature', convertUnitTo: over.convertUnitTo ?? 'celsius' } }
    };
    zones = signal<ISkZone[]>(temperatureZones);
    metaObserved = [];
    TestBed.configureTestingModule({
      imports: [WidgetGaugeNgRadialComponent],
      providers: [
        UnitsService,
        { provide: DataService, useValue: {} },
        { provide: WidgetRuntimeDirective, useValue: { options: signal(cfg) } },
        { provide: WidgetStreamsDirective, useValue: {
          observe: (_p: string, n: (u: IPathUpdate) => void) => { next = n; }
        } },
        { provide: WidgetMetadataDirective, useValue: {
          zones,
          displayScale: signal(over.metaScale),
          observe: (key: string) => { metaObserved.push(key); }
        } }
      ]
    });
    fixture = TestBed.createComponent(WidgetGaugeNgRadialComponent);
    fixture.componentRef.setInput('id', 'gauge-1');
    fixture.componentRef.setInput('type', 'widget-gauge-ng-radial');
    fixture.componentRef.setInput('theme', theme);
    fixture.detectChanges();
  };

  const shown = () => {
    const c = fixture.componentInstance as unknown as RadialOutput;
    const o = c.gaugeOptions;
    return {
      value: c.value(),
      text: c.textValue(),
      min: o.minValue,
      max: o.maxValue,
      ticks: o.majorTicks,
      units: o.units,
      highlights: c.highlights()
    };
  };

  describe('measuring', () => {
    beforeEach(() => render('measuring'));

    it('shows a reading in the stored measure on the stored scale, with its zones', () => {
      feed(KELVIN + 42.5, 'celsius');
      const s = shown();
      expect(s.value).toBeCloseTo(42.5);
      expect(s.text).toBe('');
      expect([s.min, s.max, s.units]).toEqual([0, 100, '°C']);
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
      expect([s.min, s.max, s.units]).toEqual([20, 220, '°F']);
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

    it('parks the needle at the re-expressed lower bound with a placeholder on a null reading', () => {
      feed(null, 'fahrenheit');
      const s = shown();
      expect(s.value).toBeCloseTo(32);
      expect(s.text).toBe('--');
    });
  });

  describe('capacity', () => {
    beforeEach(() => render('capacity'));

    it('uses the bounds as they are, with no ticks and no zone bands', () => {
      feed(KELVIN + 42.5, 'celsius');
      const s = shown();
      expect(s.value).toBeCloseTo(42.5);
      expect([s.min, s.max, s.units]).toEqual([0, 100, '°C']);
      expect(s.ticks).toBe(0);
      expect(s.highlights).toEqual([]);
    });

    it('re-expresses the bounds in a server measure that differs and clamps against them', () => {
      feed(KELVIN + 150, 'fahrenheit');
      const s = shown();
      expect(s.value).toBeCloseTo(212);
      expect(s.min).toBeCloseTo(32);
      expect(s.max).toBeCloseTo(212);
      expect(s.units).toBe('°F');
    });

    it('parks the needle at the re-expressed lower bound on a null reading', () => {
      feed(null, 'fahrenheit');
      expect(shown().value).toBeCloseTo(32);
      expect(shown().text).toBe('--');
    });
  });

  describe('scale bounds', () => {
    it('draws 0..60 Hz as 0..3600 rpm, with the ticks a 0..3600 range gets', () => {
      render('measuring', { displayScale: { lower: 0, upper: 60, type: 'linear' }, convertUnitTo: 'rpm', ignoreZones: true });
      feed(30, 'rpm');
      const s = shown();
      expect(s.value).toBeCloseTo(1800);
      const stored = adjustLinearScaleAndMajorTicks(0, 3600);
      expect({ min: s.min, max: s.max, majorTicks: s.ticks }).toEqual(stored);
      expect(s.units).toBe('rpm');
    });

    it('draws 273.15..393.15 K as 0..120 °C, and as 32..248 °F when the server shows fahrenheit', () => {
      render('capacity', { displayScale: { lower: KELVIN, upper: KELVIN + 120, type: 'linear' } });
      feed(KELVIN + 20, 'celsius');
      expect([shown().min, shown().max]).toEqual([0, 120]);
      feed(KELVIN + 20, 'fahrenheit');
      expect([shown().min, shown().max]).toEqual([32, 248]);
    });

    it("takes the path's meta scale for bounds that are not set", () => {
      render('capacity', {
        displayScale: { lower: null, upper: null, type: 'linear' },
        metaScale: { lower: KELVIN, upper: KELVIN + 120, type: 'linear' }
      });
      feed(KELVIN + 20, 'fahrenheit');
      expect([shown().min, shown().max]).toEqual([32, 248]);
    });

    it('draws 0..100 in the presentation measure when neither the config nor meta sets a bound', () => {
      render('capacity', { displayScale: { lower: null, upper: null, type: 'linear' } });
      feed(KELVIN + 20, 'fahrenheit');
      expect([shown().min, shown().max]).toEqual([0, 100]);
      expect(shown().value).toBeCloseTo(68);
    });

    it('observes the path meta for its scale even when zones are ignored', () => {
      render('capacity', { ignoreZones: true });
      expect(metaObserved).toContain('gaugePath');
    });
  });
});
