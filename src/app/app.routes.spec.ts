import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Router, Route, RouterOutlet, provideRouter } from '@angular/router';
import { routes } from './app.routes';

@Component({
  selector: 'test-route-target',
  template: ''
})
class TestRouteTargetComponent {}

@Component({
  selector: 'test-router-host',
  imports: [RouterOutlet],
  template: '<router-outlet />'
})
class TestRouterHostComponent {}

describe('app.routes default-page normalization', () => {
  let router: Router;

  beforeEach(async () => {
    const testRoutes: Route[] = routes.map((route) => {
      if (route.path === 'page/:id') {
        return { ...route, component: TestRouteTargetComponent };
      }
      if (route.path === 'actions' || route.path === 'settings' || route.path === 'connection') {
        return { path: route.path, component: TestRouteTargetComponent };
      }
      return route;
    });

    await TestBed.configureTestingModule({
      imports: [TestRouterHostComponent],
      providers: [provideRouter(testRoutes)]
    }).compileComponents();

    router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(TestRouterHostComponent);
    fixture.detectChanges();
  });

  it('redirects the root URL to /page/0', async () => {
    await router.navigateByUrl('/');
    expect(router.url).toBe('/page/0');
  });

  it('keeps /page/:id as-is', async () => {
    await router.navigateByUrl('/page/7');
    expect(router.url).toBe('/page/7');
  });

  it('redirects /page without an id to /page/0', async () => {
    await router.navigateByUrl('/page');
    expect(router.url).toBe('/page/0');
  });

  it('redirects the legacy /dashboard link to /page/0', async () => {
    await router.navigateByUrl('/dashboard');
    expect(router.url).toBe('/page/0');
  });

  it('redirects a legacy /dashboard/:id link to /page/:id, preserving the id', async () => {
    await router.navigateByUrl('/dashboard/7');
    expect(router.url).toBe('/page/7');
  });

  it('redirects an unknown URL (including a stale /chartplotter link) to /page/0', async () => {
    await router.navigateByUrl('/chartplotter/2');
    expect(router.url).toBe('/page/0');
  });

  it('resolves /actions (the renamed hub) instead of falling through to the wildcard', async () => {
    await router.navigateByUrl('/actions');
    expect(router.url).toBe('/actions');
  });

  it('resolves /settings (the renamed config page) instead of falling through to the wildcard', async () => {
    await router.navigateByUrl('/settings');
    expect(router.url).toBe('/settings');
  });

  it('resolves /connection (the relocated connection status page) instead of falling through to the wildcard', async () => {
    await router.navigateByUrl('/connection');
    expect(router.url).toBe('/connection');
  });
});
