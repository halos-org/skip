import { Routes } from '@angular/router';
import { DashboardComponent } from './core/components/dashboard/dashboard.component';
import { embedBlockedGuard } from './core/guards/embed-route.guard';
import { embedRequiredGuard } from './core/guards/embed-required-route.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'page/0',
    pathMatch: 'full'
  },
  {
    path: 'page',
    redirectTo: 'page/0',
    pathMatch: 'full'
  },
  {
    path: 'page/:id',
    component: DashboardComponent
  },
  // Backward-compat for the pre-rename /dashboard route (bookmarks, kiosk configs).
  {
    path: 'dashboard',
    redirectTo: 'page/0',
    pathMatch: 'full'
  },
  {
    path: 'dashboard/:id',
    redirectTo: route => `/page/${route.params['id']}`
  },
  // The Actions page is retired (#390): app navigation moved to the toolbar menu and page
  // management to Edit mode. Redirect stale bookmarks/deep links to the dashboard.
  {
    path: 'actions',
    redirectTo: 'page/0',
    pathMatch: 'full'
  },
  {
    path: 'settings',
    canActivate: [embedBlockedGuard],
    loadComponent: () => import('./core/components/settings/tabs/tabs.component').then(m => m.TabsComponent),
    title: 'Skip - Settings'
  },
  {
    path: 'remote',
    canActivate: [embedBlockedGuard],
    loadComponent: () => import('./core/components/remote-control/remote-control.component').then(m => m.RemoteControlComponent),
    title: 'Skip - Remote Control'
  },
  {
    path: 'connection',
    canActivate: [embedBlockedGuard],
    loadComponent: () => import('./core/components/connection-status/connection-status.component').then(m => m.ConnectionStatusComponent),
    title: 'Skip - Connection'
  },
  // Single-widget host for plotter-extension widget iframes: renders one widget full-bleed, no
  // dashboard chrome (see SingleWidgetHostComponent). The type is the widget's component selector.
  // Embed-only, so read-only is route-enforced (under embed the dashboard is force-locked).
  {
    path: 'widget/:type',
    canActivate: [embedRequiredGuard],
    loadComponent: () => import('./core/components/single-widget-host/single-widget-host.component').then(m => m.SingleWidgetHostComponent),
    title: 'Skip - Widget'
  },
  // Settings panel iframe for a plotter-extension widget: reuses the widget-options UI over the bus.
  {
    path: 'widget-config/:type',
    canActivate: [embedRequiredGuard],
    loadComponent: () => import('./core/components/widget-config-panel/widget-config-panel.component').then(m => m.WidgetConfigPanelComponent),
    title: 'Skip - Widget settings'
  },
  {
    path: 'help/:page',
    loadComponent: () => import('./core/components/app-help/app-help.component').then(m => m.AppHelpComponent),
    title: 'Skip - Help'
  },
  {
    path: 'help',
    loadComponent: () => import('./core/components/app-help/app-help.component').then(m => m.AppHelpComponent),
    title: 'Skip - Help'
  },
  {
    path: 'login',
    loadComponent: () => import('./widgets/widget-login/widget-login.component').then(m => m.WidgetLoginComponent),
    title: 'Login'
  },
  {
    path: '**',
    redirectTo: 'page/0'
  }
];
