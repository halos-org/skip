import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { embedRequiredGuard } from './embed-required-route.guard';
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
  // embedRequiredGuard is synchronous; narrow CanActivateFn's MaybeAsync return to the resolved type.
  const result = TestBed.runInInjectionContext(() =>
    embedRequiredGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
  ) as boolean | UrlTree;
  return { result, parseUrl };
}

describe('embedRequiredGuard', () => {
  it('passes the route through under embed', () => {
    const { result, parseUrl } = runGuard(true);
    expect(result).toBe(true);
    expect(parseUrl).not.toHaveBeenCalled();
  });

  it('redirects to /page/0 when not embedded', () => {
    const { result, parseUrl } = runGuard(false);
    expect(parseUrl).toHaveBeenCalledWith('/page/0');
    expect(result).toEqual({ url: '/page/0' });
  });
});
