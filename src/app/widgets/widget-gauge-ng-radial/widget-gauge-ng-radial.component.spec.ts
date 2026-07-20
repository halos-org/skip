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

  interface GaugeInternals {
    effectiveUnit: WritableSignal<string>;
    adjustedScale: () => IScale;
    value: () => number | null | undefined;
    textValue: () => string;
  }

  // convertUnitTo is the stored authoring unit; a tagged measure that differs is the flip target.
  const makeConfig = (): IWidgetSvcConfig => {
    const dflt = WidgetGaugeNgRadialComponent.DEFAULT_CONFIG;
    const gaugePath = (dflt.paths as IPathArray)['gaugePath'];
    return {
      ...dflt,
      ignoreZones: true,
      displayScale: { lower: 10, upper: 100, type: 'linear' },
      gauge: { ...dflt.gauge, type: 'ngRadial', subType: 'capacity' },
      paths: {
        gaugePath: { ...gaugePath, path: 'self.test.soc', convertUnitTo: 'ratio' }
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

    const streamsFake = {
      observe(pathName: string, next: (u: IPathUpdate) => void) {
        lastObservedPath = pathName;
        capturedNext = next;
        observeCount++;
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
    // Runs the data-subscription effect, capturing the stream callback (value still undefined here, so
    // the @if never renders the gauge and no lib code runs).
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
});
