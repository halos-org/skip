import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SvgAutopilotComponent } from './svg-autopilot.component';

/**
 * The AP screen is a steering display: a reading that stops arriving has to read as absent rather
 * than hold its last value, because a frozen dial and a live one look identical.
 */
describe('SvgAutopilotComponent', () => {
  let fixture: ComponentFixture<SvgAutopilotComponent>;

  interface Internals {
    compassAngle: () => number | null;
    apModeValue: () => string;
  }

  const set = (inputs: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(inputs)) {
      (fixture.componentRef.setInput.bind(fixture.componentRef) as (k: string, v: unknown) => void)(key, value);
    }
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SvgAutopilotComponent] }).compileComponents();
    fixture = TestBed.createComponent(SvgAutopilotComponent);
    set({
      apMode: 'auto',
      updateInterval: 500,
      targetPilotHeadingTrue: false,
      autopilotTarget: null,
      courseXte: 0,
      compassHeading: null,
      headingDirectionTrue: false,
      appWindAngle: null,
      rudderAngle: null
    });
  });

  const internals = () => fixture.componentInstance as unknown as Internals;

  it('reports no heading before one has arrived', () => {
    expect(internals().compassAngle()).toBeNull();
  });

  it('returns the heading readout to absent when the source drops out', () => {
    set({ compassHeading: 142 });
    expect(internals().compassAngle()).toBe(142);

    set({ compassHeading: null });
    expect(internals().compassAngle()).toBeNull();
  });

  it('places the next heading after a dropout without sweeping from the stale angle', () => {
    set({ compassHeading: 142 });
    set({ compassHeading: null });
    set({ compassHeading: 10 });

    expect(internals().compassAngle()).toBe(10);
  });

  it('shows a placeholder rather than a dead-ahead 0 for a missing wind-hold angle', () => {
    set({ apMode: 'wind', appWindAngle: null });
    expect(internals().apModeValue()).toBe('--');

    set({ appWindAngle: 35 });
    expect(internals().apModeValue()).toBe('35°');
  });
});
