import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetHorizonComponent } from './widget-horizon.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { IPathUpdate } from '../../core/services/data.service';
import type { IPathArray, IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

const DEG = Math.PI / 180;

// The "Show Frame" checkbox binds directly to gauge.noFrameVisible (no inversion),
// so noFrameVisible === true means "draw the frame". Two consumers must stay in
// agreement: buildOptions().frameVisible (the steelseries gauge option) and
// frameVisibleView() (drives the wrapper padding). A regression that negates one
// but not the other inverts the padding relative to the frame.
interface HorizonInternals {
  frameVisibleView: () => boolean;
  buildOptions: (cfg: IWidgetSvcConfig, size: number) => void;
  gaugeOptions: { frameVisible?: boolean };
}

function mount(noFrameVisible: boolean) {
  const options = signal<IWidgetSvcConfig | undefined>({ gauge: { type: 'horizon', noFrameVisible } });
  TestBed.configureTestingModule({
    imports: [WidgetHorizonComponent],
    providers: [
      { provide: WidgetRuntimeDirective, useValue: { options } },
      { provide: WidgetStreamsDirective, useValue: { observe: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(WidgetHorizonComponent);
  fixture.componentRef.setInput('id', 'test-horizon');
  fixture.componentRef.setInput('type', 'widget-horizon');
  fixture.componentRef.setInput('theme', null);
  fixture.detectChanges();
  return fixture.componentInstance as unknown as HorizonInternals;
}

describe('WidgetHorizonComponent frame visibility', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('draws the frame and pads the wrapper when Show Frame is on (noFrameVisible=true)', () => {
    const c = mount(true);
    c.buildOptions({ gauge: { type: 'horizon', noFrameVisible: true } } as IWidgetSvcConfig, 200);
    expect(c.gaugeOptions.frameVisible).toBe(true);
    expect(c.frameVisibleView()).toBe(true);
  });

  it('hides the frame and drops the wrapper padding when Show Frame is off (noFrameVisible=false)', () => {
    const c = mount(false);
    c.buildOptions({ gauge: { type: 'horizon', noFrameVisible: false } } as IWidgetSvcConfig, 200);
    expect(c.gaugeOptions.frameVisible).toBe(false);
    expect(c.frameVisibleView()).toBe(false);
  });
});

describe('WidgetHorizonComponent field pointers', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('observes the whole navigation.attitude leaf and reads its /pitch and /roll fields', () => {
    const calls: { pathName: string; pointer?: string }[] = [];
    const options = signal<IWidgetSvcConfig | undefined>({
      gauge: { type: 'horizon' },
      paths: {
        gaugePitchPath: { path: 'self.navigation.attitude', sampleTime: 1000 },
        gaugeRollPath: { path: 'self.navigation.attitude', sampleTime: 1000 },
      },
    } as unknown as IWidgetSvcConfig);
    TestBed.configureTestingModule({
      imports: [WidgetHorizonComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        {
          provide: WidgetStreamsDirective,
          useValue: {
            observe: (pathName: string, _next: unknown, pointer?: string) => calls.push({ pathName, pointer }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(WidgetHorizonComponent);
    fixture.componentRef.setInput('id', 'test-horizon');
    fixture.componentRef.setInput('type', 'widget-horizon');
    fixture.componentRef.setInput('theme', null);
    fixture.detectChanges();

    expect(calls).toContainEqual({ pathName: 'gaugePitchPath', pointer: '/pitch' });
    expect(calls).toContainEqual({ pathName: 'gaugeRollPath', pointer: '/roll' });
  });
});

/**
 * The pitch and roll the widget hands the steelseries Horizon, which takes degrees, for a set of SI
 * inputs. Pins the output so a change of the unit the widget computes in cannot move the gauge.
 */
describe('WidgetHorizonComponent output from SI inputs', () => {
  let callbacks: Map<string, (u: IPathUpdate) => void>;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let drawn: { pitch?: number; roll?: number };
  let calls: string[];
  let component: { noData: () => boolean };
  let originalHorizon: unknown;

  const steel = (globalThis as unknown as { steelseries: { Horizon?: unknown } }).steelseries;

  /** An SI sample as the streams directive delivers it to this widget, with its presentation measure. */
  const feed = (pathKey: string, rad: number | null): void => {
    const callback = callbacks.get(pathKey);
    if (!callback) throw new Error(`${pathKey} is not observed`);
    callback({ data: { value: rad, timestamp: null, measure: 'deg' }, state: 'normal' } as IPathUpdate);
  };
  const feedDegrees = (pathKey: string, deg: number): void => feed(pathKey, deg * DEG);

  const shown = () => ({
    pitch: drawn.pitch == null ? drawn.pitch : Number(drawn.pitch.toFixed(6)),
    roll: drawn.roll == null ? drawn.roll : Number(drawn.roll.toFixed(6))
  });

  const makeConfig = (invertPitch = false, invertRoll = false): IWidgetSvcConfig => ({
    ...WidgetHorizonComponent.DEFAULT_CONFIG,
    gauge: { ...WidgetHorizonComponent.DEFAULT_CONFIG.gauge, type: 'horizon', invertPitch, invertRoll }
  });

  const render = (): void => {
    TestBed.configureTestingModule({
      imports: [WidgetHorizonComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        {
          provide: WidgetStreamsDirective,
          useValue: { observe: (p: string, n: (u: IPathUpdate) => void) => { callbacks.set(p, n); } }
        }
      ]
    });
    const fixture = TestBed.createComponent(WidgetHorizonComponent);
    fixture.componentRef.setInput('id', 'horizon-si');
    fixture.componentRef.setInput('type', 'widget-horizon');
    fixture.componentRef.setInput('theme', null);
    fixture.detectChanges();
    component = fixture.componentInstance as unknown as { noData: () => boolean };
    // The gauge is built on the first measured size, which jsdom never reports.
    (fixture.componentInstance as unknown as { rebuildGauge: () => void }).rebuildGauge();
  };
  const noData = (): boolean => component.noData();

  beforeEach(() => {
    TestBed.resetTestingModule();
    callbacks = new Map();
    options = signal<IWidgetSvcConfig | undefined>(makeConfig());
    drawn = {};
    calls = [];
    originalHorizon = steel.Horizon;
    steel.Horizon = class {
      setPitchAnimated(value: number) { drawn.pitch = value; calls.push('pitch'); }
      setRollAnimated(value: number) { drawn.roll = value; calls.push('roll'); }
    };
  });

  afterEach(() => { steel.Horizon = originalHorizon; });

  it('draws pitch and roll in degrees', () => {
    render();
    feedDegrees('gaugePitchPath', 4.5);
    feedDegrees('gaugeRollPath', -12);
    expect(shown()).toEqual({ pitch: 4.5, roll: -12 });
  });

  it('draws the inverted angles, re-applying the last reading when the flags change', () => {
    render();
    feedDegrees('gaugePitchPath', 4.5);
    feedDegrees('gaugeRollPath', -12);

    options.set(makeConfig(true, true));
    TestBed.tick();
    expect(shown()).toEqual({ pitch: -4.5, roll: 12 });

    feedDegrees('gaugeRollPath', 3);
    expect(shown()).toEqual({ pitch: -4.5, roll: -3 });
  });

  it('keeps an axis at its last reading when it goes null', () => {
    render();
    feedDegrees('gaugePitchPath', 4.5);
    feedDegrees('gaugeRollPath', -12);
    calls.length = 0;
    feed('gaugePitchPath', null);
    expect(calls).toEqual([]);
    expect(shown()).toEqual({ pitch: 4.5, roll: -12 });
  });

  it('does not move an inverted axis on a null sample', () => {
    options.set(makeConfig(true, false));
    render();
    feedDegrees('gaugePitchPath', 4.5);
    calls.length = 0;
    feed('gaugePitchPath', null);
    expect(calls).toEqual([]);
    expect(shown().pitch).toBe(-4.5);
  });

  it('ignores a non-finite sample', () => {
    render();
    feedDegrees('gaugeRollPath', -12);
    calls.length = 0;
    feed('gaugeRollPath', Number.NaN);
    expect(calls).toEqual([]);
    expect(noData()).toBe(true);
  });
});

/** The NO DATA state: either configured attitude axis without a current reading. */
describe('WidgetHorizonComponent no attitude data', () => {
  let callbacks: Map<string, (u: IPathUpdate) => void>;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let fixture: ComponentFixture<WidgetHorizonComponent>;
  let calls: { axis: 'pitch' | 'roll'; value: number }[];
  let originalHorizon: unknown;

  const steel = (globalThis as unknown as { steelseries: { Horizon?: unknown } }).steelseries;

  const feed = (pathKey: string, rad: number | null): void => {
    const callback = callbacks.get(pathKey);
    if (!callback) throw new Error(`${pathKey} is not observed`);
    callback({ data: { value: rad, timestamp: null, measure: 'deg' }, state: 'normal' } as IPathUpdate);
    fixture.detectChanges();
  };
  const overlay = (): Element | null => fixture.nativeElement.querySelector('.no-data');

  const render = (cfg: IWidgetSvcConfig = WidgetHorizonComponent.DEFAULT_CONFIG): void => {
    options = signal<IWidgetSvcConfig | undefined>(cfg);
    TestBed.configureTestingModule({
      imports: [WidgetHorizonComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        {
          provide: WidgetStreamsDirective,
          useValue: { observe: (p: string, n: (u: IPathUpdate) => void) => { callbacks.set(p, n); } }
        }
      ]
    });
    fixture = TestBed.createComponent(WidgetHorizonComponent);
    fixture.componentRef.setInput('id', 'horizon-nodata');
    fixture.componentRef.setInput('type', 'widget-horizon');
    fixture.componentRef.setInput('theme', null);
    fixture.detectChanges();
    (fixture.componentInstance as unknown as { rebuildGauge: () => void }).rebuildGauge();
    calls.length = 0;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    callbacks = new Map();
    calls = [];
    originalHorizon = steel.Horizon;
    steel.Horizon = class {
      setPitchAnimated(value: number) { calls.push({ axis: 'pitch', value }); }
      setRollAnimated(value: number) { calls.push({ axis: 'roll', value }); }
    };
  });

  afterEach(() => { steel.Horizon = originalHorizon; });

  it('shows NO DATA before any attitude sample arrives', () => {
    render();
    expect(overlay()?.textContent).toContain('NO DATA');
  });

  it('keeps NO DATA while only one axis has reported', () => {
    render();
    feed('gaugePitchPath', 4.5 * DEG);
    expect(overlay()).not.toBeNull();
  });

  it('clears NO DATA once both axes report', () => {
    render();
    feed('gaugePitchPath', 4.5 * DEG);
    feed('gaugeRollPath', -12 * DEG);
    expect(overlay()).toBeNull();
  });

  it('shows NO DATA when pitch goes null, without levelling the gauge', () => {
    render();
    feed('gaugePitchPath', 4.5 * DEG);
    feed('gaugeRollPath', -12 * DEG);
    calls.length = 0;
    feed('gaugePitchPath', null);
    expect(overlay()).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it('shows NO DATA when roll alone goes null while pitch keeps updating', () => {
    render();
    feed('gaugePitchPath', 4.5 * DEG);
    feed('gaugeRollPath', -12 * DEG);
    feed('gaugeRollPath', null);
    calls.length = 0;
    feed('gaugePitchPath', 2 * DEG);
    expect(overlay()).not.toBeNull();
    expect(calls.map(c => ({ axis: c.axis, value: Number(c.value.toFixed(6)) }))).toEqual([{ axis: 'pitch', value: 2 }]);
  });

  it('clears NO DATA and moves the gauge when both axes recover', () => {
    render();
    feed('gaugePitchPath', 4.5 * DEG);
    feed('gaugeRollPath', -12 * DEG);
    feed('gaugePitchPath', null);
    feed('gaugeRollPath', null);
    calls.length = 0;
    feed('gaugePitchPath', 1 * DEG);
    feed('gaugeRollPath', 3 * DEG);
    expect(overlay()).toBeNull();
    expect(calls.map(c => ({ axis: c.axis, value: Number(c.value.toFixed(6)) }))).toEqual([
      { axis: 'pitch', value: 1 },
      { axis: 'roll', value: 3 }
    ]);
  });

  it('does not count an unconfigured roll axis as lost', () => {
    const paths = WidgetHorizonComponent.DEFAULT_CONFIG.paths as IPathArray;
    render({ ...WidgetHorizonComponent.DEFAULT_CONFIG, paths: { gaugePitchPath: paths['gaugePitchPath'] } });
    expect(callbacks.has('gaugeRollPath')).toBe(false);
    expect(overlay()).not.toBeNull();
    feed('gaugePitchPath', 4.5 * DEG);
    expect(overlay()).toBeNull();
  });
});
