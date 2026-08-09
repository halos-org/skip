import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GestureDirective } from './gesture.directive';

@Component({
    selector: 'test-gesture-host',
    imports: [GestureDirective],
    template: `
    <div
      id="host"
      skipGestures
      [mode]="mode"
      [longPressMs]="longPressMs"
      [pressMoveSlop]="pressMoveSlop"
      [swipeMinDistance]="swipeMinDistance"
      [swipeMaxDuration]="swipeMaxDuration"
      [enableDoubleTap]="enableDoubleTap"
      [enableTap]="enableTap"
      (tap)="tapCount = tapCount + 1">
      <input class="probe-input" type="time" step="1">
    </div>
  `
})
class TestHostComponent {
  /** Opt-in single-tap recognition. */
  public enableTap = false;
  /** Number of `tap` outputs observed. */
  public tapCount = 0;
    /**
     * Active gesture mode for the directive under test.
     * @returns Current gesture mode value.
     * @example
     * this.mode = 'press';
     */
    public mode: 'all' | 'horizontal' | 'dashboard' | 'press' | 'editor' = 'press';
    /**
     * Long-press threshold in milliseconds.
     * @returns Current long-press duration.
     * @example
     * this.longPressMs = 120;
     */
    public longPressMs = 120;
    /**
     * Movement slop allowed for long-press recognition.
     * @returns Current press move slop threshold.
     * @example
     * this.pressMoveSlop = 12;
     */
    public pressMoveSlop = 12;
    /**
     * Minimum swipe distance used by the directive.
     * @returns Current swipe distance threshold.
     * @example
     * this.swipeMinDistance = 30;
     */
    public swipeMinDistance = 30;
    /**
     * Maximum swipe duration used by the directive.
     * @returns Current swipe duration threshold.
     * @example
     * this.swipeMaxDuration = 600;
     */
    public swipeMaxDuration = 600;
    /**
     * Toggle for double-tap recognition.
     * @returns True when double-tap is enabled.
     * @example
     * this.enableDoubleTap = false;
     */
    public enableDoubleTap = true;
}

const POINTER_ID = 1;

function createPointerEvent(type: string, init: PointerEventInit): PointerEvent {
    if (typeof PointerEvent !== 'undefined') {
        return new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
    }
    const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
    Object.defineProperty(event, 'clientX', { value: init.clientX ?? 0 });
    Object.defineProperty(event, 'clientY', { value: init.clientY ?? 0 });
    Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? POINTER_ID });
    Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'touch' });
    return event;
}

function dispatchPointerEvent(el: Element, type: string, init: PointerEventInit): void {
    el.dispatchEvent(createPointerEvent(type, init));
}

