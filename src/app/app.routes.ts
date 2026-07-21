import { Routes } from '@angular/router';
import { DashboardComponent } from './core/components/dashboard/dashboard.component';
import { embedBlockedGuard } from './core/guards/embed-route.guard';

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
    path: 'actions',
    canActivate: [embedBlockedGuard],
    loadComponent: () => import('./core/components/actions/actions.component').then(m => m.ActionsComponent),
    title: 'Skip - Actions'
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
