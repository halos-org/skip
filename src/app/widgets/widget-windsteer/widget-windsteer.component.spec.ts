import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { WidgetWindComponent, computeTrueWindBaseAngle } from './widget-windsteer.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { UnitsService } from '../../core/services/units.service';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

const unitsServiceStub = { getUnitDisplaySymbol: (measure: string | null | undefined) => measure ?? '' };

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
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
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

/**
 * Wind sectors and layline gating are driven by TRUE wind, not apparent wind.
 * The sector history must be fed only from the true-wind stream, and trueWindActive
 * must track whether the configured true-wind path is currently delivering a value.
 */
describe('WidgetWindComponent true-wind sector source', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const makeConfig = (): IWidgetSvcConfig => ({
    ...WidgetWindComponent.DEFAULT_CONFIG,
    compassModeEnabled: true,
    windSectorEnable: true
  });
  const update = (value: number | null): IPathUpdate => ({ data: { value, timestamp: null }, state: 'normal' });
  const sampleCount = (): number => (component as unknown as { windSamples: unknown[] }).windSamples.length;
  const active = (): boolean => (component as unknown as { trueWindActive: () => boolean }).trueWindActive();

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>(makeConfig());
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick();
  });

  it('feeds the sector history from true wind and not from apparent wind', () => {
    callbacks.get('appWindAngle')!(update(30));
    expect(sampleCount()).toBe(0); // apparent wind no longer feeds the sector history

    callbacks.get('trueWindAngle')!(update(40));
    expect(sampleCount()).toBe(1); // true wind does
  });

  it('tracks true-wind availability in trueWindActive', () => {
    expect(active()).toBe(false); // nothing received yet
    callbacks.get('trueWindAngle')!(update(40));
    expect(active()).toBe(true);
    callbacks.get('trueWindAngle')!(update(null));
    expect(active()).toBe(false); // explicit null -> laylines hide
  });
});

/**
 * The apparent/true wind speed readouts are DISPLAY paths: the streams directive tags each
 * numeric update with the server-resolved measure the value was converted to. The unit symbol
 * must derive from that tagged measure, not from the stored convertUnitTo ('knots'), so the
 * label always matches the value's actual unit and neutrals out until data arrives.
 */
describe('WidgetWindComponent speed unit symbol source', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const makeConfig = (): IWidgetSvcConfig => ({ ...WidgetWindComponent.DEFAULT_CONFIG });
  const speedUpdate = (value: number, measure?: string): IPathUpdate =>
    ({ data: { value, timestamp: null, measure }, state: 'normal' });
  const awsUnit = (): string => (component as unknown as { appWindSpeedUnit: () => string }).appWindSpeedUnit();
  const twsUnit = (): string => (component as unknown as { trueWindSpeedUnit: () => string }).trueWindSpeedUnit();

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>(makeConfig());
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick();
  });

  it('renders a neutral label before any update (boot placeholder)', () => {
    expect(awsUnit()).toBe('');
    expect(twsUnit()).toBe('');
  });

  it('derives each speed unit symbol from the update measure, not the stored convertUnitTo', () => {
    // both paths store convertUnitTo: 'knots' but the server-resolved measure differs
    callbacks.get('appWindSpeed')!(speedUpdate(10, 'm/s'));
    callbacks.get('trueWindSpeed')!(speedUpdate(8, 'kph'));
    expect(awsUnit()).toBe('m/s');
    expect(twsUnit()).toBe('kph');
  });

  it('keeps a neutral label when an update carries no measure', () => {
    callbacks.get('appWindSpeed')!(speedUpdate(10));
    expect(awsUnit()).toBe('');
  });

  it('keeps a neutral label while the measure is still unitless (meta unresolved)', () => {
    callbacks.get('appWindSpeed')!(speedUpdate(10, 'unitless'));
    expect(awsUnit()).toBe('');
  });
});
