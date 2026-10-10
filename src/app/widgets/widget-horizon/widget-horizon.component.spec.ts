import { signal } from '@angular/core';
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

type Axis = 'pitch' | 'roll';

/** Mounts the widget against fake streams; `useHorizonHarness` gives each test a fresh one. */
class HorizonHarness {
  readonly callbacks = new Map<string, (u: IPathUpdate) => void>();
  /** Every setter call the recording gauge received, in degrees. */
  readonly calls: { axis: Axis; value: number }[] = [];
  readonly options = signal<IWidgetSvcConfig | undefined>(WidgetHorizonComponent.DEFAULT_CONFIG);
  fixture!: ComponentFixture<WidgetHorizonComponent>;

  /** `build` stands in for the first measured size, which jsdom never reports. */
  render(cfg: IWidgetSvcConfig = WidgetHorizonComponent.DEFAULT_CONFIG, build = true): void {
    this.options.set(cfg);
    TestBed.configureTestingModule({
      imports: [WidgetHorizonComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options: this.options } },
        {
          provide: WidgetStreamsDirective,
          useValue: { observe: (p: string, n: (u: IPathUpdate) => void) => { this.callbacks.set(p, n); } }
        }
      ]
    });
    this.fixture = TestBed.createComponent(WidgetHorizonComponent);
    this.fixture.componentRef.setInput('id', 'horizon-test');
    this.fixture.componentRef.setInput('type', 'widget-horizon');
    this.fixture.componentRef.setInput('theme', null);
    this.fixture.detectChanges();
    if (build) this.rebuildGauge();
  }

  rebuildGauge(): void {
    (this.fixture.componentInstance as unknown as { rebuildGauge: () => void }).rebuildGauge();
    this.fixture.detectChanges();
  }

  /** An SI sample as the streams directive delivers it to this widget, with its presentation measure. */
  feed(pathKey: string, rad: number | null): void {
    const callback = this.callbacks.get(pathKey);
    if (!callback) throw new Error(`${pathKey} is not observed`);
    callback({ data: { value: rad, timestamp: null, measure: 'deg' }, state: 'normal' } as IPathUpdate);
    this.fixture.detectChanges();
  }

  feedDegrees(pathKey: string, deg: number): void {
    this.feed(pathKey, deg * DEG);
  }

  feedBoth(pitchDeg: number, rollDeg: number): void {
    this.feedDegrees('gaugePitchPath', pitchDeg);
    this.feedDegrees('gaugeRollPath', rollDeg);
  }

  /** The calls so far, rounded so degree conversions compare exactly. */
  rounded(): { axis: Axis; value: number }[] {
    return this.calls.map(c => ({ axis: c.axis, value: Number(c.value.toFixed(6)) }));
  }

  /** The angle each axis was last set to. */
  shown(): { pitch?: number; roll?: number } {
    const last = (axis: Axis) => this.rounded().filter(c => c.axis === axis).at(-1)?.value;
    return { pitch: last('pitch'), roll: last('roll') };
  }

  noData(): boolean {
    return (this.fixture.componentInstance as unknown as { noData: () => boolean }).noData();
  }

  overlay(): Element | null {
    return this.fixture.nativeElement.querySelector('.no-data');
  }
}

/** Registers the per-test harness and swaps a recording steelseries Horizon in around each test. */
function useHorizonHarness(): () => HorizonHarness {
  const steel = (globalThis as unknown as { steelseries: { Horizon?: unknown } }).steelseries;
  let harness: HorizonHarness;
  let originalHorizon: unknown;
  beforeEach(() => {
    TestBed.resetTestingModule();
    const h = new HorizonHarness();
    harness = h;
    originalHorizon = steel.Horizon;
    steel.Horizon = class {
      setPitchAnimated(value: number) { h.calls.push({ axis: 'pitch', value }); }
      setRollAnimated(value: number) { h.calls.push({ axis: 'roll', value }); }
    };
  });
  afterEach(() => { steel.Horizon = originalHorizon; });
  return () => harness;
}

const configWith = (invertPitch = false, invertRoll = false): IWidgetSvcConfig => ({
  ...WidgetHorizonComponent.DEFAULT_CONFIG,
  gauge: { ...WidgetHorizonComponent.DEFAULT_CONFIG.gauge, type: 'horizon', invertPitch, invertRoll }
});

/**
 * The pitch and roll the widget hands the steelseries Horizon, which takes degrees, for a set of SI
 * inputs. Pins the output so a change of the unit the widget computes in cannot move the gauge.
 */
