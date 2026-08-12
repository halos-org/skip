import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { WidgetGaugeNgCompassComponent } from './widget-gauge-ng-compass.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { UnitsService } from '../../core/services/units.service';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig, IPathArray } from '../../core/interfaces/widgets-interface';

/**
 * A compass with no heading must still show its rose, with no needle and a '--' readout — a needle
 * parked on north is indistinguishable from a real heading of 000.
 *
 * Harness follows the radial gauge spec: the host directives are faked and the
 * @godind/ng-canvas-gauges lib is aliased to a no-op shim in the test build, so the gauge element
 * renders as a bare canvas and the component's guarded update() calls are no-ops.
 */
describe('WidgetGaugeNgCompassComponent no-data state', () => {
  let fixture: ComponentFixture<WidgetGaugeNgCompassComponent>;
  let internals: CompassInternals;
  let capturedNext: ((u: IPathUpdate) => void) | undefined;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;

  interface CompassInternals {
    value: () => number | null | undefined;
    textValue: () => string;
    dataAvailable: () => boolean;
    optionsReady: () => boolean;
    gaugeOptions: { needle?: boolean };
  }

  const makeConfig = (path = 'self.navigation.headingTrue'): IWidgetSvcConfig => {
    const dflt = WidgetGaugeNgCompassComponent.DEFAULT_CONFIG;
    const gaugePath = (dflt.paths as IPathArray)['gaugePath'];
    return {
      ...dflt,
      paths: { gaugePath: { ...gaugePath, path } }
    };
  };

  const update = (value: unknown): IPathUpdate =>
    ({ data: { value, timestamp: null }, state: 'normal' }) as unknown as IPathUpdate;

  beforeEach(async () => {
    capturedNext = undefined;
    options = signal<IWidgetSvcConfig | undefined>(makeConfig());
    const streamsFake = {
      observe(_pathName: string, next: (u: IPathUpdate) => void) { capturedNext = next; }
    };
    const unitsFake = {
      getUnitDisplaySymbol: (measure: string | null | undefined): string => measure ?? '',
      convertBetweenMeasures: (_from: string, _to: string, value: number): number => value
    };

    await TestBed.configureTestingModule({
      imports: [WidgetGaugeNgCompassComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsFake },
        { provide: UnitsService, useValue: unitsFake }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetGaugeNgCompassComponent);
    fixture.componentRef.setInput('id', 'compass-1');
    fixture.componentRef.setInput('type', 'widget-gauge-ng-compass');
    fixture.componentRef.setInput('theme', {
      contrast: 'rgba(255,255,255,1)', contrastDim: 'rgba(200,200,200,1)',
      contrastDimmer: 'rgba(150,150,150,1)', cardColor: 'rgba(17,17,17,1)',
      background: 'rgba(0,0,0,1)', zoneAlarm: 'rgba(255,0,0,1)',
      zoneWarn: 'rgba(255,170,0,1)', zoneAlert: 'rgba(255,0,255,1)',
      zoneEmergency: 'rgba(255,0,0,1)'
    });
    fixture.detectChanges();
    internals = fixture.componentInstance as unknown as CompassInternals;
  });

  it('renders the rose before any heading arrives, with no needle', () => {
    expect(internals.optionsReady()).toBe(true);
    expect(fixture.nativeElement.querySelector('radial-gauge')).not.toBeNull();
    expect(internals.dataAvailable()).toBe(false);
    expect(internals.gaugeOptions.needle).toBe(false);
    expect(internals.textValue()).toBe('--');
  });

  it('shows the needle and the heading once one arrives', () => {
    capturedNext?.(update(142));
    expect(internals.dataAvailable()).toBe(true);
    expect(internals.value()).toBe(142);
    expect(internals.textValue()).toBe('142');
  });

  it('returns to the placeholder when the heading stops arriving', () => {
    capturedNext?.(update(142));
    capturedNext?.(update(null));
    expect(internals.dataAvailable()).toBe(false);
    expect(internals.textValue()).toBe('--');
  });

  // #534: a rebuilt subscription against a silent path replays nothing (the leading null is
  // suppressed), so the callback never runs and the previous heading stayed on the rose.
  it('clears the heading when re-pointed at a path that reports nothing', () => {
    capturedNext?.(update(142));
    expect(internals.dataAvailable()).toBe(true);

    options.set(makeConfig('self.navigation.headingMagnetic'));
    fixture.detectChanges();

    expect(internals.dataAvailable()).toBe(false);
    expect(internals.value()).toBeUndefined();
    expect(internals.textValue()).toBe('--');
  });

  // The same effect re-runs on a theme change, so an unconditional clear would blink the needle
  // off and back on at every switch.
  it('keeps the heading when the config changes without changing the path', () => {
    capturedNext?.(update(142));

    fixture.componentRef.setInput('theme', {
      contrast: 'rgba(0,0,0,1)', contrastDim: 'rgba(60,60,60,1)',
      contrastDimmer: 'rgba(120,120,120,1)', cardColor: 'rgba(238,238,238,1)',
      background: 'rgba(255,255,255,1)', zoneAlarm: 'rgba(255,0,0,1)',
      zoneWarn: 'rgba(255,170,0,1)', zoneAlert: 'rgba(255,0,255,1)',
      zoneEmergency: 'rgba(255,0,0,1)'
    });
    fixture.detectChanges();

    expect(internals.dataAvailable()).toBe(true);
    expect(internals.value()).toBe(142);
    expect(internals.textValue()).toBe('142');
  });
});
