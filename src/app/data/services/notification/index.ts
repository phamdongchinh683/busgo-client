import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { constant } from '../../constants';
import {
  NotificationListResponse,
  NotificationReadResponse,
  NotificationStatus,
  VerifyAccountRequest,
  VerifyAccountResponse,
} from '../../interfaces/notification';
import { buildCacheKey, CacheEntry, clearCacheByPrefix, readCache, SHORT_READ_CACHE_TTL_MS, writeCache } from '../cache-utils';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly notificationsCache = new Map<string, CacheEntry<NotificationListResponse>>();

  constructor(private readonly http: HttpClient) {}

  getNotifications(next?: number, status?: NotificationStatus | null): Observable<NotificationListResponse> {
    const params: Record<string, string> = { limit: '20' };
    if (next !== undefined && next !== null) params['next'] = String(next);
    if (status !== undefined && status !== null) params['status'] = String(status);

    const cacheKey = buildCacheKey('notification-list', params);
    const cached = readCache(this.notificationsCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get<NotificationListResponse>(`${constant.baseUrl}/auth/notification`, {
        params,
      })
      .pipe(tap((res) => writeCache(this.notificationsCache, cacheKey, res, SHORT_READ_CACHE_TTL_MS)));
  }

  markAsRead(notificationId: number | string): Observable<NotificationReadResponse> {
    return this.http
      .put<NotificationReadResponse>(
        `${constant.baseUrl}/auth/notification/${encodeURIComponent(String(notificationId))}/read`,
        {},
      )
      .pipe(tap(() => clearCacheByPrefix(this.notificationsCache, 'notification-list')));
  }

  verifyAccount(payload: VerifyAccountRequest): Observable<VerifyAccountResponse> {
    return this.http.post<VerifyAccountResponse>(`${constant.baseUrl}/auth/verify-account`, payload);
  }
}
