import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { embedBlockedGuard } from './embed-route.guard';
import { EmbedModeService } from '../services/embed-mode.service';

function runGuard(embed: boolean): { result: boolean | UrlTree; parseUrl: ReturnType<typeof vi.fn> } {
  const parseUrl = vi.fn((url: string) => ({ url } as unknown as UrlTree));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: EmbedModeService, useValue: { embed: () => embed, profile: () => null } },
      { provide: Router, useValue: { parseUrl } }
    ]
  });
  // embedBlockedGuard is synchronous; narrow CanActivateFn's MaybeAsync return to the resolved type.
  const result = TestBed.runInInjectionContext(() =>
    embedBlockedGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
  ) as boolean | UrlTree;
  return { result, parseUrl };
}

describe('embedBlockedGuard', () => {
  it('redirects to /page/0 under embed', () => {
    const { result, parseUrl } = runGuard(true);
    expect(parseUrl).toHaveBeenCalledWith('/page/0');
    expect(result).toEqual({ url: '/page/0' });
  });

  it('passes the route through when not embedded', () => {
    const { result, parseUrl } = runGuard(false);
    expect(result).toBe(true);
    expect(parseUrl).not.toHaveBeenCalled();
  });
});
