import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { WidgetGaugeNgRadialComponent } from './widget-gauge-ng-radial.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { UnitsService } from '../../core/services/units.service';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig, IPathArray } from '../../core/interfaces/widgets-interface';
import { IScale } from '../../core/utils/dataScales.util';
import { States } from '../../core/interfaces/signalk-interfaces';

/**
 * Regression tests for the gauge's displayScale reinterpretation — the P2b unit-flip mechanic.
 *
 * The stored displayScale bounds are authored in the widget's configured `convertUnitTo`. Once the
 * server's resolved measure for the path is tagged onto the live value (effectiveUnit), the gauge must
 * REINTERPRET those bounds into that measure via UnitsService.convertBetweenMeasures — so the scale,
 * the clamp, and the null-placeholder value all track the unit actually being displayed rather than the
 * stored authoring unit. Before the first tagged update (or while it is the 'unitless' boot placeholder)
 * the bounds fall back to the stored convertUnitTo unchanged.
 *
 * Harness: the three host directives are faked (heel-gauge pattern). The @godind/ng-canvas-gauges lib is
 * aliased to a no-op shim in the test build, so the rendered <radial-gauge> is a bare <canvas> and the
 * component's guarded ngGauge().update(...) calls are harmless no-ops. UnitsService.convertBetweenMeasures
 * is faked with a known ×2 factor (identity when the measures match, mirroring the real same-measure
 * no-op) so a reinterpretation is visible as a doubling and a fallback as the untouched bound.
 */
describe('WidgetGaugeNgRadialComponent displayScale reinterpretation (P2b flip)', () => {
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

  // convertUnitTo is the stored authoring unit; a tagged measure that differs is the flip target.
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
    // Known ×2 factor between differing measures; identity when they match (the real no-op case).
    convertBetweenMeasures: (from: string, to: string, value: number): number =>
      from === to ? value : value * 2,
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
    const metadataFake = { zones: () => [], observe: () => undefined };

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

  it('reinterprets the stored displayScale bounds from convertUnitTo into the tagged measure', () => {
    // Bounds authored in 'ratio' (10..100), value tagged 'percent' -> both bounds reinterpreted (×2).
    internals.effectiveUnit.set('percent');
    expect(internals.adjustedScale()).toEqual({ min: 20, max: 200, majorTicks: [] });
  });

  it('leaves the bounds at the stored convertUnitTo before any measure is tagged', () => {
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
    capturedNext?.(update(42, 'percent'));
    expect(internals.dataAvailable()).toBe(true);
    expect(internals.textValue()).toBe('');
  });

  it('drops back to the placeholder when a later datapoint is null', () => {
    capturedNext?.(update(42, 'percent'));
    capturedNext?.(update(null, 'percent'));
    expect(internals.dataAvailable()).toBe(false);
    expect(internals.textValue()).toBe('--');
  });

  it('sets the value to the reinterpreted lower bound on a null (first/placeholder) datapoint', () => {
    capturedNext?.(update(null, 'percent'));
    // lower bound 10 reinterpreted 'ratio'->'percent' = 20; text stays the placeholder.
    expect(internals.value()).toBe(20);
    expect(internals.textValue()).toBe('--');
    expect(internals.effectiveUnit()).toBe('percent');
  });

  it('clamps a live value against the reinterpreted upper bound', () => {
    capturedNext?.(update(250, 'percent'));
    // upper bound 100 reinterpreted 'ratio'->'percent' = 200; 250 clamps down to it.
    expect(internals.value()).toBe(200);
  });

  it("resets effectiveUnit to '' on resubscribe when the replayed value carries no resolved measure", () => {
    capturedNext?.(update(42, 'percent'));
    expect(internals.effectiveUnit()).toBe('percent');

    // A config change re-runs the data effect -> the streams directive resubscribes (fresh callback).
    options.set(makeConfig());
    fixture.detectChanges();
    expect(observeCount).toBe(2);

    // The resubscribed stream replays its bootstrap value before the server measure resolves (no tag),
    // and the callback resets effectiveUnit back to the '' placeholder.
    capturedNext?.(update(null));
    expect(internals.effectiveUnit()).toBe('');
    // With the tag cleared, the scale falls back to the stored convertUnitTo bounds again.
    expect(internals.adjustedScale()).toEqual({ min: 10, max: 100, majorTicks: [] });
  });

  // #534: a rebuilt subscription against a silent path replays nothing (the leading null is
  // suppressed), so the stream callback never runs and the previous path's reading stayed on the
  // dial, presented as a live reading of the new path.
  it('clears the reading when re-pointed at a path that reports nothing', () => {
    capturedNext?.(update(42, 'percent'));
    expect(internals.dataAvailable()).toBe(true);
    expect(internals.value()).toBe(42); // within the reinterpreted 20..200 scale, so unclamped

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
    capturedNext?.(update(42, 'percent'));
    expect(internals.value()).toBe(42);

    replayOnObserve = update(71, 'percent');
    options.set(makeConfig('self.test.live'));
    fixture.detectChanges();

    expect(internals.dataAvailable()).toBe(true);
    expect(internals.value()).toBe(71);
    expect(internals.textValue()).toBe('');
  });

  // Zone colours are driven by the path's state, so carrying an old path's alarm onto a new one is
  // the same lie as carrying its value.
  it('clears the zone state on a re-point, so an old alarm colour cannot carry over', () => {
    capturedNext?.({ data: { value: 42, timestamp: null, measure: 'percent' }, state: States.Alarm });
    expect(internals.pathDataState()).toBe(States.Alarm);

    options.set(makeConfig('self.test.silent'));
    fixture.detectChanges();

    expect(internals.pathDataState()).toBeNull();
  });

  // Clearing the path tears the subscription down in the directive, so the reading has to go too —
  // otherwise the dial keeps a number with nothing feeding it.
  it('clears the reading when the path is cleared entirely', () => {
    capturedNext?.(update(42, 'percent'));
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
    capturedNext?.(update(42, 'percent'));

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
    capturedNext?.(update(42, 'percent'));
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
