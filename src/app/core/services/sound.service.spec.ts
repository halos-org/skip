import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundService } from './sound.service';

class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  disconnect = vi.fn();
  connect = vi.fn((node: unknown) => node);
}

class FakeGain {
  gain = { value: 1 };
  connect = vi.fn((node: unknown) => node);
  disconnect = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static autoResume = true;
  static decodeFailures = 0; // number of initial decodeAudioData calls that reject

  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  sources: FakeSource[] = [];

  constructor() { FakeAudioContext.instances.push(this); }

  createBufferSource(): FakeSource { const s = new FakeSource(); this.sources.push(s); return s; }
  createGain(): FakeGain { return new FakeGain(); }
  decodeAudioData = vi.fn(async () => {
    if (FakeAudioContext.decodeFailures > 0) { FakeAudioContext.decodeFailures--; throw new Error('decode failed'); }
    return {} as AudioBuffer;
  });
  resume = vi.fn(async () => {
    if (FakeAudioContext.autoResume) { this.state = 'running'; this.onstatechange?.(); }
  });
  close = vi.fn();
}

function stubWebAudio(): void {
  FakeAudioContext.instances = [];
  FakeAudioContext.autoResume = true;
  vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext);
  vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) } as Response)));
}

function ctx(): FakeAudioContext { return FakeAudioContext.instances[0]; }

describe('SoundService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeAudioContext.instances = [];
    FakeAudioContext.autoResume = true;
    FakeAudioContext.decodeFailures = 0;
  });

  describe('without Web Audio support', () => {
    it('is inert: no context, no throw', () => {
      const svc = new SoundService();
      expect(() => { svc.playLoop('alarm'); svc.playOnce('notification', 0.3); svc.stopLoop(); }).not.toThrow();
      expect(FakeAudioContext.instances).toHaveLength(0);
      expect(svc.blocked()).toBe(false);
    });
  });

  describe('with Web Audio', () => {
    it('decodes and starts a looping source', async () => {
      stubWebAudio();
      const svc = new SoundService();
      svc.playLoop('alarm', 1);
      await vi.waitFor(() => expect(ctx().sources.at(-1)?.start).toHaveBeenCalled());
      const source = ctx().sources.at(-1)!;
      expect(source.loop).toBe(true);
      expect(fetch).toHaveBeenCalledWith('assets/alarm.mp3');
    });

    it('is a no-op when the same key is already looping', async () => {
      stubWebAudio();
      const svc = new SoundService();
      svc.playLoop('alarm');
      await vi.waitFor(() => expect(ctx().sources.at(-1)?.start).toHaveBeenCalled());
      const countAfterFirst = ctx().sources.length;
      svc.playLoop('alarm');
      expect(ctx().sources.length).toBe(countAfterFirst);
    });

    it('replaces the current loop when the key changes', async () => {
      stubWebAudio();
      const svc = new SoundService();
      svc.playLoop('alarm');
      await vi.waitFor(() => expect(ctx().sources.at(-1)?.start).toHaveBeenCalled());
      const first = ctx().sources.at(-1)!;
      svc.playLoop('emergency');
      await vi.waitFor(() => expect(ctx().sources.length).toBe(2));
      expect(first.stop).toHaveBeenCalled();
      expect(ctx().sources.at(-1)!.start).toHaveBeenCalled();
    });

    it('starts the source even while the context is suspended, and flags blocked', async () => {
      stubWebAudio();
      FakeAudioContext.autoResume = false; // gesture has not unlocked the context yet
      const svc = new SoundService();
      svc.playLoop('alarm');
      expect(svc.blocked()).toBe(true);
      await vi.waitFor(() => expect(ctx().sources.at(-1)?.start).toHaveBeenCalled());
      expect(ctx().state).toBe('suspended');
    });

    it('clears blocked when the context resumes', async () => {
      stubWebAudio();
      FakeAudioContext.autoResume = false;
      const svc = new SoundService();
      svc.playLoop('alarm');
      expect(svc.blocked()).toBe(true);
      ctx().state = 'running';
      ctx().onstatechange?.();
      expect(svc.blocked()).toBe(false);
    });

    it('stopLoop stops the active source', async () => {
      stubWebAudio();
      const svc = new SoundService();
      svc.playLoop('alarm');
      await vi.waitFor(() => expect(ctx().sources.at(-1)?.start).toHaveBeenCalled());
      const source = ctx().sources.at(-1)!;
      svc.stopLoop();
      expect(source.stop).toHaveBeenCalled();
    });

    it('retries a transient decode failure and eventually starts the loop', async () => {
      stubWebAudio();
      FakeAudioContext.decodeFailures = 1; // first decode rejects; the retry must recover
      const svc = new SoundService();
      svc.playLoop('alarm');
      await vi.waitFor(() => expect(ctx().sources.at(-1)?.start).toHaveBeenCalled(), { timeout: 2000 });
      expect(ctx().sources.at(-1)!.loop).toBe(true);
    });

    it('plays a one-shot that does not loop and disconnects when it ends', async () => {
      stubWebAudio();
      const svc = new SoundService();
      svc.playOnce('notification', 0.3);
      await vi.waitFor(() => expect(ctx().sources.at(-1)?.start).toHaveBeenCalled());
      const source = ctx().sources.at(-1)!;
      expect(source.loop).toBe(false);
      source.onended?.();
      expect(source.disconnect).toHaveBeenCalled();
    });
  });
});
