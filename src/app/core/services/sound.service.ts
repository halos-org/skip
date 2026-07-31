import { Injectable, Signal, signal } from '@angular/core';

type AudioContextCtor = new () => AudioContext;

/**
 * Owns all app audio through the Web Audio API. Web Audio playback — unlike an
 * `HTMLAudioElement` — never spawns an Android media-session notification, which is why alarm and
 * toast sounds route through here.
 *
 * The context is created lazily on the first user gesture (or first playback) and feature-detected,
 * so in environments without Web Audio (e.g. jsdom under test) every method is an inert no-op and
 * construction never throws.
 */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private static readonly PRELOAD = ['alert', 'warn', 'alarm', 'emergency'];

  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly decoding = new Map<string, Promise<AudioBuffer | null>>();
  private current: { key: string; source: AudioBufferSourceNode } | null = null;
  private loopToken = 0;
  private unlockInstalled = false;

  private readonly _blocked = signal(false);
  /** True while a play was attempted against a suspended context (browser autoplay gate). */
  readonly blocked: Signal<boolean> = this._blocked.asReadonly();

  constructor() {
    if (this.audioCtor) this.installUnlock();
  }

  private get audioCtor(): AudioContextCtor | undefined {
    const w = window as typeof window & { webkitAudioContext?: AudioContextCtor };
    return w.AudioContext ?? w.webkitAudioContext;
  }

  /**
   * Loop `assets/<key>.mp3`. Replaces any currently looping sound; a repeat of the already-active
   * key is a no-op (guarded by the caller too). The source is started even while the context is
   * suspended so it becomes audible the moment a user gesture resumes it.
   */
  playLoop(key: string, gain = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (this.current?.key === key) return;
    this.stopLoop();
    const token = ++this.loopToken;
    this.resume(ctx);
    void this.getBuffer(key).then(buffer => {
      if (token !== this.loopToken || !buffer || !this.ctx) return;
      const source = this.play(buffer, gain, true);
      this.current = { key, source };
    });
  }

  /** Stop the active looping sound, if any. */
  stopLoop(): void {
    this.loopToken++;
    if (this.current) {
      try { this.current.source.stop(); } catch { /* already stopped */ }
      this.current.source.disconnect();
      this.current = null;
    }
  }

  /** Play `assets/<key>.mp3` once (fire-and-forget) at the given gain. */
  playOnce(key: string, gain = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.resume(ctx);
    void this.getBuffer(key).then(buffer => {
      if (!buffer || !this.ctx) return;
      const source = this.play(buffer, gain, false);
      source.onended = () => source.disconnect();
    });
  }

  private play(buffer: AudioBuffer, gain: number, loop: boolean): AudioBufferSourceNode {
    const ctx = this.ctx as AudioContext;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode).connect(ctx.destination);
    source.start();
    return source;
  }

  private ensureContext(): AudioContext | null {
    const Ctor = this.audioCtor;
    if (!Ctor) return null;
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.ctx.onstatechange = () => {
        if (this.ctx) this._blocked.set(this.ctx.state === 'suspended');
      };
      SoundService.PRELOAD.forEach(key => void this.getBuffer(key));
      this.installUnlock();
    }
    return this.ctx;
  }

  private resume(ctx: AudioContext): void {
    if (ctx.state === 'suspended') {
      this._blocked.set(true);
      void ctx.resume().catch(() => undefined);
    }
  }

  private getBuffer(key: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.decoding.get(key);
    if (pending) return pending;
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    const p = fetch(`assets/${key}.mp3`)
      .then(res => res.arrayBuffer())
      .then(data => ctx.decodeAudioData(data))
      .then(buffer => { this.buffers.set(key, buffer); this.decoding.delete(key); return buffer; })
      .catch(() => { this.decoding.delete(key); return null; });
    this.decoding.set(key, p);
    return p;
  }

  private installUnlock(): void {
    if (this.unlockInstalled) return;
    this.unlockInstalled = true;
    const handler = () => {
      const ctx = this.ensureContext();
      if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
      window.addEventListener(ev, handler, { passive: true }));
  }
}
