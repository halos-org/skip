import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uiEventService } from './uiEvent.service';

describe('uiEventService', () => {
  let service: uiEventService;

  const injectFakeNoSleep = () => {
    const noSleep = { enable: vi.fn(), disable: vi.fn() };
    (service as unknown as { noSleep: typeof noSleep }).noSleep = noSleep;
    service.noSleepSupported.set(true);
    return noSleep;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(uiEventService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('setKeepAwake no-ops when the wake lock is unsupported (#359)', () => {
    service.noSleepSupported.set(false);
    service.setKeepAwake(true);
    expect(service.noSleepStatus()).toBe(false);
  });

  it('setKeepAwake enables, is idempotent, then disables the wake lock (#359)', () => {
    const noSleep = injectFakeNoSleep();

    service.setKeepAwake(true);
    expect(noSleep.enable).toHaveBeenCalledTimes(1);
    expect(service.noSleepStatus()).toBe(true);

    service.setKeepAwake(true); // already on — no redundant enable
    expect(noSleep.enable).toHaveBeenCalledTimes(1);

    service.setKeepAwake(false);
    expect(noSleep.disable).toHaveBeenCalledTimes(1);
    expect(service.noSleepStatus()).toBe(false);
  });

  it('toggleFullScreen never touches the wake lock (decoupled, #359)', () => {
    const noSleep = injectFakeNoSleep();
    service.toggleFullScreen();
    expect(noSleep.enable).not.toHaveBeenCalled();
    expect(noSleep.disable).not.toHaveBeenCalled();
    expect(service.noSleepStatus()).toBe(false);
  });
});
