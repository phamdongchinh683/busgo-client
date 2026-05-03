import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { clearStoredCredentials, textIndicatesExpiredSession } from '../utils/auth-expiry';

type ApiErrorBody = {
  errorCode?: string;
  message?: string;
};

export const authExpiredInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (shouldRedirectToLogin(error)) {
        clearStoredCredentials();

        if (router.url !== '/login') {
          void router.navigate(['/login']);
        }
      }

      return throwError(() => error);
    }),
  );
};

function shouldRedirectToLogin(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;

  const body = (error.error ?? {}) as ApiErrorBody;
  const errorCode = (body.errorCode ?? '').toLowerCase();
  const message = (typeof body.message === 'string' ? body.message : '').toLowerCase();
  const blob =
    typeof body.message === 'string'
      ? `${errorCode} ${message}`
      : `${errorCode} ${JSON.stringify(body)}`;

  if (error.status === 401) return true;
  if (errorCode === 'unauthorized') return true;
  if (textIndicatesExpiredSession(message) || textIndicatesExpiredSession(blob)) return true;

  return false;
}
