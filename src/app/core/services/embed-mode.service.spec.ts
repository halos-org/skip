import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { EmbedModeService } from './embed-mode.service';

// The service reads window.location.search ONCE at construction. jsdom (and the test harness'
// window.location shim) keep search as a writable property, so each case sets it, then constructs a
// fresh root instance to read it.
describe('EmbedModeService', () => {
  const originalSearch = window.location.search;

  function construct(search: string): EmbedModeService {
    window.location.search = search;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(EmbedModeService);
  }

  afterEach(() => {
    window.location.search = originalSearch;
  });

  it('reads embed=1 and profile=day from the pre-hash query', () => {
    const svc = construct('?embed=1&profile=day');
    expect(svc.embed()).toBe(true);
    expect(svc.profile()).toBe('day');
  });

  it('defaults to not-embedded with no profile when there is no query string', () => {
    const svc = construct('');
    expect(svc.embed()).toBe(false);
    expect(svc.profile()).toBeNull();
  });

  it('treats an empty profile value as no profile', () => {
    const svc = construct('?profile=');
    expect(svc.profile()).toBeNull();
    expect(svc.embed()).toBe(false);
  });

  it('honors embed=false as OFF', () => {
    expect(construct('?embed=false').embed()).toBe(false);
  });

  it('honors embed=0 as OFF', () => {
    expect(construct('?embed=0').embed()).toBe(false);
  });

  it('treats a valueless embed flag as ON (presence-based)', () => {
    expect(construct('?embed').embed()).toBe(true);
  });

  it('trims surrounding whitespace from the profile value', () => {
    expect(construct('?profile=%20day%20').profile()).toBe('day');
  });
});
