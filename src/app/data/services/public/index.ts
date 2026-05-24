import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { constant, DEFAULT_PAGE_LIMIT } from '../../constants';
import { CompanyListResponse } from '../../interfaces/company';
import { buildCacheKey, CacheEntry, readCache, SHORT_READ_CACHE_TTL_MS, writeCache } from '../cache-utils';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly companiesCache = new Map<string, CacheEntry<CompanyListResponse>>();

  constructor(private http: HttpClient) {}

  getCompanies(limit = DEFAULT_PAGE_LIMIT, next?: number, name?: string): Observable<CompanyListResponse> {
    const params: Record<string, string> = { limit: String(limit) };
    if (next !== undefined && next !== null) params['next'] = String(next);
    if (name) params['name'] = name;

    const cacheKey = buildCacheKey('public-companies', params);
    const cached = readCache(this.companiesCache, cacheKey);
    if (cached) return of(cached);

    return this.http.get<CompanyListResponse>(`${constant.baseUrl}/public/company`, { params }).pipe(
      tap((res) => writeCache(this.companiesCache, cacheKey, res, SHORT_READ_CACHE_TTL_MS)),
    );
  }
}
