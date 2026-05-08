import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { loginGuard } from './guards/login.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
    canActivate: [loginGuard],
  },
  {
    path: 'unauthorized',
    loadComponent: () => import('./pages/unauthorized/unauthorized.component').then((m) => m.UnauthorizedComponent),
  },
  {
    path: '',
    loadComponent: () => import('./layouts/main/main-layout.component').then((m) => m.MainLayoutComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'companies',
        loadComponent: () => import('./pages/company/company.component').then((m) => m.CompanyComponent),
      },
      {
        path: 'operators',
        loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
      },
      {
        path: 'promotions',
        loadComponent: () =>
          import('./pages/promotion/promotion.component').then((m) => m.PromotionComponent),
      },
      {
        path: 'users',
        loadComponent: () => import('./pages/user/user.component').then((m) => m.UserComponent),
      },
      {
        path: 'devices',
        loadComponent: () => import('./pages/device/device.component').then((m) => m.DeviceComponent),
      },
      {
        path: 'balance',
        loadComponent: () => import('./pages/balance/balance.component').then((m) => m.BalanceComponent),
      },
      {
        path: 'password',
        loadComponent: () => import('./pages/password/password.component').then((m) => m.PasswordComponent),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
