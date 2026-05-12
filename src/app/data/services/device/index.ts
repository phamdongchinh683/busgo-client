import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { constant } from '../../constants';
import { DeviceFcmToken, SaveDeviceFcmTokenBody } from '../../interfaces/device';
import { CacheEntry, clearCacheByPrefix, readCache, SHORT_READ_CACHE_TTL_MS, writeCache } from '../cache-utils';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly deviceCache = new Map<string, CacheEntry<DeviceFcmToken[]>>();

  constructor(private readonly http: HttpClient) {}

  private jsonHeaders() {
    return {
      Accept: 'application/json',
    };
  }

  getFcmTokens(): Observable<DeviceFcmToken[]> {
    const cacheKey = 'device-fcm-tokens';
    const cached = readCache(this.deviceCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get<DeviceFcmToken[]>(`${constant.baseUrl}/auth/device/fcm-token`, {
        headers: this.jsonHeaders(),
      })
      .pipe(tap((res) => writeCache(this.deviceCache, cacheKey, res, SHORT_READ_CACHE_TTL_MS)));
  }

  saveFcmToken(body: SaveDeviceFcmTokenBody): Observable<DeviceFcmToken> {
    return this.http
      .post<DeviceFcmToken>(`${constant.baseUrl}/auth/device/fcm-token`, body, {
        headers: this.jsonHeaders(),
      })
      .pipe(tap(() => clearCacheByPrefix(this.deviceCache, 'device-fcm-tokens')));
  }

  deleteFcmToken(id: number): Observable<unknown> {
    return this.http
      .delete(`${constant.baseUrl}/auth/device/fcm-token/${id}`, {
        headers: this.jsonHeaders(),
      })
      .pipe(tap(() => clearCacheByPrefix(this.deviceCache, 'device-fcm-tokens')));
  }
}
