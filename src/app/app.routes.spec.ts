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

describe('app.routes default-dashboard normalization', () => {
  let router: Router;

  beforeEach(async () => {
    const testRoutes: Route[] = routes.map((route) => {
      if (route.path === 'dashboard/:id') {
        return { ...route, component: TestRouteTargetComponent };
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

  it('redirects the root URL to /dashboard/0', async () => {
    await router.navigateByUrl('/');
    expect(router.url).toBe('/dashboard/0');
  });

  it('redirects /dashboard without an id to /dashboard/0', async () => {
    await router.navigateByUrl('/dashboard');
    expect(router.url).toBe('/dashboard/0');
  });

  it('keeps /dashboard/:id as-is', async () => {
    await router.navigateByUrl('/dashboard/7');
    expect(router.url).toBe('/dashboard/7');
  });

  it('redirects an unknown URL (including a stale /chartplotter link) to /dashboard/0', async () => {
    await router.navigateByUrl('/chartplotter/2');
    expect(router.url).toBe('/dashboard/0');
  });
});
