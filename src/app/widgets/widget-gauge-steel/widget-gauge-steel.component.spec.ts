import { Component, WritableSignal, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { WidgetSteelGaugeComponent } from './widget-gauge-steel.component';
import { GaugeSteelComponent } from '../gauge-steel/gauge-steel.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { UnitsService } from '../../core/services/units.service';
import { DataService, IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig, IPathArray } from '../../core/interfaces/widgets-interface';
import { ISkDisplayScale, ISkZone, States } from '../../core/interfaces/signalk-interfaces';
import { ITheme } from '../../core/services/app-service';

/** Stands in for the steelseries gauge and records what the wrapper hands it. */
@Component({ selector: 'gauge-steel', template: '' })
class GaugeSteelStubComponent {
  readonly widgetUUID = input<string>();
  readonly subType = input<string>();
  readonly barGauge = input<boolean>();
  readonly radialSize = input<string>();
  readonly backgroundColor = input<string>();
  readonly frameColor = input<string>();
  readonly minValue = input<number>();
  readonly maxValue = input<number>();
  readonly decimals = input<number>();
  readonly zones = input<ISkZone[]>();
  readonly title = input<string>();
  readonly units = input<string>();
  readonly value = input<number | null>();
  // eslint-disable-next-line @angular-eslint/no-input-rename
  readonly theme = input<ITheme | null>(null, { alias: 'themeColors' });
}

const ZERO_C = 273.15;

/**
 * What the wrapper hands its steel gauge for a set of SI inputs: the needle value after clamping,
 * the scale bounds, the unit and decimals the LCD formats with, and the zones. Pins the output so a
 * change of the unit the widget computes in cannot move anything on screen.
 */
describe('WidgetSteelGaugeComponent output from SI inputs', () => {
  let fixture: ComponentFixture<WidgetSteelGaugeComponent>;
  let next: ((u: IPathUpdate) => void) | undefined;
  let options: WritableSignal<IWidgetSvcConfig>;
  let zones: WritableSignal<ISkZone[]>;
  let metaScale: WritableSignal<ISkDisplayScale | undefined>;
  let metaObserved: string[];

  const zoneWarn: ISkZone = { lower: ZERO_C + 60, upper: ZERO_C + 80, state: States.Warn };

  // Bounds are SI; the default is 0..100 °C.
  const makeConfig = (convertUnitTo: string, lower: number | null = ZERO_C, upper: number | null = ZERO_C + 100): IWidgetSvcConfig => {
    const dflt = WidgetSteelGaugeComponent.DEFAULT_CONFIG;
    const gaugePath = (dflt.paths as IPathArray)['gaugePath'];
    return {
      ...dflt,
      numDecimal: 1,
      displayScale: { type: 'linear', lower, upper },
      paths: { gaugePath: { ...gaugePath, path: 'self.propulsion.main.temperature', convertUnitTo } }
    };
  };

  /** An SI sample as the streams directive delivers it to this widget, with its presentation measure. */
  const feed = (si: number | null, measure: string): void => {
    next?.({ data: { value: si, timestamp: null, measure }, state: States.Normal } as unknown as IPathUpdate);
    fixture.detectChanges();
  };

  const shown = () => {
    const g = fixture.debugElement.query(By.directive(GaugeSteelStubComponent)).componentInstance as GaugeSteelStubComponent;
    return { value: g.value(), min: g.minValue(), max: g.maxValue(), units: g.units(), decimals: g.decimals(), zones: g.zones() };
  };

  beforeEach(async () => {
    next = undefined;
    metaScale = signal<ISkDisplayScale | undefined>(undefined);
    metaObserved = [];
    options = signal(makeConfig('celsius'));
    zones = signal<ISkZone[]>([zoneWarn]);

    TestBed.overrideComponent(WidgetSteelGaugeComponent, {
      remove: { imports: [GaugeSteelComponent] },
      add: { imports: [GaugeSteelStubComponent] }
    });
    await TestBed.configureTestingModule({
      imports: [WidgetSteelGaugeComponent],
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
          zones,
          displayScale: metaScale,
          observe: (key: string) => { metaObserved.push(key); }
        } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetSteelGaugeComponent);
    fixture.componentRef.setInput('id', 'steel-si');
    fixture.componentRef.setInput('type', 'widget-gauge-steel');
    fixture.componentRef.setInput('theme', null);
    fixture.detectChanges();
  });

  it('shows a reading in the stored unit on the stored scale', () => {
    feed(ZERO_C + 21.5, 'celsius');
    const s = shown();
    expect(s.value).toBeCloseTo(21.5);
    expect(s).toMatchObject({ min: 0, max: 100, units: 'celsius', decimals: 1, zones: [zoneWarn] });
  });

  it('re-expresses the scale in the server measure when it differs from the stored unit', () => {
    feed(ZERO_C + 21.5, 'fahrenheit');
    const s = shown();
    expect(s.value).toBeCloseTo(70.7);
    expect(s.min).toBeCloseTo(32);
    expect(s.max).toBeCloseTo(212);
    expect(s.units).toBe('fahrenheit');
    // Zones stay SI: the child converts them with the unit it is handed.
    expect(s.zones).toEqual([zoneWarn]);
  });

  it('clamps a reading above the scale to its maximum', () => {
    feed(ZERO_C + 130, 'celsius');
    expect(shown().value).toBe(100);
    feed(ZERO_C + 130, 'fahrenheit');
    expect(shown().value).toBeCloseTo(212);
  });

  it('clamps a reading below the scale to its minimum', () => {
    feed(ZERO_C - 10, 'celsius');
    expect(shown().value).toBe(0);
  });

  it('parks the needle at the minimum on a null', () => {
    feed(ZERO_C + 21.5, 'fahrenheit');
    feed(null, 'fahrenheit');
    const s = shown();
    expect(s.value).toBeCloseTo(32);
    expect(s.units).toBe('fahrenheit');
  });

  it('holds no value before the first sample', () => {
    const s = shown();
    expect(s.value).toBeNull();
    expect(s).toMatchObject({ min: 0, max: 100, units: '' });
  });

  it('passes a unitless reading through', () => {
    options.set(makeConfig('unitless', -50, 50));
    fixture.detectChanges();
    feed(-12.25, 'unitless');
    expect(shown()).toMatchObject({ value: -12.25, min: -50, max: 50, units: 'unitless' });
  });

  it('hands no zones when zones are ignored', () => {
    options.set({ ...makeConfig('celsius'), ignoreZones: true });
    fixture.detectChanges();
    expect(shown().zones).toEqual([]);
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
