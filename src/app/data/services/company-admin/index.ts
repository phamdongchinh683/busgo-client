import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { constant } from '../../constants';
import {
  CompanyAdminListResponse,
  CreateCompanyAdminBody,
  UpdateCompanyAdminBody,
} from '../../interfaces/company-admin';
import { buildCacheKey, CacheEntry, clearCacheByPrefix, readCache, writeCache } from '../cache-utils';

export interface CompanyAdminFilters {
  limit: number;
  next?: number;
  name?: string;
  companyId?: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly adminsCache = new Map<string, CacheEntry<CompanyAdminListResponse>>();
  private readonly ADMINS_TTL_MS = 15 * 1000;

  constructor(private http: HttpClient) {}

  private authHeaders() {
    return {
      Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
      Accept: 'application/json',
    };
  }

  private jsonAuthHeaders() {
    return {
      ...this.authHeaders(),
      'Content-Type': 'application/json',
    };
  }

  getCompanyAdmins(filters: CompanyAdminFilters): Observable<CompanyAdminListResponse> {
    const params: Record<string, string> = { limit: String(filters.limit) };
    if (filters.next !== undefined && filters.next !== null) params['next'] = String(filters.next);
    if (filters.name) params['name'] = filters.name;
    if (filters.companyId !== undefined && filters.companyId !== null) params['companyId'] = String(filters.companyId);

    const cacheKey = buildCacheKey('company-admin-list', params);
    const cached = readCache(this.adminsCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get<CompanyAdminListResponse>(`${constant.baseUrl}/super-admin/company-admin`, {
        params,
        headers: this.authHeaders(),
      })
      .pipe(tap((res) => writeCache(this.adminsCache, cacheKey, res, this.ADMINS_TTL_MS)));
  }

  createCompanyAdmin(body: CreateCompanyAdminBody): Observable<{ message?: string }> {
    return this.http
      .post<{ message?: string }>(`${constant.baseUrl}/super-admin/company-admin`, body, {
        headers: this.jsonAuthHeaders(),
      })
      .pipe(tap(() => clearCacheByPrefix(this.adminsCache, 'company-admin-list')));
  }

  updateCompanyAdmin(id: number, body: UpdateCompanyAdminBody): Observable<{ message?: string }> {
    return this.http
      .put<{ message?: string }>(`${constant.baseUrl}/super-admin/company-admin/${id}`, body, {
        headers: this.jsonAuthHeaders(),
      })
      .pipe(tap(() => clearCacheByPrefix(this.adminsCache, 'company-admin-list')));
  }
}
