import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WidgetHeelGaugeComponent } from './widget-heel-gauge.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetPath, IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

const DEG = Math.PI / 180;

describe('WidgetHeelGaugeComponent', () => {
  let fixture: ComponentFixture<WidgetHeelGaugeComponent>;
  let component: WidgetHeelGaugeComponent;
  let observeCalls: { pathName: string; pointer?: string }[];
  let originalGetTotalLength: ((this: SVGElement) => number) | undefined;
  let originalGetPointAtLength: ((this: SVGElement, distance: number) => DOMPoint) | undefined;

  beforeEach(async () => {
    observeCalls = [];
    originalGetTotalLength = (SVGElement.prototype as SVGElement & { getTotalLength?: () => number }).getTotalLength;
    originalGetPointAtLength = (SVGElement.prototype as SVGElement & { getPointAtLength?: (distance: number) => DOMPoint }).getPointAtLength;

    (SVGElement.prototype as SVGElement & { getTotalLength: () => number }).getTotalLength = () => 100;
    (SVGElement.prototype as SVGElement & { getPointAtLength: (distance: number) => DOMPoint }).getPointAtLength = (distance: number) => {
      const x = Math.max(0, Math.min(100, distance));
      return { x, y: 20 } as DOMPoint;
    };

    await TestBed.configureTestingModule({
      imports: [WidgetHeelGaugeComponent],
      providers: [
        {
          provide: WidgetRuntimeDirective,
          useValue: {
            options: () => ({
              gauge: { sideLabel: true },
              paths: {
                angle: {
                  path: 'self.navigation.attitude',
                  sampleTime: 1000,
                },
              },
              numDecimal: 1,
              displayName: 'Heel',
              color: 'contrast',
            }),
          },
        },
        {
          provide: WidgetStreamsDirective,
          useValue: {
            observe: (pathName: string, _next: unknown, pointer?: string) => {
              observeCalls.push({ pathName, pointer });
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetHeelGaugeComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'heel-1');
    fixture.componentRef.setInput('type', 'widget-heel-gauge');
    fixture.componentRef.setInput('theme', {
      contrast: '#fff',
      zoneNominal: '#0f0',
      zoneWarn: '#ff0',
      zoneAlarm: '#f00',
      zoneAlert: '#f0f',
      zoneEmergency: '#00f',
    });
  });

  afterEach(() => {
    if (originalGetTotalLength) {
      (SVGElement.prototype as SVGElement & { getTotalLength: () => number }).getTotalLength = originalGetTotalLength;
    }
    if (originalGetPointAtLength) {
      (SVGElement.prototype as SVGElement & { getPointAtLength: (distance: number) => DOMPoint }).getPointAtLength = originalGetPointAtLength;
    }
  });

  it('should create and render widget title', () => {
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Heel');
  });

  it('observes its configured angle path as it is, the pointer path carrying any field', () => {
    fixture.detectChanges();

    expect(observeCalls).toContainEqual({ pathName: 'angle', pointer: undefined });
  });

  it('defaults to the roll and lets the user choose any angle path', () => {
    const angle = (WidgetHeelGaugeComponent.DEFAULT_CONFIG.paths as Record<string, object>)['angle'];
    expect(angle).toMatchObject({
      path: 'self.navigation.attitude#/roll',
      pathType: 'number',
      isPathConfigurable: true,
      pathSkUnitsFilter: 'rad',
      convertUnitTo: 'deg',
      showConvertUnitTo: false
    });
  });
});

/**
 * What the gauge shows for a set of SI roll inputs: the readout and side label, and where the fine
 * and coarse pointers sit on their arcs. Pins the output so a change of the unit the widget
 * computes in cannot move anything on screen.
 */
describe('WidgetHeelGaugeComponent output from SI inputs', () => {
  let fixture: ComponentFixture<WidgetHeelGaugeComponent>;
  let next: ((u: IPathUpdate) => void) | undefined;
  let options: WritableSignal<IWidgetSvcConfig>;
  let originalGetTotalLength: ((this: SVGElement) => number) | undefined;
  let originalGetPointAtLength: ((this: SVGElement, distance: number) => DOMPoint) | undefined;

  interface HeelOutput {
    displayValue: () => string;
    angleSide: () => string;
    finePointerTransform: () => string;
    coarsePointerTransform: () => string;
  }

  /** An SI roll sample as the streams directive delivers it to this widget, with its presentation measure. */
  const feed = (rad: number | null): void => {
    next?.({ data: { value: rad, timestamp: null, measure: 'deg' }, state: 'normal' } as IPathUpdate);
  };
  const feedDegrees = (deg: number): void => feed(deg * DEG);

  const normalise = (s: string): string => s.replace(/-?\d+\.\d+/g, n => String(Number(Number(n).toFixed(6))));
  const shown = () => {
    const c = fixture.componentInstance as unknown as HeelOutput;
    return {
      text: c.displayValue(),
      side: c.angleSide(),
      fine: normalise(c.finePointerTransform()),
      coarse: normalise(c.coarsePointerTransform())
    };
  };

  const render = (invertAngle = false): void => {
    options = signal<IWidgetSvcConfig>({
      ...WidgetHeelGaugeComponent.DEFAULT_CONFIG,
      gauge: { ...WidgetHeelGaugeComponent.DEFAULT_CONFIG.gauge, type: 'angle', invertAngle },
      numDecimal: 1
    });
    TestBed.configureTestingModule({
      imports: [WidgetHeelGaugeComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        {
          provide: WidgetStreamsDirective,
          useValue: { observe: (_p: string, n: (u: IPathUpdate) => void) => { next = n; } }
        }
      ]
    });
    fixture = TestBed.createComponent(WidgetHeelGaugeComponent);
    fixture.componentRef.setInput('id', 'heel-si');
    fixture.componentRef.setInput('type', 'widget-heel-gauge');
    fixture.componentRef.setInput('theme', { contrast: '#fff' });
    fixture.detectChanges();
  };

  beforeEach(() => {
    next = undefined;
    originalGetTotalLength = (SVGElement.prototype as SVGElement & { getTotalLength?: () => number }).getTotalLength;
    originalGetPointAtLength = (SVGElement.prototype as SVGElement & { getPointAtLength?: (distance: number) => DOMPoint }).getPointAtLength;
    (SVGElement.prototype as SVGElement & { getTotalLength: () => number }).getTotalLength = () => 100;
    (SVGElement.prototype as SVGElement & { getPointAtLength: (distance: number) => DOMPoint }).getPointAtLength =
      (distance: number) => ({ x: Math.max(0, Math.min(100, distance)), y: 20 + distance / 10 }) as DOMPoint;
  });

  afterEach(() => {
    fixture?.destroy();
    if (originalGetTotalLength) {
      (SVGElement.prototype as SVGElement & { getTotalLength: () => number }).getTotalLength = originalGetTotalLength;
    }
    if (originalGetPointAtLength) {
      (SVGElement.prototype as SVGElement & { getPointAtLength: (distance: number) => DOMPoint }).getPointAtLength = originalGetPointAtLength;
    }
  });

  it('reads a starboard heel on both scales', () => {
    render();
    feedDegrees(3.2);
    expect(shown()).toEqual({
      text: '3.2', side: 'Stbd',
      fine: 'translate(82.995037px, 18.249628px) rotate(5.710593deg)',
      coarse: 'translate(54.995037px, 15.449628px) rotate(5.710593deg)'
    });
  });

  it('pins the fine pointer at its end stop for a heel past its range', () => {
    render();
    feedDegrees(-12.5);
    expect(shown()).toEqual({
      text: '12.5', side: 'Port',
      fine: 'translate(0.995037px, 10.049628px) rotate(5.710593deg)',
      coarse: 'translate(35.370037px, 13.487128px) rotate(5.710593deg)'
    });
  });

  it('flips the side when the angle is inverted', () => {
    render(true);
    feedDegrees(7);
    expect(shown()).toEqual({
      text: '7.0', side: 'Port',
      fine: 'translate(0.995037px, 10.049628px) rotate(5.710593deg)',
      coarse: 'translate(42.245037px, 14.174628px) rotate(5.710593deg)'
    });
  });

  it('drops the reading when re-pointed at another angle path, until that path reports', () => {
    render();
    feedDegrees(10);
    expect(shown().text).toBe('10.0');

    const angle = (options().paths as Record<string, IWidgetPath>)['angle'];
    options.set({ ...options(), paths: { angle: { ...angle, path: 'self.steering.rudderAngle' } } });
    fixture.detectChanges();
    expect(shown().text).toBe('--');
  });

  it('shows the placeholder on a null', () => {
    render();
    feedDegrees(7);
    feed(null);
    expect(shown()).toEqual({
      text: '--', side: '',
      fine: 'translate(50.995037px, 15.049628px) rotate(5.710593deg)',
      coarse: 'translate(50.995037px, 15.049628px) rotate(5.710593deg)'
    });
  });
});
