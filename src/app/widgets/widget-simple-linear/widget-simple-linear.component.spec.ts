import { Component, WritableSignal, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { WidgetSimpleLinearComponent } from './widget-simple-linear.component';
import { SvgSimpleLinearGaugeComponent } from '../svg-simple-linear-gauge/svg-simple-linear-gauge.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { UnitsService } from '../../core/services/units.service';
import { DataService, IPathUpdate } from '../../core/services/data.service';
import { IDataHighlight, IWidgetSvcConfig, IPathArray } from '../../core/interfaces/widgets-interface';
import { ISkDisplayScale, ISkZone, States } from '../../core/interfaces/signalk-interfaces';
import { ITheme } from '../../core/services/app-service';

/** Stands in for the SVG gauge and records what the wrapper hands it. */
@Component({ selector: 'svg-simple-linear-gauge', template: '' })
class SvgSimpleLinearGaugeStubComponent {
  readonly displayName = input.required<string>();
  readonly displayNameColor = input.required<string | undefined>();
  readonly dataValue = input.required<number | null>();
  readonly dataValueLabel = input.required<string>();
  readonly unitLabel = input.required<string>();
  readonly barColor = input.required<string>();
  readonly barColorGradient = input.required<string>();
  readonly barColorBackground = input.required<string>();
  readonly gaugeMinValue = input.required<number>();
  readonly gaugeMaxValue = input.required<number>();
  readonly highlights = input.required<IDataHighlight[]>();
}

const ZERO_C = 273.15;

/**
 * What the wrapper hands its SVG gauge for a set of SI inputs: the bar value after clamping, its
 * readout text and unit label, the scale bounds and the zone highlights. Pins the output so a change
 * of the unit the widget computes in cannot move anything on screen.
 */
describe('WidgetSimpleLinearComponent output from SI inputs', () => {
  let fixture: ComponentFixture<WidgetSimpleLinearComponent>;
  let next: ((u: IPathUpdate) => void) | undefined;
  let options: WritableSignal<IWidgetSvcConfig>;
  let metaScale: WritableSignal<ISkDisplayScale | undefined>;
  let metaObserved: string[];

  const theme = {
    contrast: '#fff', contrastDim: '#ccc', contrastDimmer: '#999', background: '#000',
    zoneNominal: 'nominal', zoneAlert: 'alert', zoneWarn: 'warn', zoneAlarm: 'alarm', zoneEmergency: 'emergency'
  } as unknown as ITheme;

  const zones: ISkZone[] = [
    { lower: ZERO_C + 60, upper: ZERO_C + 80, state: States.Warn },
    { lower: ZERO_C + 80, state: States.Alarm }
  ];

  // Bounds are SI; the default is 0..100 °C.
  const makeConfig = (convertUnitTo: string, lower: number | null = ZERO_C, upper: number | null = ZERO_C + 100): IWidgetSvcConfig => {
    const dflt = WidgetSimpleLinearComponent.DEFAULT_CONFIG;
    const gaugePath = (dflt.paths as IPathArray)['gaugePath'];
    return {
      ...dflt,
      numDecimal: 1,
      displayScale: { type: 'linear', lower, upper },
      paths: { gaugePath: { ...gaugePath, path: 'self.propulsion.main.temperature', convertUnitTo } }
    };
  };

  /** An SI sample as the streams directive delivers it to this widget, with its presentation measure. */
  const feed = (si: number | null, measure: string, state: States = States.Normal): void => {
    next?.({ data: { value: si, timestamp: null, measure }, state } as unknown as IPathUpdate);
    fixture.detectChanges();
  };

  const shown = () => {
    const g = fixture.debugElement.query(By.directive(SvgSimpleLinearGaugeStubComponent))
      .componentInstance as SvgSimpleLinearGaugeStubComponent;
    return {
      value: g.dataValue(), text: g.dataValueLabel(), unit: g.unitLabel(),
      min: g.gaugeMinValue(), max: g.gaugeMaxValue(), highlights: g.highlights(), bar: g.barColor()
    };
  };

  /** Highlights with their bounds rounded, so float noise from the unit maths does not fail a pin. */
  const rounded = (hs: IDataHighlight[]) =>
    hs.map(h => ({ from: Number(h.from.toFixed(2)), to: Number(h.to.toFixed(2)), color: h.color }));

  beforeEach(async () => {
    next = undefined;
    metaScale = signal<ISkDisplayScale | undefined>(undefined);
    metaObserved = [];
    options = signal(makeConfig('celsius'));

    TestBed.overrideComponent(WidgetSimpleLinearComponent, {
      remove: { imports: [SvgSimpleLinearGaugeComponent] },
      add: { imports: [SvgSimpleLinearGaugeStubComponent] }
    });
    await TestBed.configureTestingModule({
      imports: [WidgetSimpleLinearComponent],
      providers: [
        UnitsService,
        { provide: DataService, useValue: {} },
        { provide: WidgetRuntimeDirective, useValue: { options } },
        {
          provide: WidgetStreamsDirective,
          useValue: {
            observe: (_p: string, n: (u: IPathUpdate) => void) => { next = n; }
          }
        },
        { provide: WidgetMetadataDirective, useValue: {
          zones: signal(zones),
          displayScale: metaScale,
          observe: (key: string) => { metaObserved.push(key); }
        } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetSimpleLinearComponent);
    fixture.componentRef.setInput('id', 'linear-si');
    fixture.componentRef.setInput('type', 'widget-simple-linear');
    fixture.componentRef.setInput('theme', theme);
    fixture.detectChanges();
  });

  it('shows a reading in the stored unit on the stored scale', () => {
    feed(ZERO_C + 21.5, 'celsius');
    const s = shown();
    expect(s.value).toBeCloseTo(21.5);
    expect(s).toMatchObject({ text: '21.5', unit: '°C', min: 0, max: 100 });
    expect(rounded(s.highlights)).toEqual([
      { from: 60, to: 80, color: 'warn' },
      { from: 80, to: 100, color: 'alarm' }
    ]);
  });

  it('re-expresses the scale and zones in the server measure when it differs from the stored unit', () => {
    feed(ZERO_C + 21.5, 'fahrenheit');
    const s = shown();
    expect(s.value).toBeCloseTo(70.7);
    expect(s.text).toBe('70.7');
    expect(s.unit).toBe('°F');
    expect(s.min).toBeCloseTo(32);
    expect(s.max).toBeCloseTo(212);
    expect(rounded(s.highlights)).toEqual([
      { from: 140, to: 176, color: 'warn' },
      { from: 176, to: 212, color: 'alarm' }
    ]);
  });

  it('clamps a reading above the scale, readout included', () => {
    feed(ZERO_C + 130, 'celsius');
    expect(shown()).toMatchObject({ value: 100, text: '100.0' });
    feed(ZERO_C + 130, 'fahrenheit');
    expect(shown().value).toBeCloseTo(212);
    expect(shown().text).toBe('212.0');
  });

  it('clamps a reading below the scale, readout included', () => {
    feed(ZERO_C - 10, 'celsius');
    expect(shown()).toMatchObject({ value: 0, text: '0.0' });
  });

  it('parks the bar at the minimum with a placeholder readout on a null', () => {
    feed(ZERO_C + 21.5, 'fahrenheit');
    feed(null, 'fahrenheit');
    const s = shown();
    expect(s.value).toBeCloseTo(32);
    expect(s).toMatchObject({ text: '--', unit: '°F' });
  });

  it('draws the stored scale and zones before the first sample', () => {
    const s = shown();
    expect(s).toMatchObject({ value: null, text: '0', unit: '', min: 0, max: 100 });
    expect(rounded(s.highlights)).toEqual([
      { from: 60, to: 80, color: 'warn' },
      { from: 80, to: 100, color: 'alarm' }
    ]);
  });

  it('passes a unitless reading through', () => {
    options.set({ ...makeConfig('unitless', -50, 50), ignoreZones: true });
    fixture.detectChanges();
    feed(-12.25, 'unitless');
    expect(shown()).toMatchObject({ value: -12.25, text: '-12.3', unit: '', min: -50, max: 50, highlights: [] });
  });

  it('colours the bar by the zone state', () => {
    feed(ZERO_C + 85, 'celsius', States.Alarm);
    expect(shown().bar).toBe('alarm');
  });

  describe('scale bounds', () => {
    it('draws 273.15..393.15 K as 0..120 °C, and as 32..248 °F when the server shows fahrenheit', () => {
      options.set(makeConfig('celsius', ZERO_C, ZERO_C + 120));
      fixture.detectChanges();
      feed(ZERO_C + 20, 'celsius');
      expect([shown().min, shown().max]).toEqual([0, 120]);
      feed(ZERO_C + 20, 'fahrenheit');
      expect([shown().min, shown().max]).toEqual([32, 248]);
    });

    it("takes the path's meta scale for bounds that are not set", () => {
      options.set(makeConfig('celsius', null, null));
      metaScale.set({ lower: ZERO_C, upper: ZERO_C + 120, type: 'linear' });
      fixture.detectChanges();
      feed(ZERO_C + 20, 'fahrenheit');
      expect([shown().min, shown().max]).toEqual([32, 248]);
    });

    it('draws 0..100 in the presentation measure when neither the config nor meta sets a bound', () => {
      options.set(makeConfig('celsius', null, null));
      fixture.detectChanges();
      feed(ZERO_C + 20, 'fahrenheit');
      expect([shown().min, shown().max]).toEqual([0, 100]);
      expect(shown().value).toBeCloseTo(68);
    });

    it('observes the path meta for its scale even when zones are ignored', () => {
      metaObserved = [];
      options.set({ ...makeConfig('celsius'), ignoreZones: true });
      fixture.detectChanges();
      expect(metaObserved).toContain('gaugePath');
    });
  });
});
