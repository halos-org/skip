import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GaugeSteelComponent } from './gauge-steel.component';
import { UnitsService } from '../../core/services/units.service';
import { States } from '../../core/interfaces/signalk-interfaces';

describe('GaugeSteelComponent', () => {
  let component: GaugeSteelComponent;
  let fixture: ComponentFixture<GaugeSteelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GaugeSteelComponent],
      providers: [
        {
          provide: UnitsService,
          useValue: {
            convertToUnit: (_unit: string, value: number) => value,
            getUnitDisplaySymbol: (unit: string) => unit,
          },
        },
      ],
    })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(GaugeSteelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  it('renders an open-ended low-alarm zone as a band clamped to the gauge minimum', () => {
    const sectionSpy = vi.fn((lower: number, upper: number, color: string) => ({ lower, upper, color }));
    (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries.Section = sectionSpy;

    fixture.componentRef.setInput('minValue', 10);
    fixture.componentRef.setInput('maxValue', 15);
    fixture.componentRef.setInput('units', 'V');
    fixture.componentRef.setInput('themeColors', { zoneAlarm: 'red' });
    // Low alarm with no lower bound — "alarm below 11.5", the common open-ended zone.
    fixture.componentRef.setInput('zones', [{ upper: 11.5, state: States.Alarm }]);

    (component as unknown as { buildOptions: () => void }).buildOptions();

    // The unset lower bound clamps to the gauge minimum (10) instead of producing a
    // NaN section that does not draw; the upper is converted (identity mock -> 11.5).
    expect(sectionSpy).toHaveBeenCalledWith(10, 11.5, 'red');
  });

  it('clears the pending resize timer on destroy so the debounced rebuild cannot fire afterwards', () => {
    vi.useFakeTimers();
    try {
      fixture.componentRef.setInput('subType', 'radial');
      fixture.detectChanges();
      const internals = component as unknown as { onResized: (e: ResizeObserverEntry) => void; startGauge: (f?: boolean) => void; resizeTimer: number | null };
      const rebuild = vi.spyOn(internals, 'startGauge').mockImplementation(() => { /* no-op */ });

      // A real resize arms the 120ms debounce.
      internals.onResized({ contentRect: { width: 120, height: 120 } } as ResizeObserverEntry);
      expect(internals.resizeTimer).not.toBeNull();

      component.ngOnDestroy();
      expect(internals.resizeTimer).toBeNull();

      vi.advanceTimersByTime(200);
      expect(rebuild).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds zone sections on a min/max change after boot, re-clamping bands to the new scale', () => {
    const sectionSpy = vi.fn((lower: number, upper: number, color: string) => ({ lower, upper, color }));
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Section = sectionSpy;
    steel.Linear = vi.fn();

    fixture.componentRef.setInput('widgetUUID', 'uuid-minmax');
    fixture.componentRef.setInput('subType', 'linear');
    fixture.componentRef.setInput('minValue', 10);
    fixture.componentRef.setInput('maxValue', 15);
    fixture.componentRef.setInput('units', 'V');
    fixture.componentRef.setInput('themeColors', { zoneAlarm: 'red' });
    // Open-ended low alarm: its band's lower bound IS the gauge minimum, so it must track a min change.
    fixture.componentRef.setInput('zones', [{ upper: 11.5, state: States.Alarm }]);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
      gaugeOptions: { section?: unknown };
    };

    // Boot the gauge; ngOnChanges is inert until the gauge has started.
    internals.startGauge(true);
    expect(internals.gaugeOptions.section).toEqual([{ lower: 10, upper: 11.5, color: 'red' }]);

    const startSpy = vi.spyOn(internals, 'startGauge');
    fixture.componentRef.setInput('minValue', 11);
    internals.ngOnChanges({ minValue: new SimpleChange(10, 11, false) });

    // The min change forces a structural rebuild (not just a silent axis update), and the band is
    // re-clamped to the new minimum instead of staying at the boot-time value.
    expect(startSpy).toHaveBeenCalledWith(true);
    expect(internals.gaugeOptions.section).toEqual([{ lower: 11, upper: 11.5, color: 'red' }]);
  });

  it('rebuilds bands in the resolved unit when units self-corrects from boot-empty to the first real measure', () => {
    const sectionSpy = vi.fn((lower: number, upper: number, color: string) => ({ lower, upper, color }));
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Section = sectionSpy;
    steel.Linear = vi.fn();

    const svc = (component as unknown as { unitsService: { convertToUnit: (u: string, v: number) => number } }).unitsService;
    // Emulate a real unit conversion (mV -> V); the boot-empty '' unit stays identity.
    vi.spyOn(svc, 'convertToUnit').mockImplementation((unit, value) => (unit === 'V' ? value / 1000 : value));

    fixture.componentRef.setInput('widgetUUID', 'uuid-units');
    fixture.componentRef.setInput('subType', 'linear');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 20);
    fixture.componentRef.setInput('themeColors', { zoneAlarm: 'red' });
    fixture.componentRef.setInput('zones', [{ lower: 11500, upper: 12500, state: States.Alarm }]);
    // Boot before the server measure resolves: units is still ''.
    fixture.componentRef.setInput('units', '');

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
      gaugeOptions: { section?: unknown };
    };

    internals.startGauge(true);
    // In raw units the band sits above the 0..20 gauge and is dropped — no section drawn.
    expect(internals.gaugeOptions.section).toEqual([]);

    fixture.componentRef.setInput('units', 'V');
    internals.ngOnChanges({ units: new SimpleChange('', 'V', false) });

    // Once units resolves, the sections rebuild in the new unit and the band reappears in range,
    // rather than staying collapsed/off-scale from the boot-time '' unit.
    expect(internals.gaugeOptions.section).toEqual([{ lower: 11.5, upper: 12.5, color: 'red' }]);
  });
  // #556: the gauge only ever learns a value through ngOnChanges, which drops every change that
  // lands before the canvas exists (and the first change always). A path a previously-visited page
  // already subscribed emits on subscribe -- before the canvas is built -- so with a constant
  // reading no further change ever arrives and the needle stayed at zero for good.
  interface FakeGauge { setValue: (v: number) => void; setValueAnimated: (v: number) => void }

  const stubRadial = (seeded: number[]): void => {
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Radial = vi.fn(function (this: FakeGauge) {
      this.setValue = (v: number) => { seeded.push(v); };
      this.setValueAnimated = vi.fn();
    });
  };

  it('seeds a freshly built gauge with the value it already holds', () => {
    const seeded: number[] = [];
    stubRadial(seeded);

    fixture.componentRef.setInput('widgetUUID', 'uuid-warm-path');
    fixture.componentRef.setInput('subType', 'radial');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 3600);
    // The value arrives before the gauge is built, which is the whole point.
    fixture.componentRef.setInput('value', 1800);

    (component as unknown as { startGauge: (f?: boolean) => void }).startGauge(true);

    expect(seeded).toEqual([1800]);
  });

  it('re-seeds the value on a rebuild, so a resize or zone change does not blank the needle', () => {
    const seeded: number[] = [];
    stubRadial(seeded);

    fixture.componentRef.setInput('widgetUUID', 'uuid-rebuild');
    fixture.componentRef.setInput('subType', 'radial');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 3600);
    fixture.componentRef.setInput('value', 1800);

    const internals = component as unknown as { startGauge: (f?: boolean) => void };
    internals.startGauge(true);
    internals.startGauge(true); // a resize or zone rebuild replaces the gauge object

    expect(seeded).toEqual([1800, 1800]);
  });

  it('leaves a gauge unseeded when no value has arrived yet', () => {
    const seeded: number[] = [];
    stubRadial(seeded);

    fixture.componentRef.setInput('widgetUUID', 'uuid-no-value');
    fixture.componentRef.setInput('subType', 'radial');

    (component as unknown as { startGauge: (f?: boolean) => void }).startGauge(true);

    expect(seeded).toEqual([]);
  });
});
