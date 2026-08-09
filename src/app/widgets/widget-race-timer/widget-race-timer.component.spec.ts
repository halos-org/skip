import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetRaceTimerComponent } from './widget-race-timer.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { TimersService } from '../../core/services/timers.service';
import { CanvasService } from '../../core/services/canvas.service';
import type { ITheme } from '../../core/services/app-service';

const themeMock = {
  contrast: '#fff', dim: '#ccc', dimmer: '#999', color: '#fff',
  zoneNominal: '#0f0', zoneWarn: '#fa0', zoneAlarm: '#f00', zoneAlert: '#f0f'
} as unknown as ITheme;

// The 'race' timer is a shared singleton subject. ensureTimer() is invoked from the config effect
// (on every options() change) and from resetTimer(), so without lifecycle management each re-arm
// would stack another subscription on the same subject and none would be removed when the widget is
// destroyed. These tests pin that behaviour: exactly one active subscription, torn down on destroy.
describe('WidgetRaceTimerComponent timer subscription lifecycle', () => {
  let fixture: ComponentFixture<WidgetRaceTimerComponent>;
  let component: WidgetRaceTimerComponent;
  let timers: TimersService;

  const runtimeMock = { options: vi.fn() };
  const canvasMock = {
    registerCanvas: vi.fn(),
    unregisterCanvas: vi.fn(),
    clearCanvas: vi.fn(),
    calculateOptimalFontSize: vi.fn().mockReturnValue(10),
    drawRectangle: vi.fn(),
    drawText: vi.fn()
  };

  const setup = async (options: Record<string, unknown> = { timerLength: -300, color: 'contrast' }) => {
    runtimeMock.options.mockReturnValue(options);
    await TestBed.configureTestingModule({
      imports: [WidgetRaceTimerComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: CanvasService, useValue: canvasMock },
        TimersService
      ]
    }).compileComponents();

    timers = TestBed.inject(TimersService);
    fixture = TestBed.createComponent(WidgetRaceTimerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'w-race-1');
    fixture.componentRef.setInput('type', 'widget-race-timer');
    fixture.componentRef.setInput('theme', themeMock);
    fixture.detectChanges();
  };

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  const observerCount = (): number =>
    (timers as unknown as { skipTimers: Record<string, { currentValue: { observers: unknown[] } }> })
      .skipTimers['race']?.currentValue.observers.length ?? 0;

  it('keeps a single timer subscription when the timer is re-armed', async () => {
    await setup();
    expect(observerCount()).toBe(1);

    // Re-arm several times, as the config effect would on each options() change.
    const comp = component as unknown as { ensureTimer: (n: number) => void };
    comp.ensureTimer(-280);
    comp.ensureTimer(-260);
    comp.ensureTimer(-240);

    // Without lifecycle management this would be 4 (one per subscribe, none removed).
    expect(observerCount()).toBe(1);
  });

  it('tears down the timer subscription when the widget is destroyed', async () => {
    await setup();
    expect(observerCount()).toBe(1);

    fixture.destroy();

    expect(observerCount()).toBe(0);
  });
});

describe('WidgetRaceTimerComponent controls', () => {
  let fixture: ComponentFixture<WidgetRaceTimerComponent>;

  const runtimeMock = { options: () => WidgetRaceTimerComponent.DEFAULT_CONFIG };
  // Typed so a member the widget does not have is a compile error under `npm run snc`. A member it
  // gains later still returns undefined silently — the canvas is not what these tests are about.
  const canvasMock: Partial<CanvasService> = {
    registerCanvas: vi.fn(),
    unregisterCanvas: vi.fn(),
    clearCanvas: vi.fn(),
    calculateOptimalFontSize: vi.fn(() => 10),
    drawRectangle: vi.fn(),
    drawText: vi.fn()
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WidgetRaceTimerComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: CanvasService, useValue: canvasMock },
        TimersService
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetRaceTimerComponent);
    fixture.componentRef.setInput('id', 'race-timer-test');
    fixture.componentRef.setInput('type', 'widget-race-timer');
    fixture.componentRef.setInput('theme', themeMock);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  // Whether the timer runs is the only state that changes which controls exist: the countdown group
  // swaps Start for Pause.
  const setRunning = (running: boolean) => {
    fixture.componentInstance.timerRunning.set(running);
    fixture.detectChanges();
  };

  /**
   * What a screen reader would announce. `textContent` is not that: it includes subtrees marked
   * aria-hidden, which is exactly the markup that hid these labels, so a test built on it cannot
   * see the defect. Drop those subtrees first.
   */
  const accessibleName = (btn: HTMLButtonElement) => {
    const explicit = btn.getAttribute('aria-label');
    if (explicit) { return explicit.trim(); }
    const clone = btn.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
    return (clone.textContent ?? '').trim();
  };

  it('gives every control a pronounceable accessible name whether or not the timer runs', () => {
    // Angular Material marks mat-icon aria-hidden unless given an explicit value, so a control's
    // label must not live inside one or the control has no name at all.
    for (const running of [false, true]) {
      setRunning(running);
      const controls = host().querySelectorAll<HTMLButtonElement>('button');
      expect(controls.length).toBeGreaterThan(0);
      for (const btn of controls) {
        expect(accessibleName(btn), `running=${running}`).toMatch(/[a-z]/i);
      }
      expect(host().querySelector('mat-icon'), `running=${running}`).toBeNull();
      expect(host().querySelector('svg text'), `running=${running}`).toBeNull();
    }
  });

  it('renders the adjuster labels as text rather than markup the accessibility tree drops', () => {
    const labels = [...host().querySelectorAll<HTMLButtonElement>('button')]
      .map(b => b.textContent?.trim());
    expect(labels).toEqual(['-5s', '-60s', 'Reset', '+60s', '+5s', 'Start', 'Synch']);
  });
});
