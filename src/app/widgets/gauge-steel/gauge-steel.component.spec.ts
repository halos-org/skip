import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GaugeSteelComponent, SteelBackgroundColors, SteelFrameColors } from './gauge-steel.component';
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
  // A rebuild replaces the gauge object, but the library cannot cancel a tween: the discarded
  // instance keeps repainting the same canvas with its stale scale and wins the last frame. So a
  // batch that both changes the value and forces a rebuild must not animate the outgoing gauge --
  // the rebuild's seed paints the value instead. This is the ordinary boot batch, where the
  // server-resolved measure lands together with the value it re-converted.
  it('does not animate a gauge that a rebuild in the same batch is about to discard', () => {
    const seeded: number[] = [];
    const animated: number[] = [];
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Radial = vi.fn(function (this: FakeGauge) {
      this.setValue = (v: number) => { seeded.push(v); };
      this.setValueAnimated = (v: number) => { animated.push(v); };
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-batch');
    fixture.componentRef.setInput('subType', 'radial');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 3600);
    fixture.componentRef.setInput('value', 900);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
    };
    internals.startGauge(true);
    seeded.length = 0;

    fixture.componentRef.setInput('value', 1800);
    fixture.componentRef.setInput('maxValue', 4000);
    internals.ngOnChanges({
      value: new SimpleChange(900, 1800, false),
      maxValue: new SimpleChange(3600, 4000, false),
    });

    expect(animated).toEqual([]);
    expect(seeded).toEqual([1800]);
  });

  // #558: subType, barGauge and decimals are read only when the gauge object is constructed, so
  // editing them in widget options produced no visible effect until some unrelated event -- a
  // window resize, or the server's unit metadata landing -- happened to rebuild the gauge.
  it('rebuilds as the other library type when subType changes', () => {
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Radial = vi.fn(function (this: FakeGauge) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
    });
    steel.Linear = vi.fn(function (this: FakeGauge) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-subtype');
    fixture.componentRef.setInput('subType', 'radial');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 100);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
    };
    internals.startGauge(true);
    expect(steel.Radial).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('subType', 'linear');
    internals.ngOnChanges({ subType: new SimpleChange('radial', 'linear', false) });

    expect(steel.Linear).toHaveBeenCalledTimes(1);
  });

  // The geometry keys are per-class: the radial reads `size`, the linear pair reads `width`/`height`
  // and falls back to the canvas element's dimensions when they are missing — which the outgoing
  // radial had set square. A leftover `size` therefore renders the linear gauge at the tile's
  // shorter side, and no resize follows the flip to correct it.
  it('re-derives the geometry for the new class when subType changes', () => {
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    const linearOptions: Record<string, unknown>[] = [];
    steel.Radial = vi.fn(function (this: FakeGauge) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
    });
    steel.Linear = vi.fn(function (this: FakeGauge, _id: string, opts: Record<string, unknown>) {
      linearOptions.push({ ...opts });
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-geometry');
    fixture.componentRef.setInput('subType', 'radial');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 100);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
      onResized: (e: ResizeObserverEntry) => void;
    };
    internals.onResized({ contentRect: { width: 400, height: 150 } } as ResizeObserverEntry);
    internals.startGauge(true);

    fixture.componentRef.setInput('subType', 'linear');
    internals.ngOnChanges({ subType: new SimpleChange('radial', 'linear', false) });

    expect(linearOptions).toHaveLength(1);
    expect(linearOptions[0]['width']).toBe(400);
    expect(linearOptions[0]['height']).toBe(150);
    expect(linearOptions[0]['size']).toBeUndefined();
  });

  // Zone band colours are resolved from the theme inside buildOptions and baked into the Section
  // objects at construction, so a day/night switch has to rebuild or the bands keep the old colours.
  it('rebuilds when the theme changes', () => {
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Radial = vi.fn(function (this: FakeGauge) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-theme');
    fixture.componentRef.setInput('subType', 'radial');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 100);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
    };
    internals.startGauge(true);
    expect(steel.Radial).toHaveBeenCalledTimes(1);

    internals.ngOnChanges({ theme: new SimpleChange(null, {}, false) });

    expect(steel.Radial).toHaveBeenCalledTimes(2);
  });

  it('rebuilds as a bargraph when the Digital Meter setting is turned on', () => {
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Linear = vi.fn(function (this: FakeGauge) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
    });
    steel.LinearBargraph = vi.fn(function (this: FakeGauge) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-bargauge');
    fixture.componentRef.setInput('subType', 'linear');
    fixture.componentRef.setInput('barGauge', false);
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 100);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
    };
    internals.startGauge(true);
    expect(steel.Linear).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('barGauge', true);
    internals.ngOnChanges({ barGauge: new SimpleChange(false, true, false) });

    expect(steel.LinearBargraph).toHaveBeenCalledTimes(1);
  });

  it('rebuilds with the new LCD precision when decimals changes', () => {
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Linear = vi.fn(function (this: FakeGauge) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-decimals');
    fixture.componentRef.setInput('subType', 'linear');
    fixture.componentRef.setInput('decimals', 2);
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 100);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
      gaugeOptions: { lcdDecimals?: number };
    };
    internals.startGauge(true);
    expect(internals.gaugeOptions.lcdDecimals).toBe(2);

    fixture.componentRef.setInput('decimals', 0);
    internals.ngOnChanges({ decimals: new SimpleChange(2, 0, false) });

    expect(internals.gaugeOptions.lcdDecimals).toBe(0);
    expect(steel.Linear).toHaveBeenCalledTimes(2);
  });

  // A rebuild constructs the replacement from buildOptions, which re-reads the title, background and
  // frame inputs. Calling their setters as well would target whichever gauge object happened to exist
  // at that point in the batch -- the one the rebuild discards -- so the batch carries them through
  // the rebuild instead.
  it('carries a title change batched with a rebuild into the replacement gauge', () => {
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    const titleSetter = vi.fn();
    steel.Linear = vi.fn(function (this: FakeGauge & { setTitleString: (t: string) => void }) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
      this.setTitleString = titleSetter;
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-title-batch');
    fixture.componentRef.setInput('subType', 'linear');
    fixture.componentRef.setInput('title', 'Old');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 100);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
      gaugeOptions: { titleString?: string };
    };
    internals.startGauge(true);

    fixture.componentRef.setInput('title', 'New');
    fixture.componentRef.setInput('maxValue', 200);
    internals.ngOnChanges({
      title: new SimpleChange('Old', 'New', false),
      maxValue: new SimpleChange(100, 200, false),
    });

    expect(internals.gaugeOptions.titleString).toBe('New');
    expect(titleSetter).not.toHaveBeenCalled();
  });

  // The batch runs ONE rebuild: buildOptions re-reads every input, so a second would repeat the work
  // on inputs the first already carried -- and the library cannot cancel the discarded gauge's tween,
  // so it keeps repainting the canvas with its stale scale and wins the last frame.
  it('rebuilds once for a batch carrying several structural changes', () => {
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Section = vi.fn((lower: number, upper: number, color: string) => ({ lower, upper, color }));
    steel.Linear = vi.fn(function (this: FakeGauge) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-one-rebuild');
    fixture.componentRef.setInput('subType', 'linear');
    fixture.componentRef.setInput('units', 'V');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 100);
    fixture.componentRef.setInput('decimals', 2);
    fixture.componentRef.setInput('zones', []);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
    };
    internals.startGauge(true);
    expect(steel.Linear).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('maxValue', 200);
    fixture.componentRef.setInput('decimals', 0);
    fixture.componentRef.setInput('zones', [{ upper: 50, state: States.Alarm }]);
    internals.ngOnChanges({
      maxValue: new SimpleChange(100, 200, false),
      decimals: new SimpleChange(2, 0, false),
      zones: new SimpleChange([], [{ upper: 50, state: States.Alarm }], false),
    });

    expect(steel.Linear).toHaveBeenCalledTimes(2);
  });

  // The setters run only on a batch with no structural change; buildOptions carries these inputs
  // through a rebuild. Both halves need pinning -- deleting the setters is otherwise invisible.
  it('applies a standalone title, background and frame change through the live setters', () => {
    const calls: string[] = [];
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Radial = vi.fn(function (this: FakeGauge & Record<string, unknown>) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
      this.setTitleString = () => { calls.push('title'); };
      this.setBackgroundColor = () => { calls.push('background'); };
      this.setFrameDesign = () => { calls.push('frame'); };
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-live-setters');
    fixture.componentRef.setInput('subType', 'radial');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 100);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
    };
    internals.startGauge(true);

    internals.ngOnChanges({ title: new SimpleChange('Old', 'New', false) });
    internals.ngOnChanges({ backgroundColor: new SimpleChange('carbon', 'white', false) });
    internals.ngOnChanges({ frameColor: new SimpleChange('anthracite', 'brass', false) });

    expect(calls).toEqual(['title', 'background', 'frame']);
    // No rebuild: none of these is structural.
    expect(steel.Radial).toHaveBeenCalledTimes(1);
  });

  it('carries the background and frame through a rebuild, without calling their setters', () => {
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    const bgSetter = vi.fn();
    const frameSetter = vi.fn();
    steel.Linear = vi.fn(function (this: FakeGauge & Record<string, unknown>) {
      this.setValue = vi.fn();
      this.setValueAnimated = vi.fn();
      this.setBackgroundColor = bgSetter;
      this.setFrameDesign = frameSetter;
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-carry-colors');
    fixture.componentRef.setInput('subType', 'linear');
    fixture.componentRef.setInput('backgroundColor', 'carbon');
    fixture.componentRef.setInput('frameColor', 'anthracite');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 100);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
      gaugeOptions: { backgroundColor?: string; frameDesign?: string };
    };
    internals.startGauge(true);

    fixture.componentRef.setInput('backgroundColor', 'white');
    fixture.componentRef.setInput('frameColor', 'brass');
    fixture.componentRef.setInput('maxValue', 200);
    internals.ngOnChanges({
      backgroundColor: new SimpleChange('carbon', 'white', false),
      frameColor: new SimpleChange('anthracite', 'brass', false),
      maxValue: new SimpleChange(100, 200, false),
    });

    expect(internals.gaugeOptions.backgroundColor).toBe(SteelBackgroundColors['white']);
    expect(internals.gaugeOptions.frameDesign).toBe(SteelFrameColors['brass']);
    expect(bgSetter).not.toHaveBeenCalled();
    expect(frameSetter).not.toHaveBeenCalled();
  });

  it('still animates a value change that stands alone', () => {
    const animated: number[] = [];
    const steel = (globalThis as unknown as { steelseries: Record<string, unknown> }).steelseries;
    steel.Radial = vi.fn(function (this: FakeGauge) {
      this.setValue = vi.fn();
      this.setValueAnimated = (v: number) => { animated.push(v); };
    });

    fixture.componentRef.setInput('widgetUUID', 'uuid-solo');
    fixture.componentRef.setInput('subType', 'radial');
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 3600);
    fixture.componentRef.setInput('value', 900);

    const internals = component as unknown as {
      startGauge: (f?: boolean) => void;
      ngOnChanges: (c: Record<string, SimpleChange>) => void;
    };
    internals.startGauge(true);

    fixture.componentRef.setInput('value', 1800);
    internals.ngOnChanges({ value: new SimpleChange(900, 1800, false) });

    expect(animated).toEqual([1800]);
  });
});
