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
import { States } from '../../core/interfaces/signalk-interfaces';
import { IPathUpdate } from '../../core/services/data.service';

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

  const makeConfig = (subType = 'vertical', path = 'self.navigation.speedOverGround'): IWidgetSvcConfig => {
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
