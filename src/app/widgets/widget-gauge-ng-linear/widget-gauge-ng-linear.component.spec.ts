import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LinearGaugeOptions } from '@godind/ng-canvas-gauges';
import { WidgetGaugeNgLinearComponent } from './widget-gauge-ng-linear.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { UnitsService } from '../../core/services/units.service';
import { IWidgetSvcConfig, IPathArray } from '../../core/interfaces/widgets-interface';

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

  interface LinearInternals {
    effectiveUnit: WritableSignal<string>;
    gaugeOptions: LinearGaugeOptions;
    unitSymbol: () => string;
    buildGaugeOptions: (cfg: IWidgetSvcConfig, theme: unknown, scale: unknown) => void;
    adjustedScale: () => { min: number; max: number; majorTicks: number[] };
  }

  const theme = {
    contrast: '#fff', contrastDim: '#ccc', contrastDimmer: '#999',
    cardColor: '#111', background: '#000'
  };

  const makeConfig = (subType = 'vertical'): IWidgetSvcConfig => {
    const dflt = WidgetGaugeNgLinearComponent.DEFAULT_CONFIG;
    const gaugePath = (dflt.paths as IPathArray)['gaugePath'];
    return {
      ...dflt,
      ignoreZones: true,
      gauge: { ...dflt.gauge, type: 'ngLinear', subType },
      paths: { gaugePath: { ...gaugePath, path: 'self.navigation.speedOverGround', convertUnitTo: 'knots' } }
    };
  };

  const unitsFake = {
    convertBetweenMeasures: (from: string, to: string, value: number): number => from === to ? value : value,
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

    await TestBed.configureTestingModule({
      imports: [WidgetGaugeNgLinearComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: { observe: () => undefined } },
        { provide: WidgetMetadataDirective, useValue: { zones: () => [], observe: () => undefined } },
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

  it('sizes the gauge to the short axis of its box', () => {
    component.onResized(resizeEntry(340, 400));

    expect(sizeUpdates).toHaveLength(1);
    expect(sizeUpdates[0].width).toBeCloseTo(120);   // 0.3 x the 400px height
    expect(sizeUpdates[0].height).toBeCloseTo(390);  // less the 10px inset
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
});
