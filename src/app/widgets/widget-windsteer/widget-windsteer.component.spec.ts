import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { WidgetWindComponent, computeTrueWindBaseAngle } from './widget-windsteer.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

/**
 * Regression tests for #1066 / #1063.
 *
 * In "simple" mode (enhanced/advanced compass mode OFF) the wind rose is bow-fixed, so the
 * True Wind ANGLE (boat-relative angleTrueWater / angleTrueGround) must be shown as-is, exactly
 * like Apparent Wind Angle. The previous code always added the boat heading to true wind,
 * turning it into a compass-frame direction, which displaced TWA by the heading (~90° in the
 * reports) only in simple mode. Enhanced mode rotates the dial by heading, so the offset is
 * correct there and must be preserved.
 */
describe('computeTrueWindBaseAngle (#1066, #1063)', () => {
  const TRUE_WATER = 'self.environment.wind.angleTrueWater';
  const TRUE_GROUND = 'self.environment.wind.angleTrueGround';
  const DIRECTION_TRUE = 'self.environment.wind.directionTrue';

  it('keeps boat-relative true wind angle unchanged in simple mode (compass mode off)', () => {
    // heading 90°, boat-relative TWA 45° -> must stay 45° in simple mode (NOT 135°)
    expect(computeTrueWindBaseAngle(TRUE_WATER, 45, 90, false)).toBe(45);
    expect(computeTrueWindBaseAngle(TRUE_GROUND, 45, 90, false)).toBe(45);
  });

  it('converts true wind angle to the compass frame (adds heading) in enhanced/compass mode', () => {
    expect(computeTrueWindBaseAngle(TRUE_WATER, 45, 90, true)).toBe(135);
  });

  it('wraps the compass-frame result into 0..359 in enhanced/compass mode', () => {
    expect(computeTrueWindBaseAngle(TRUE_WATER, 300, 90, true)).toBe(30); // 390 -> 30
  });

  it('passes through non boat-relative true wind paths (e.g. directionTrue) in both modes', () => {
    expect(computeTrueWindBaseAngle(DIRECTION_TRUE, 200, 90, false)).toBe(200);
    expect(computeTrueWindBaseAngle(DIRECTION_TRUE, 200, 90, true)).toBe(200);
  });
});

/**
 * Regression test for #73.
 *
 * Toggling compass mode live must recompute the displayed TWA base immediately from the last
 * received sample. The wind stream does not re-emit on an options change, so before the fix the
 * dial kept the previous base and showed a one-frame heading-offset transient until the next
 * sample arrived.
 */
describe('WidgetWindComponent live compass-mode toggle (#73)', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const makeConfig = (compassModeEnabled: boolean): IWidgetSvcConfig => ({
    ...WidgetWindComponent.DEFAULT_CONFIG,
    compassModeEnabled,
    windSectorEnable: false
  });

  const update = (value: number): IPathUpdate => ({ data: { value, timestamp: null }, state: 'normal' });

  const twa = (): number => (component as unknown as { trueWindAngle: () => number }).trueWindAngle();

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>(makeConfig(false));
    callbacks = new Map<string, (u: IPathUpdate) => void>();

    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock }
      ]
    });

    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick(); // flush the options effect so streams register and callbacks are captured
  });

  it('recomputes the TWA base on a live compass-mode toggle without a new wind sample', () => {
    callbacks.get('headingPath')!(update(90));
    callbacks.get('trueWindAngle')!(update(45));
    expect(twa()).toBe(45); // simple mode: boat-relative angle shown as-is

    options.set(makeConfig(true));
    TestBed.tick();

    expect(twa()).toBe(135); // compass mode: heading (90) added to the cached angle (45)
  });
});
