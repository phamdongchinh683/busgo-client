import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { constant } from '../../constants';
import { CompanyListResponse, CreateCompanyResponse } from '../../interfaces/company';
import { buildCacheKey, CacheEntry, clearCacheByPrefix, readCache, writeCache } from '../cache-utils';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly companiesCache = new Map<string, CacheEntry<CompanyListResponse>>();
  private readonly COMPANIES_TTL_MS = 15 * 1000;

  constructor(private http: HttpClient) {}

  getCompanies(limit: number, next?: number, name?: string): Observable<CompanyListResponse> {
    const params: Record<string, string> = { limit: String(limit) };
    if (next !== undefined && next !== null) params['next'] = String(next);
    if (name) params['name'] = name;

    const cacheKey = buildCacheKey('company-list', params);
    const cached = readCache(this.companiesCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get<CompanyListResponse>(`${constant.baseUrl}/super-admin/bus-company`, {
        params,
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
      .pipe(tap((res) => writeCache(this.companiesCache, cacheKey, res, this.COMPANIES_TTL_MS)));
  }

  createCompany(
    name: string,
    hotline: string,
    logoUrl: string,
    address: string,
    latitude?: number,
    longitude?: number,
  ): Observable<CreateCompanyResponse> {
    return this.http
      .post<CreateCompanyResponse>(
      `${constant.baseUrl}/super-admin/bus-company`,
      {
        name,
        hotline,
        logoUrl,
        address,
        latitude,
        longitude,
      },
      {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      },
      )
      .pipe(tap(() => clearCacheByPrefix(this.companiesCache, 'company-list')));
  }

  updateCompany(
    id: number,
    data: Partial<{ name: string; hotline: string; logoUrl: string; address: string; latitude: number | null; longitude: number | null }>,
  ): Observable<CreateCompanyResponse> {
    return this.http
      .put<CreateCompanyResponse>(`${constant.baseUrl}/super-admin/bus-company/${id}`, data, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
      .pipe(tap(() => clearCacheByPrefix(this.companiesCache, 'company-list')));
  }

  deleteCompany(id: number): Observable<CreateCompanyResponse> {
    return this.http
      .delete<CreateCompanyResponse>(`${constant.baseUrl}/super-admin/bus-company/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
      .pipe(tap(() => clearCacheByPrefix(this.companiesCache, 'company-list')));
  }
}