describe('GestureDirective', () => {
    let fixture: ComponentFixture<TestHostComponent>;
    let hostEl: HTMLElement;
    let component: TestHostComponent;
    let now = 1000;

    beforeEach(async () => {
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const gestureStatics = GestureDirective as unknown as {
            _suppressAllGesturesUntil?: number;
            _laneOwners?: Map<number, {
                h?: number;
                v?: number;
                p?: number;
            }>;
            _activePointers?: Set<number>;
            _multiPointerActive?: boolean;
        };
        if (gestureStatics._suppressAllGesturesUntil !== undefined)
            gestureStatics._suppressAllGesturesUntil = 0;
        if (gestureStatics._laneOwners)
            gestureStatics._laneOwners.clear();
        if (gestureStatics._activePointers)
            gestureStatics._activePointers.clear();
        if (gestureStatics._multiPointerActive !== undefined)
            gestureStatics._multiPointerActive = false;
        await TestBed.configureTestingModule({
            imports: [TestHostComponent]
        }).compileComponents();

        fixture = TestBed.createComponent(TestHostComponent);
        component = fixture.componentInstance;
    });

    const syncFixture = () => {
        fixture.detectChanges();
        hostEl = fixture.nativeElement.querySelector('#host') as HTMLElement;
    };

    it('emits press after long-press threshold', async () => {
        component.mode = 'press';
        component.longPressMs = 80;
        syncFixture();
        now = 2000;
        let pressCount = 0;
        hostEl.addEventListener('press', () => { pressCount += 1; });

            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        dispatchPointerEvent(hostEl, 'pointerdown', {
            clientX: 100,
            clientY: 100,
            pointerId: POINTER_ID,
            pointerType: 'touch'
        });
        await vi.advanceTimersByTimeAsync(80);
        vi.useRealTimers();

        expect(pressCount).toBe(1);
    });

    it('emits swiperight for horizontal swipe', () => {
        component.mode = 'horizontal';
        component.swipeMinDistance = 30;
        component.swipeMaxDuration = 600;
        syncFixture();
        now = 3000;
        let swipeRightCount = 0;
        let swipeLeftCount = 0;
        hostEl.addEventListener('swiperight', () => { swipeRightCount += 1; });
        hostEl.addEventListener('swipeleft', () => { swipeLeftCount += 1; });

        dispatchPointerEvent(hostEl, 'pointerdown', {
            clientX: 50,
            clientY: 60,
            pointerId: POINTER_ID,
            pointerType: 'touch'
        });

        dispatchPointerEvent(hostEl, 'pointermove', {
            clientX: 110,
            clientY: 60,
            pointerId: POINTER_ID,
            pointerType: 'touch'
        });

        now = 3200;

        dispatchPointerEvent(hostEl, 'pointerup', {
            clientX: 110,
            clientY: 60,
            pointerId: POINTER_ID,
            pointerType: 'touch'
        });

        expect(swipeRightCount).toBe(1);
        expect(swipeLeftCount).toBe(0);
    });

    it('claims touch-move only while tracking a gesture (stops the fling that swallows the next tap)', () => {
        component.mode = 'all';
        syncFixture();
        const touchMovePrevented = () => {
            const e = new Event('touchmove', { bubbles: true, cancelable: true });
            hostEl.dispatchEvent(e);
            return e.defaultPrevented;
        };

        // Idle (not tracking): touch-move passes through, so scrolling in dialogs/sheets is unaffected.
        expect(touchMovePrevented()).toBe(false);

        // A gesture starts on pointerdown -> subsequent touch-moves are claimed so the browser
        // recognises no scroll/fling (a fling would make Chromium suppress the click of the tap that
        // stops it, losing a flick-to-reveal-then-tap).
        dispatchPointerEvent(hostEl, 'pointerdown', { clientX: 50, clientY: 20, pointerId: POINTER_ID, pointerType: 'touch' });
        expect(touchMovePrevented()).toBe(true);

        // After release, tracking ends -> touch-move passes through again.
        dispatchPointerEvent(hostEl, 'pointerup', { clientX: 50, clientY: 20, pointerId: POINTER_ID, pointerType: 'touch' });
        expect(touchMovePrevented()).toBe(false);
    });

    it('yields touch-move to a scrollable descendant so routed pages/lists keep touch-scrolling', () => {
        component.mode = 'all';
        syncFixture();
        // A scrollable child with content overflowing (jsdom has no layout, so stub the metrics).
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        Object.defineProperty(scroller, 'scrollHeight', { value: 400, configurable: true });
        Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true });
        hostEl.appendChild(scroller);

        // Gesture tracking, but the touch is inside the scroller -> NOT claimed, so the browser scrolls.
        dispatchPointerEvent(hostEl, 'pointerdown', { clientX: 50, clientY: 20, pointerId: POINTER_ID, pointerType: 'touch' });
        const onScroller = new Event('touchmove', { bubbles: true, cancelable: true });
        scroller.dispatchEvent(onScroller);
        expect(onScroller.defaultPrevented).toBe(false);
    });

    it('emits doubletap for two taps within interval', () => {
        component.mode = 'press';
        component.enableDoubleTap = true;
        component.longPressMs = 400;
        syncFixture();
        now = 4000;
        let doubleTapCount = 0;
        hostEl.addEventListener('doubletap', () => { doubleTapCount += 1; });

        dispatchPointerEvent(hostEl, 'pointerdown', {
            clientX: 20,
            clientY: 20,
            pointerId: POINTER_ID,
            pointerType: 'touch'
        });

        now = 4050;

        dispatchPointerEvent(hostEl, 'pointerup', {
            clientX: 20,
            clientY: 20,
            pointerId: POINTER_ID,
            pointerType: 'touch'
        });

        now = 4200;

        dispatchPointerEvent(hostEl, 'pointerdown', {
            clientX: 20,
            clientY: 20,
            pointerId: POINTER_ID,
            pointerType: 'touch'
        });

        now = 4250;

        dispatchPointerEvent(hostEl, 'pointerup', {
            clientX: 20,
            clientY: 20,
            pointerId: POINTER_ID,
            pointerType: 'touch'
        });

        expect(doubleTapCount).toBe(1);
    });

    it('suppresses long-press when movement exceeds press slop', async () => {
        component.mode = 'press';
        component.longPressMs = 80;
        component.pressMoveSlop = 8;
        syncFixture();
        now = 5000;
        let pressCount = 0;
        hostEl.addEventListener('press', () => { pressCount += 1; });

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        dispatchPointerEvent(hostEl, 'pointerdown', {
            clientX: 100,
            clientY: 100,
            pointerId: POINTER_ID,
            pointerType: 'touch'
        });

        dispatchPointerEvent(hostEl, 'pointermove', {
            clientX: 130,
            clientY: 100,
            pointerId: POINTER_ID,
            pointerType: 'touch'
        });

        await vi.advanceTimersByTimeAsync(100);
        vi.useRealTimers();

        expect(pressCount).toBe(0);
    });

    it('emits tap on a quick low-movement release when enableTap is set', () => {
        component.mode = 'press';
        component.enableTap = true;
        component.enableDoubleTap = false;
        component.longPressMs = 400;
        syncFixture();
        now = 7000;

        dispatchPointerEvent(hostEl, 'pointerdown', { clientX: 20, clientY: 20, pointerId: POINTER_ID, pointerType: 'touch' });
        now = 7050;
        dispatchPointerEvent(hostEl, 'pointerup', { clientX: 21, clientY: 21, pointerId: POINTER_ID, pointerType: 'touch' });

        expect(component.tapCount).toBe(1);
    });

    it('does not emit tap when enableTap is off', () => {
        component.mode = 'press';
        component.enableTap = false;
        component.longPressMs = 400;
        syncFixture();
        now = 8000;

        dispatchPointerEvent(hostEl, 'pointerdown', { clientX: 20, clientY: 20, pointerId: POINTER_ID, pointerType: 'touch' });
        now = 8050;
        dispatchPointerEvent(hostEl, 'pointerup', { clientX: 20, clientY: 20, pointerId: POINTER_ID, pointerType: 'touch' });

        expect(component.tapCount).toBe(0);
    });

    it('does not emit tap when the release comes after the long-press threshold', () => {
        component.mode = 'press';
        component.enableTap = true;
        component.enableDoubleTap = false;
        component.longPressMs = 80;
        syncFixture();
        now = 9000;

        dispatchPointerEvent(hostEl, 'pointerdown', { clientX: 20, clientY: 20, pointerId: POINTER_ID, pointerType: 'touch' });
        now = 9200; // 200ms > 80ms long-press threshold
        dispatchPointerEvent(hostEl, 'pointerup', { clientX: 20, clientY: 20, pointerId: POINTER_ID, pointerType: 'touch' });

        expect(component.tapCount).toBe(0);
    });

    it('suppresses gestures when multi-pointer is active', async () => {
        component.mode = 'press';
        component.longPressMs = 80;
        syncFixture();
        now = 6000;
        let pressCount = 0;
        let doubleTapCount = 0;
        hostEl.addEventListener('press', () => { pressCount += 1; });
        hostEl.addEventListener('doubletap', () => { doubleTapCount += 1; });

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        dispatchPointerEvent(hostEl, 'pointerdown', {
            clientX: 10,
            clientY: 10,
            pointerId: 1,
            pointerType: 'touch'
        });

        dispatchPointerEvent(hostEl, 'pointerdown', {
            clientX: 12,
            clientY: 12,
            pointerId: 2,
            pointerType: 'touch'
        });

        await vi.advanceTimersByTimeAsync(100);
        vi.useRealTimers();

        expect(pressCount).toBe(0);
        expect(doubleTapCount).toBe(0);
    });

    // A gesture that starts on a form control must not be recognised: capture is taken on the event
    // target and pointerdown is preventDefault()ed, which on WebKit stops the control focusing and
    // stops a date/time picker opening at all.
    describe('native form controls', () => {
        const inputEl = () => hostEl.querySelector('input.probe-input') as HTMLInputElement;

        it('does not preventDefault a pointerdown on an input', () => {
            component.mode = 'press';
            syncFixture();
            const event = createPointerEvent('pointerdown', {
                clientX: 10, clientY: 10, pointerId: POINTER_ID, pointerType: 'touch'
            });
            inputEl().dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
        });

        it('does not capture the pointer on an input', () => {
            component.mode = 'press';
            syncFixture();
            const input = inputEl();
            let captured = false;
            input.setPointerCapture = () => { captured = true; };
            dispatchPointerEvent(input, 'pointerdown', {
                clientX: 10, clientY: 10, pointerId: POINTER_ID, pointerType: 'touch'
            });
            expect(captured).toBe(false);
        });

        it('fires no long press from a hold that starts on an input', async () => {
            component.mode = 'press';
            component.longPressMs = 80;
            syncFixture();
            now = 2000;
            let pressCount = 0;
            hostEl.addEventListener('press', () => { pressCount += 1; });
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
            dispatchPointerEvent(inputEl(), 'pointerdown', {
                clientX: 10, clientY: 10, pointerId: POINTER_ID, pointerType: 'touch'
            });
            await vi.advanceTimersByTimeAsync(200);
            vi.useRealTimers();
            expect(pressCount).toBe(0);
        });
    });
});
