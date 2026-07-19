import { afterEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import type { DestroyRef } from '@angular/core';
import { States } from '../../core/interfaces/signalk-interfaces';
import { ElectricalIngestScheduler } from './electrical-ingest-scheduler';
import type { DataService, IPathUpdateWithPath } from '../../core/services/data.service';

interface TestEntry {
  id: string;
  key: string;
  value: unknown;
}

interface TestSnapshot {
  tag: string;
}

const makeUpdate = (path: string, value: unknown): IPathUpdateWithPath => ({
  path,
  update: {
    data: { value, timestamp: new Date('2026-01-01T00:00:00.000Z') },
    state: States.Normal
  }
});

const parseUpdate = (update: IPathUpdateWithPath): { key: string; entry: TestEntry } | null => {
  const match = update.path.match(/\.([^.]+)\.([^.]+)$/);
  if (!match) return null;
  return {
    key: `${match[1]}::${match[2]}`,
    entry: { id: match[1], key: match[2], value: update.update?.data?.value ?? null }
  };
};

const makeDestroyRef = (): { ref: DestroyRef; destroy: () => void } => {
  const callbacks: (() => void)[] = [];
  const ref = { onDestroy: (cb: () => void) => { callbacks.push(cb); return () => undefined; } } as unknown as DestroyRef;
  return { ref, destroy: () => callbacks.slice().forEach(cb => cb()) };
};

interface Harness {
  scheduler: ElectricalIngestScheduler<TestEntry, TestSnapshot>;
  onFlush: ReturnType<typeof vi.fn>;
  draw: ReturnType<typeof vi.fn>;
  live: Subject<IPathUpdateWithPath>;
  destroy: () => void;
  setReady: (ready: boolean) => void;
}

const setup = (initial: IPathUpdateWithPath[] = []): Harness => {
  const live = new Subject<IPathUpdateWithPath>();
  const data = {
    subscribePathTreeWithInitial: vi.fn().mockReturnValue({ initial, live$: live.asObservable() })
  } as unknown as DataService;
  const { ref, destroy } = makeDestroyRef();
  const onFlush = vi.fn();
  const draw = vi.fn();
  let ready = true;

  const scheduler = new ElectricalIngestScheduler<TestEntry, TestSnapshot>({
    data,
    destroyRef: ref,
    rootPattern: 'self.electrical.x.*',
    batchWindowMs: 500,
    parseUpdate,
    onFlush,
    resolveRenderSnapshot: explicit => (ready ? (explicit ?? { tag: 'default' }) : null),
    draw
  });

  return { scheduler, onFlush, draw, live, destroy, setReady: value => { ready = value; } };
};

describe('ElectricalIngestScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('drains the initial tree synchronously in one flush with no timer', () => {
    vi.useFakeTimers();
    const { onFlush } = setup([
      makeUpdate('self.electrical.x.a1.voltage', 12),
      makeUpdate('self.electrical.x.a1.current', 3)
    ]);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual([
      { id: 'a1', key: 'voltage', value: 12 },
      { id: 'a1', key: 'current', value: 3 }
    ]);
  });

  it('flushes the first live update immediately, then batches subsequent ones at the window', async () => {
    vi.useFakeTimers();
    const { onFlush, live } = setup();
    expect(onFlush).not.toHaveBeenCalled();

    live.next(makeUpdate('self.electrical.x.a1.voltage', 12));
    expect(onFlush).toHaveBeenCalledTimes(1); // immediate, no advance

    live.next(makeUpdate('self.electrical.x.a1.current', 3));
    await vi.advanceTimersByTimeAsync(499);
    expect(onFlush).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('coalesces same-key updates within the window, keeping the last value', async () => {
    vi.useFakeTimers();
    const { onFlush, live } = setup([makeUpdate('self.electrical.x.a1.name', 'n')]); // initial drain arms initialPaintDone
    onFlush.mockClear();

    live.next(makeUpdate('self.electrical.x.a1.voltage', 10));
    live.next(makeUpdate('self.electrical.x.a1.voltage', 20));
    await vi.advanceTimersByTimeAsync(500);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual([{ id: 'a1', key: 'voltage', value: 20 }]);
  });

  it('coalesces render requests into one frame carrying the last snapshot', async () => {
    vi.useFakeTimers();
    const { scheduler, draw } = setup();

    scheduler.requestRender({ tag: 'a' });
    scheduler.requestRender({ tag: 'b' });
    expect(draw).not.toHaveBeenCalled(); // frame pending

    await vi.runAllTimersAsync();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledWith({ tag: 'b' });
  });

  it('schedules no frame when the widget is not ready', async () => {
    vi.useFakeTimers();
    const { scheduler, draw, setReady } = setup();
    setReady(false);

    scheduler.requestRender({ tag: 'a' });
    await vi.runAllTimersAsync();
    expect(draw).not.toHaveBeenCalled();
  });

  it('on teardown cancels the pending batch timer and render frame', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const cancelFrameSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const { scheduler, onFlush, draw, live, destroy } = setup([makeUpdate('self.electrical.x.a1.name', 'n')]);
    onFlush.mockClear();

    live.next(makeUpdate('self.electrical.x.a1.voltage', 10)); // arms the 500ms batch timer
    scheduler.requestRender({ tag: 'a' }); // arms a render frame

    destroy();

    // Prove teardown actually cancels both — not merely that the callbacks no-op afterwards.
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(cancelFrameSpy).toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(onFlush).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();

    live.next(makeUpdate('self.electrical.x.a1.current', 3)); // stream torn down
    await vi.advanceTimersByTimeAsync(500);
    expect(onFlush).not.toHaveBeenCalled();
  });
});
