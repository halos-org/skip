import { ComponentFixture, TestBed } from '@angular/core/testing';
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
});
