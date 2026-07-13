import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SvgBooleanButtonComponent } from './svg-boolean-button.component';
import type { IDynamicControl } from '../../core/interfaces/widgets-interface';
import type { IDimensions } from '../widget-boolean-switch/widget-boolean-switch.component';

const controlMock: IDynamicControl = {
  ctrlLabel: 'Bilge Pump',
  type: '2',
  pathID: 'test-path',
  value: false,
  color: 'contrast',
  isNumeric: false
};

const dimensionsMock: IDimensions = { width: 180, height: 70 };

function pointerAt(clientX: number, clientY: number): PointerEvent {
  return { clientX, clientY } as unknown as PointerEvent;
}

describe('SvgBooleanButtonComponent momentary emit', () => {
  let fixture: ComponentFixture<SvgBooleanButtonComponent>;
  let component: SvgBooleanButtonComponent;
  let emitted: IDynamicControl[];

  const setup = (controlData: IDynamicControl | null = controlMock, render = true) => {
    TestBed.configureTestingModule({ imports: [SvgBooleanButtonComponent] });
    fixture = TestBed.createComponent(SvgBooleanButtonComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('controlData', controlData);
    fixture.componentRef.setInput('theme', null);
    fixture.componentRef.setInput('dimensions', dimensionsMock);
    emitted = [];
    component.toggleClick.subscribe((v) => emitted.push(v));
    if (render) fixture.detectChanges();
  };

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it('actuates after the short hold, not before', () => {
    setup();
    vi.useFakeTimers();

    component.handleClickDown(pointerAt(10, 10));
    expect(emitted).toHaveLength(0);
    vi.advanceTimersByTime(74);
    expect(emitted).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].value).toBe(true);
  });

  it('does not actuate when a swipe cancels within the hold window', () => {
    setup();
    vi.useFakeTimers();

    component.handleClickDown(pointerAt(10, 10));
    // A scroll/swipe crossing the threshold before the hold elapses must suppress actuation entirely.
    component.handlePointerMove(pointerAt(60, 12));
    vi.advanceTimersByTime(500);

    expect(emitted).toHaveLength(0);
  });

  it('does not actuate on a quick tap released within the hold window', () => {
    setup();
    vi.useFakeTimers();

    component.handleClickDown(pointerAt(10, 10));
    component.handleClickUp();
    vi.advanceTimersByTime(500);

    expect(emitted).toHaveLength(0);
  });

  it('repeats every 100ms while held', () => {
    setup();
    vi.useFakeTimers();

    component.handleClickDown(pointerAt(10, 10));
    vi.advanceTimersByTime(75);
    expect(emitted).toHaveLength(1);

    vi.advanceTimersByTime(100);
    expect(emitted).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(emitted).toHaveLength(3);
  });

  it('keeps the press when movement stays below the swipe threshold', () => {
    setup();
    vi.useFakeTimers();

    component.handleClickDown(pointerAt(10, 10));
    // 25px/5px move — under the 30px threshold, so it must not cancel.
    component.handlePointerMove(pointerAt(35, 15));
    vi.advanceTimersByTime(75);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].value).toBe(true);
  });

  it('stops repeating once the pointer is released', () => {
    setup();
    vi.useFakeTimers();

    component.handleClickDown(pointerAt(10, 10));
    vi.advanceTimersByTime(75);
    expect(emitted).toHaveLength(1);

    // A lifted finger clears the repeat interval, so actuation stops.
    component.handleClickUp();
    vi.advanceTimersByTime(500);
    expect(emitted).toHaveLength(1);
  });

  it('emits nothing and starts no timers when controlData is null', () => {
    // The template dereferences data(); it is never rendered with null in practice,
    // so exercise the handler guard directly without a render.
    setup(null, false);
    vi.useFakeTimers();

    component.handleClickDown(pointerAt(10, 10));
    vi.advanceTimersByTime(500);

    expect(emitted).toHaveLength(0);
  });
});
