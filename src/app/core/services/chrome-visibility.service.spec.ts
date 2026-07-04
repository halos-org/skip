import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHROME_BOOT_DWELL_MS,
  CHROME_IDLE_HIDE_MS,
  CHROME_PEEK_MS,
  ChromeVisibilityService,
} from './chrome-visibility.service';

describe('ChromeVisibilityService', () => {
  let service: ChromeVisibilityService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new ChromeVisibilityService();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('boots revealed and auto-hides after the boot dwell', () => {
    expect(service.revealed()).toBe(true);
    vi.advanceTimersByTime(CHROME_BOOT_DWELL_MS);
    expect(service.revealed()).toBe(false);
  });

  it('reveal() shows the toolbar and re-arms the idle hide', () => {
    vi.advanceTimersByTime(CHROME_BOOT_DWELL_MS);
    expect(service.revealed()).toBe(false);

    service.reveal();
    expect(service.revealed()).toBe(true);
    vi.advanceTimersByTime(CHROME_IDLE_HIDE_MS - 1);
    expect(service.revealed()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(service.revealed()).toBe(false);
  });

  it('a fresh reveal() resets the idle timer', () => {
    service.reveal();
    vi.advanceTimersByTime(CHROME_IDLE_HIDE_MS - 1000);
    service.reveal();
    vi.advanceTimersByTime(CHROME_IDLE_HIDE_MS - 1000);
    expect(service.revealed()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(service.revealed()).toBe(false);
  });

  it('hide() hides immediately', () => {
    expect(service.revealed()).toBe(true);
    service.hide();
    expect(service.revealed()).toBe(false);
  });

  it('pulsePeek() flashes the peek cue then clears it', () => {
    expect(service.peeking()).toBe(false);
    service.pulsePeek();
    expect(service.peeking()).toBe(true);
    vi.advanceTimersByTime(CHROME_PEEK_MS);
    expect(service.peeking()).toBe(false);
  });

  it('suppresses auto-hide and explicit hide, resuming idle-hide on allow', () => {
    service.reveal();
    service.suppressHide();

    vi.advanceTimersByTime(CHROME_IDLE_HIDE_MS * 3);
    expect(service.revealed()).toBe(true);
    service.hide();
    expect(service.revealed()).toBe(true);

    service.allowHide();
    vi.advanceTimersByTime(CHROME_IDLE_HIDE_MS);
    expect(service.revealed()).toBe(false);
  });

  it('ref-counts nested suppressors', () => {
    service.reveal();
    service.suppressHide();
    service.suppressHide();

    service.allowHide();
    service.hide();
    expect(service.revealed()).toBe(true);

    service.allowHide();
    service.hide();
    expect(service.revealed()).toBe(false);
  });
});
