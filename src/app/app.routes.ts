import { Routes } from '@angular/router';
import { DashboardComponent } from './core/components/dashboard/dashboard.component';

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
  {
    path: 'settings',
    loadComponent: () => import('./core/components/settings/settings.component').then(m => m.SettingsComponent),
    title: 'KIP - Settings'
  },
  {
    path: 'options',
    loadComponent: () => import('./core/components/options/tabs/tabs.component').then(m => m.TabsComponent),
    title: 'Skip - Settings'
  },
  {
    path: 'remote',
    loadComponent: () => import('./core/components/remote-control/remote-control.component').then(m => m.RemoteControlComponent),
    title: 'Skip - Remote Control'
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
    path: 'data',
    loadComponent: () => import('./core/components/data-inspector/data-inspector.component').then(m => m.DataInspectorComponent),
    title: 'Skip - Data Inspector'
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
