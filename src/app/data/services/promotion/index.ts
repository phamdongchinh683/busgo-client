import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { constant } from '../../constants';
import {
  PromotionListResponse,
  PromotionUpsertBody,
  PromotionUpsertResponse,
} from '../../interfaces/promotion';
import { buildCacheKey, CacheEntry, clearCacheByPrefix, readCache, SHORT_READ_CACHE_TTL_MS, writeCache } from '../cache-utils';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly promotionsCache = new Map<string, CacheEntry<PromotionListResponse>>();

  constructor(private readonly http: HttpClient) {}

  getPublicPromotions(limit: number, next?: number): Observable<PromotionListResponse> {
    const params: Record<string, string> = { limit: String(limit) };
    if (next !== undefined && next !== null) params['next'] = String(next);

    const cacheKey = buildCacheKey('promotion-list', params);
    const cached = readCache(this.promotionsCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get<PromotionListResponse>(`${constant.baseUrl}/public/promotion-new`, { params })
      .pipe(tap((res) => writeCache(this.promotionsCache, cacheKey, res, SHORT_READ_CACHE_TTL_MS)));
  }

  createPromotion(body: PromotionUpsertBody): Observable<PromotionUpsertResponse> {
    return this.http
      .post<PromotionUpsertResponse>(`${constant.baseUrl}/super-admin/promotion-new`, body)
      .pipe(tap(() => clearCacheByPrefix(this.promotionsCache, 'promotion-list')));
  }

  updatePromotion(id: number, body: PromotionUpsertBody): Observable<PromotionUpsertResponse> {
    return this.http
      .put<PromotionUpsertResponse>(`${constant.baseUrl}/super-admin/promotion-new/${id}`, body)
      .pipe(tap(() => clearCacheByPrefix(this.promotionsCache, 'promotion-list')));
  }
}