describe('WidgetHorizonComponent output from SI inputs', () => {
  const h = useHorizonHarness();

  it('draws pitch and roll in degrees', () => {
    h().render();
    h().feedDegrees('gaugePitchPath', 4.5);
    h().feedDegrees('gaugeRollPath', -12);
    expect(h().shown()).toEqual({ pitch: 4.5, roll: -12 });
  });

  it('draws the inverted angles, re-applying the last reading when the flags change', () => {
    h().render();
    h().feedDegrees('gaugePitchPath', 4.5);
    h().feedDegrees('gaugeRollPath', -12);

    h().options.set(configWith(true, true));
    TestBed.tick();
    expect(h().shown()).toEqual({ pitch: -4.5, roll: 12 });

    h().feedDegrees('gaugeRollPath', 3);
    expect(h().shown()).toEqual({ pitch: -4.5, roll: -3 });
  });

  it('keeps an axis at its last reading when it goes null', () => {
    h().render();
    h().feedDegrees('gaugePitchPath', 4.5);
    h().feedDegrees('gaugeRollPath', -12);
    const before = h().calls.length;
    h().feed('gaugePitchPath', null);
    expect(h().calls.length).toBe(before);
    expect(h().shown()).toEqual({ pitch: 4.5, roll: -12 });
  });

  it('does not move an inverted axis on a null sample', () => {
    h().render(configWith(true, false));
    h().feedDegrees('gaugePitchPath', 4.5);
    const before = h().calls.length;
    h().feed('gaugePitchPath', null);
    expect(h().calls.length).toBe(before);
    expect(h().shown().pitch).toBe(-4.5);
  });

  it('ignores a non-finite sample', () => {
    h().render();
    h().feedBoth(4.5, -12);
    expect(h().noData()).toBe(false);
    h().calls.length = 0;
    h().feed('gaugeRollPath', Number.NaN);
    expect(h().calls).toEqual([]);
    expect(h().noData()).toBe(true);
  });
});

/** The NO DATA state: either configured attitude axis without a current reading. */
describe('WidgetHorizonComponent no attitude data', () => {
  const h = useHorizonHarness();

  it('shows NO DATA before any attitude sample arrives', () => {
    h().render();
    expect(h().overlay()?.textContent).toContain('NO DATA');
  });

  it('keeps NO DATA while only one axis has reported', () => {
    h().render();
    h().feedDegrees('gaugePitchPath', 4.5);
    expect(h().overlay()).not.toBeNull();
  });

  it('clears NO DATA once both axes report', () => {
    h().render();
    h().feedBoth(4.5, -12);
    expect(h().overlay()).toBeNull();
  });

  it('shows NO DATA when pitch goes null, without levelling the gauge', () => {
    h().render();
    h().feedBoth(4.5, -12);
    h().calls.length = 0;
    h().feed('gaugePitchPath', null);
    expect(h().overlay()).not.toBeNull();
    expect(h().calls).toEqual([]);
  });

  it('shows NO DATA when roll alone goes null while pitch keeps updating', () => {
    h().render();
    h().feedBoth(4.5, -12);
    h().feed('gaugeRollPath', null);
    h().calls.length = 0;
    h().feedDegrees('gaugePitchPath', 2);
    expect(h().overlay()).not.toBeNull();
    expect(h().rounded()).toEqual([{ axis: 'pitch', value: 2 }]);
  });

  it('clears NO DATA and moves the gauge when both axes recover', () => {
    h().render();
    h().feedBoth(4.5, -12);
    h().feed('gaugePitchPath', null);
    h().feed('gaugeRollPath', null);
    h().calls.length = 0;
    h().feedBoth(1, 3);
    expect(h().overlay()).toBeNull();
    expect(h().rounded()).toEqual([
      { axis: 'pitch', value: 1 },
      { axis: 'roll', value: 3 }
    ]);
  });

  it('redraws the frozen reading, not a level horizon, when the gauge is rebuilt during a dropout', () => {
    h().render();
    h().feedBoth(4.5, -12);
    h().feed('gaugePitchPath', null);
    h().calls.length = 0;
    h().rebuildGauge();
    expect(h().rounded()).toEqual([
      { axis: 'pitch', value: 4.5 },
      { axis: 'roll', value: -12 }
    ]);
    expect(h().overlay()).not.toBeNull();
  });

  it('inverts the frozen reading when invertPitch is toggled during a dropout', () => {
    h().render();
    h().feedBoth(4.5, -12);
    h().feed('gaugePitchPath', null);
    h().calls.length = 0;
    h().options.set(configWith(true, false));
    h().fixture.detectChanges();
    expect(h().shown()).toEqual({ pitch: -4.5, roll: -12 });
    expect(h().overlay()).not.toBeNull();
  });

  it('does not count an unconfigured roll axis as lost', () => {
    const paths = WidgetHorizonComponent.DEFAULT_CONFIG.paths as IPathArray;
    h().render({ ...WidgetHorizonComponent.DEFAULT_CONFIG, paths: { gaugePitchPath: paths['gaugePitchPath'] } });
    expect(h().callbacks.has('gaugeRollPath')).toBe(false);
    expect(h().overlay()).not.toBeNull();
    h().feedDegrees('gaugePitchPath', 4.5);
    expect(h().overlay()).toBeNull();
  });
});
