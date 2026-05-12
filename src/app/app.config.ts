import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { provideFirebaseApp } from '@angular/fire/app';
import { initializeApp } from 'firebase/app';
import { firebaseWebConfig } from './data/constants';
import { provideMessaging } from '@angular/fire/messaging';
import { getMessaging } from 'firebase/messaging';
import { authExpiredInterceptor } from './core/interceptors/auth-expired.interceptor';
import { authTokenInterceptor } from './core/interceptors/auth-token.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([authTokenInterceptor, authExpiredInterceptor])),
    provideFirebaseApp(() => initializeApp(firebaseWebConfig)),
    provideMessaging(() => getMessaging()),
  ],
};
