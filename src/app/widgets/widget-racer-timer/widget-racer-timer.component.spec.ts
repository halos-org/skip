import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetRacerTimerComponent } from './widget-racer-timer.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { SignalkRequestsService } from '../../core/services/signalk-requests.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { CanvasService } from '../../core/services/canvas.service';

describe('WidgetRacerTimerComponent', () => {
  let fixture: ComponentFixture<WidgetRacerTimerComponent>;

  const runtimeMock = { options: () => WidgetRacerTimerComponent.DEFAULT_CONFIG };
  const streamsMock = { observe: vi.fn() };
  const requestsMock = { subscribeRequest: () => EMPTY, putRequest: vi.fn() };
  const dashboardMock = { isDashboardStatic: () => true };
  // Every CanvasService member the widget touches; the canvas itself is not under test here.
  const canvasMock = {
    clearCanvas: vi.fn(),
    createTitleBitmap: vi.fn(() => null),
    drawText: vi.fn(),
    drawTextBitmap: vi.fn(),
    registerCanvas: vi.fn(),
    unregisterCanvas: vi.fn(),
    MIN: 0
  };

  beforeEach(async () => {
    streamsMock.observe.mockClear();
    await TestBed.configureTestingModule({
      imports: [WidgetRacerTimerComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: SignalkRequestsService, useValue: requestsMock },
        { provide: DashboardService, useValue: dashboardMock },
        { provide: CanvasService, useValue: canvasMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetRacerTimerComponent);
    const set = fixture.componentRef.setInput.bind(fixture.componentRef) as (k: string, v: unknown) => void;
    set('id', 'racer-timer-test');
    set('type', 'widget-racer-timer');
    set('theme', null);
    fixture.detectChanges();
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const setMode = (mode: number) => {
    (fixture.componentInstance as unknown as { mode: { set: (m: number) => void } }).mode.set(mode);
    fixture.detectChanges();
  };

  /** A name a screen reader can read out: a word, not a bare glyph. */
  const accessibleName = (btn: HTMLButtonElement) =>
    (btn.getAttribute('aria-label') ?? btn.textContent ?? '').trim();

  it('gives every control a pronounceable accessible name in every mode', () => {
    // The labels used to live inside <mat-icon>, which Angular Material marks aria-hidden unless an
    // explicit value is given — leaving every button nameless to assistive tech.
    for (const mode of [0, 1, 2, 3, 4]) {
      setMode(mode);
      const controls = host().querySelectorAll<HTMLButtonElement>('button');
      expect(controls.length).toBeGreaterThan(0);
      for (const btn of controls) {
        expect(accessibleName(btn), `mode ${mode}`).toMatch(/[a-z]/i);
      }
    }
  });

  it('renders button labels as text rather than markup the accessibility tree drops', () => {
    setMode(1);
    const labels = [...host().querySelectorAll<HTMLButtonElement>('button')]
      .map(b => b.textContent?.trim());
    expect(labels).toContain('Start');
    expect(labels).toContain('-1m');
    expect(labels).toContain('+1m');
    expect(host().querySelector('mat-icon')).toBeNull();
    expect(host().querySelector('svg text')).toBeNull();
  });

  it('names the absolute start time field, whose glyph-free input carries no visible label', () => {
    setMode(4);
    const input = host().querySelector<HTMLInputElement>('input.set-start-at');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('aria-label')).toBeTruthy();
    expect(input?.type).toBe('time');
  });
});
