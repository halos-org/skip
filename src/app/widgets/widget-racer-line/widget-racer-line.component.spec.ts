import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetRacerLineComponent } from './widget-racer-line.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { SignalkRequestsService } from '../../core/services/signalk-requests.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { CanvasService } from '../../core/services/canvas.service';
import { UnitsService } from '../../core/services/units.service';

describe('WidgetRacerLineComponent', () => {
  let fixture: ComponentFixture<WidgetRacerLineComponent>;

  const runtimeMock = { options: () => WidgetRacerLineComponent.DEFAULT_CONFIG };
  const streamsMock = { observe: vi.fn() };
  const requestsMock = { subscribeRequest: () => EMPTY, putRequest: vi.fn() };
  const dashboardMock = { isDashboardStatic: () => true };
  // Typed so a member the widget does not have is a compile error under `npm run snc`. A member it
  // gains later still returns undefined silently — the canvas is not what these tests are about.
  const canvasMock: Partial<CanvasService> = {
    clearCanvas: vi.fn(),
    createTitleBitmap: vi.fn(() => document.createElement('canvas')),
    drawText: vi.fn(),
    drawTextBitmap: vi.fn(),
    registerCanvas: vi.fn(),
    unregisterCanvas: vi.fn(),
    MIN_LABEL_PX: 16,
    MIN_UNIT_PX: 12
  };
  const unitsMock: Partial<UnitsService> = {
    convertToUnit: vi.fn((unit: string, value: number) => value),
    getUnitDisplaySymbol: vi.fn((measure: string | null | undefined) => measure ?? '')
  };

  beforeEach(async () => {
    streamsMock.observe.mockClear();
    await TestBed.configureTestingModule({
      imports: [WidgetRacerLineComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: SignalkRequestsService, useValue: requestsMock },
        { provide: DashboardService, useValue: dashboardMock },
        { provide: CanvasService, useValue: canvasMock },
        { provide: UnitsService, useValue: unitsMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetRacerLineComponent);
    const set = fixture.componentRef.setInput.bind(fixture.componentRef) as (k: string, v: unknown) => void;
    set('id', 'racer-line-test');
    set('type', 'widget-racer-line');
    set('theme', null);
    fixture.detectChanges();
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const setMode = (mode: number) => {
    (fixture.componentInstance as unknown as { mode: { set: (m: number) => void } }).mode.set(mode);
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

  it('gives every control a pronounceable accessible name in every mode', () => {
    // Angular Material marks mat-icon aria-hidden unless given an explicit value, so a control's
    // label must not live inside one or the control has no name at all.
    for (const mode of [0, 1, 2, 3, 4]) {
      setMode(mode);
      const controls = host().querySelectorAll<HTMLButtonElement>('button');
      expect(controls.length).toBeGreaterThan(0);
      for (const btn of controls) {
        expect(accessibleName(btn), `mode ${mode}`).toMatch(/[a-z]/i);
      }
      expect(host().querySelector('mat-icon'), `mode ${mode}`).toBeNull();
      expect(host().querySelector('svg text'), `mode ${mode}`).toBeNull();
    }
  });

  it('names both ends apart where the controls repeat a label', () => {
    for (const mode of [2, 3]) {
      setMode(mode);
      const names = [...host().querySelectorAll<HTMLButtonElement>('button')].map(accessibleName);
      expect(new Set(names).size, `mode ${mode}`).toBe(names.length);
    }
  });

  it('renders button labels as text rather than markup the accessibility tree drops', () => {
    setMode(1);
    const labels = [...host().querySelectorAll<HTMLButtonElement>('button')]
      .map(b => b.textContent?.trim());
    expect(labels).toContain('Port End');
    expect(labels).toContain('Stbd End');
  });

  it('renders the line readouts as text alongside the flag marking each end', () => {
    setMode(0);
    const readouts = [...host().querySelectorAll<HTMLElement>('.pin-container, .len-bias-container, .boat-container')];
    expect(readouts).toHaveLength(3);
    expect(host().querySelectorAll('.len-bias-container .pin, .len-bias-container .boat')).toHaveLength(2);
  });

  const clickControl = (name: string) => {
    const btn = [...host().querySelectorAll<HTMLButtonElement>('button')]
      .find(b => accessibleName(b) === name);
    expect(btn, `no control named ${name}`).toBeTruthy();
    btn?.click();
    fixture.detectChanges();
  };

  const DEG = Math.PI / 180;

  // The rewrite re-authored every button by hand, and the two ends differ only by an argument that
  // repeats across modes — a swapped end or sign is invisible in the markup. Pin each control to the
  // request it sends.
  it.each([
    [1, 'Port End', { end: 'port', position: 'bow' }],
    [1, 'Stbd End', { end: 'stb', position: 'bow' }],
    [2, 'Increase the line length by 5m at the port end', { end: 'port', delta: 5, rotate: null }],
    [2, 'Decrease the line length by 5m at the port end', { end: 'port', delta: -5, rotate: null }],
    [2, 'Increase the line length by 5m at the starboard end', { end: 'stb', delta: 5, rotate: null }],
    [2, 'Decrease the line length by 5m at the starboard end', { end: 'stb', delta: -5, rotate: null }],
    [3, 'Rotate the line by moving the port end 1 degree clockwise', { end: 'port', delta: 0, rotate: DEG }],
    [3, 'Rotate the line by moving the port end 1 degree counter-clockwise', { end: 'port', delta: 0, rotate: -DEG }],
    [3, 'Rotate the line by moving the starboard end 1 degree clockwise', { end: 'stb', delta: 0, rotate: -DEG }],
    [3, 'Rotate the line by moving the starboard end 1 degree counter-clockwise', { end: 'stb', delta: 0, rotate: DEG }]
  ])('mode %i: %s sends %o', (mode, name, payload) => {
    requestsMock.putRequest.mockClear();
    setMode(mode as number);
    clickControl(name as string);
    expect(requestsMock.putRequest).toHaveBeenCalledWith(
      'navigation.racing.setStartLine', payload, 'racer-line-test');
  });

  it('sets the displayed line as the current one', () => {
    requestsMock.putRequest.mockClear();
    setMode(4);
    clickControl('Default');
    expect(requestsMock.putRequest).toHaveBeenCalledWith(
      'navigation.racing.setStartLineName', { startLineName: null }, 'racer-line-test');
  });
});
