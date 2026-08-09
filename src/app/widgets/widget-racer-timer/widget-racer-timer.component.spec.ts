import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetRacerTimerComponent } from './widget-racer-timer.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { SignalkRequestsService, skRequest } from '../../core/services/signalk-requests.service';
import { ToastService } from '../../core/services/toast.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { CanvasService } from '../../core/services/canvas.service';

describe('WidgetRacerTimerComponent', () => {
  let fixture: ComponentFixture<WidgetRacerTimerComponent>;

  const runtimeMock = { options: () => WidgetRacerTimerComponent.DEFAULT_CONFIG };
  const streamsMock = { observe: vi.fn() };
  const requestResults = new Subject<skRequest>();
  const requestsMock = {
    subscribeRequest: () => requestResults.asObservable(),
    putRequest: vi.fn(() => 'req-1')
  };
  const dashboardMock = { isDashboardStatic: () => true };
  const toastMock = { show: vi.fn() };
  // Typed so a member the widget does not have is a compile error under `npm run snc`. A member it
  // gains later still returns undefined silently — the canvas is not what these tests are about.
  const canvasMock: Partial<CanvasService> = {
    clearCanvas: vi.fn(),
    createTitleBitmap: vi.fn(() => document.createElement('canvas')),
    drawText: vi.fn(),
    drawTextBitmap: vi.fn(),
    registerCanvas: vi.fn(),
    unregisterCanvas: vi.fn(),
    MIN_LABEL_PX: 16
  };

  beforeEach(async () => {
    streamsMock.observe.mockClear();
    requestsMock.putRequest.mockClear();
    toastMock.show.mockClear();
    await TestBed.configureTestingModule({
      imports: [WidgetRacerTimerComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: SignalkRequestsService, useValue: requestsMock },
        { provide: DashboardService, useValue: dashboardMock },
        { provide: ToastService, useValue: toastMock },
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

  it('renders button labels as text rather than markup the accessibility tree drops', () => {
    setMode(1);
    const labels = [...host().querySelectorAll<HTMLButtonElement>('button')]
      .map(b => b.textContent?.trim());
    expect(labels).toContain('Start');
    expect(labels).toContain('-1m');
    expect(labels).toContain('+1m');
  });

  const clickLabel = (text: string) => {
    const btn = [...host().querySelectorAll<HTMLButtonElement>('button')]
      .find(b => b.textContent?.trim() === text);
    expect(btn, `no button labelled ${text}`).toBeTruthy();
    btn?.click();
    fixture.detectChanges();
  };

  // The rewrite re-authored every button by hand, and the adjust arguments differ only by sign while
  // two modes reuse the same labels. Pin each label to the request it sends.
  it.each([
    [1, 'Start', { command: 'start' }],
    [2, 'Sync', { command: 'sync' }],
    [2, 'Reset', { command: 'reset' }],
    [1, '-1m', { command: 'adjust', delta: -60 }],
    [1, '+1m', { command: 'adjust', delta: 60 }],
    [3, '-1m', { command: 'adjust', delta: -60 }],
    [3, '-1s', { command: 'adjust', delta: -1 }],
    [3, '+1s', { command: 'adjust', delta: 1 }],
    [3, '+1m', { command: 'adjust', delta: 60 }]
  ])('mode %i: %s sends %o', (mode, label, payload) => {
    requestsMock.putRequest.mockClear();
    toastMock.show.mockClear();
    setMode(mode as number);
    clickLabel(label as string);
    expect(requestsMock.putRequest).toHaveBeenCalledWith(
      'navigation.racing.setStartTime', payload, 'racer-timer-test');
  });

  it('names the absolute start time field, whose glyph-free input carries no visible label', () => {
    setMode(4);
    const input = host().querySelector<HTMLInputElement>('input.set-start-at');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('aria-label')).toBeTruthy();
    expect(input?.type).toBe('time');
  });

  // The widget holds no start time of its own: the readout shows what the race plugin publishes
  // back, so leaving the form before the request settles shows a placeholder that looks identical
  // to a timer that is actually set.
  describe('setting an absolute start time', () => {
    const enterTime = () => {
      setMode(4);
      const input = host().querySelector<HTMLInputElement>('input.set-start-at');
      input!.value = '23:45:00';
      input!.dispatchEvent(new Event('input'));
      clickLabel('Set');
    };

    it('sends nothing until Set is pressed, however the field is left', () => {
      // A touch wheel picker gives the user nowhere obvious to tap to blur, so blur is not a commit.
      setMode(4);
      const input = host().querySelector<HTMLInputElement>('input.set-start-at');
      input!.value = '20:40:00';
      input!.dispatchEvent(new Event('input'));
      input!.dispatchEvent(new Event('blur'));
      input!.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(requestsMock.putRequest).not.toHaveBeenCalled();
      clickLabel('Set');
      expect(requestsMock.putRequest).toHaveBeenCalled();
    });

    it('does not submit an intermediate value while the field is still being typed', () => {
      // Chromium fires `change` as soon as a time input holds a complete value, so typing 20 then 4
      // of "20:40" made "20:04" complete and submitted it.
      setMode(4);
      const input = host().querySelector<HTMLInputElement>('input.set-start-at');
      input!.value = '20:04:00';
      input!.dispatchEvent(new Event('input'));
      input!.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(requestsMock.putRequest).not.toHaveBeenCalled();
      expect(host().querySelector('input.set-start-at')).not.toBeNull();
    });

    it('stays on the form until the server confirms', () => {
      enterTime();
      expect(requestsMock.putRequest).toHaveBeenCalled();
      expect(host().querySelector('input.set-start-at')).not.toBeNull();
    });

    it('leaves the form once the request succeeds', () => {
      enterTime();
      requestResults.next({ requestId: 'req-1', state: 'COMPLETED', statusCode: 200, widgetUUID: 'racer-timer-test' });
      fixture.detectChanges();
      expect(host().querySelector('input.set-start-at')).toBeNull();
    });

    it('stays on the form and reports a refusal', () => {
      enterTime();
      requestResults.next({ requestId: 'req-1', state: 'COMPLETED', statusCode: 403,
        statusCodeDescription: 'Permission denied', widgetUUID: 'racer-timer-test' });
      fixture.detectChanges();
      expect(host().querySelector('input.set-start-at')).not.toBeNull();
      expect(toastMock.show).toHaveBeenCalledWith('Permission denied', expect.anything(), false, 'error');
    });


    it('lets the helm retry the same time after a refusal', () => {
      // The error toast asks for a retry; a dedupe guard used to make that press do nothing.
      enterTime();
      requestResults.next({ requestId: 'req-1', state: 'COMPLETED', statusCode: 403,
        statusCodeDescription: 'Permission denied', widgetUUID: 'racer-timer-test' });
      fixture.detectChanges();
      requestsMock.putRequest.mockClear();
      clickLabel('Set');
      expect(requestsMock.putRequest).toHaveBeenCalled();
    });

    it('says why when Set is pressed on a half-entered time', () => {
      // A time input reads as empty until every segment is filled, so this is reachable by typing.
      setMode(4);
      clickLabel('Set');
      expect(requestsMock.putRequest).not.toHaveBeenCalled();
      expect(toastMock.show).toHaveBeenCalledWith('Enter a complete time first', expect.anything(), false, 'error');
    });

    it('ignores a reply belonging to another request', () => {
      enterTime();
      requestResults.next({ requestId: 'someone-else', state: 'COMPLETED', statusCode: 200, widgetUUID: 'racer-timer-test' });
      fixture.detectChanges();
      expect(host().querySelector('input.set-start-at')).not.toBeNull();
    });
  });

  const startTimeObserver = () =>
    streamsMock.observe.mock.calls.find(c => c[0] === 'startTimePath')?.[1] as
      ((pkt: { data: { value: string | null } }) => void) | undefined;

  it('fills the field from the server while the form is closed', () => {
    setMode(0);
    const edit = (fixture.componentInstance as unknown as {
      startAtTimeEdit: { set: (v: string) => void; (): string };
    }).startAtTimeEdit;
    edit.set('');
    const observer = startTimeObserver();
    expect(observer, 'startTimePath was never observed').toBeTruthy();
    const when = new Date();
    when.setHours(21, 5, 30, 0);
    observer?.({ data: { value: when.toISOString() } });
    fixture.detectChanges();
    expect(edit()).toBe('21:05:30');
  });

  it('does not let a server value overwrite the field being edited', () => {
    setMode(4);
    const edit = (fixture.componentInstance as unknown as {
      startAtTimeEdit: { set: (v: string) => void; (): string };
    }).startAtTimeEdit;
    edit.set('20:40:00');
    const when = new Date();
    when.setHours(21, 5, 30, 0);
    startTimeObserver()?.({ data: { value: when.toISOString() } });
    fixture.detectChanges();
    expect(edit()).toBe('20:40:00');
  });

  it('does not let a data timeout blank the field being edited', () => {
    // enableTimeout is on with a 5s window, so an unset start time emits null repeatedly.
    setMode(4);
    const edit = (fixture.componentInstance as unknown as {
      startAtTimeEdit: { set: (v: string) => void; (): string };
    }).startAtTimeEdit;
    edit.set('20:40:00');
    fixture.detectChanges();

    const observer = streamsMock.observe.mock.calls.find(c => c[0] === 'startTimePath')?.[1] as
      ((pkt: { data: { value: string | null } }) => void) | undefined;
    expect(observer, 'startTimePath was never observed').toBeTruthy();
    observer?.({ data: { value: null } });
    fixture.detectChanges();

    expect(edit()).toBe('20:40:00');
  });
});
