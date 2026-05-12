import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { constant } from '../../constants';
import { DashboardResponse } from '../../interfaces/dashboard';
import type { RevenueExportQuery } from '../../interfaces/dashboard/revenue-export';
import type { DashboardStatsQuery } from '../../interfaces/dashboard/stats';
import { buildCacheKey, CacheEntry, readCache, writeCache } from '../cache-utils';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly dashboardOverviewCache = new Map<string, CacheEntry<DashboardResponse>>();
  private readonly dashboardStatsCache = new Map<string, CacheEntry<unknown>>();
  private readonly DASHBOARD_TTL_MS = 15 * 1000;

  constructor(private http: HttpClient) {}

  private jsonHeaders() {
    return {
      Accept: 'application/json',
    };
  }

  private exportHeaders() {
    return {
      Accept:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream, application/json, */*',
    };
  }

  private revenueExportParams(q: RevenueExportQuery): HttpParams {
    return new HttpParams()
      .set('type', q.type)
      .set('method', q.method)
      .set('year', String(q.year));
  }

  private statsParams(q: DashboardStatsQuery): HttpParams {
    let p = new HttpParams().set('type', q.type);
    if (q.year != null && q.year !== undefined) p = p.set('year', String(q.year));
    if (q.month != null && q.month !== undefined) p = p.set('month', String(q.month));
    if (q.status) p = p.set('status', q.status);
    if (q.role) p = p.set('role', q.role);
    if (q.method) p = p.set('method', q.method);
    return p;
  }

  getDashboard(): Observable<DashboardResponse> {
    const cacheKey = 'dashboard-overview';
    const cached = readCache(this.dashboardOverviewCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get<DashboardResponse>(`${constant.baseUrl}/super-admin/dashboard`, {
        headers: this.jsonHeaders(),
      })
      .pipe(tap((res) => writeCache(this.dashboardOverviewCache, cacheKey, res, this.DASHBOARD_TTL_MS)));
  }

  getDashboardBooking(q: DashboardStatsQuery): Observable<unknown> {
    const params = this.statsParams(q);
    const cacheKey = buildCacheKey('dashboard-booking', {
      type: q.type,
      year: q.year,
      month: q.month,
      status: q.status,
      role: q.role,
      method: q.method,
    });
    const cached = readCache(this.dashboardStatsCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get(`${constant.baseUrl}/super-admin/dashboard/booking`, {
        headers: this.jsonHeaders(),
        params,
      })
      .pipe(tap((res) => writeCache(this.dashboardStatsCache, cacheKey, res, this.DASHBOARD_TTL_MS)));
  }

  getDashboardRevenue(q: DashboardStatsQuery): Observable<unknown> {
    const params = this.statsParams(q);
    const cacheKey = buildCacheKey('dashboard-revenue', {
      type: q.type,
      year: q.year,
      month: q.month,
      status: q.status,
      role: q.role,
      method: q.method,
    });
    const cached = readCache(this.dashboardStatsCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get(`${constant.baseUrl}/super-admin/dashboard/revenue`, {
        headers: this.jsonHeaders(),
        params,
      })
      .pipe(tap((res) => writeCache(this.dashboardStatsCache, cacheKey, res, this.DASHBOARD_TTL_MS)));
  }

  getDashboardUser(q: DashboardStatsQuery): Observable<unknown> {
    const params = this.statsParams(q);
    const cacheKey = buildCacheKey('dashboard-user', {
      type: q.type,
      year: q.year,
      month: q.month,
      status: q.status,
      role: q.role,
      method: q.method,
    });
    const cached = readCache(this.dashboardStatsCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get(`${constant.baseUrl}/super-admin/dashboard/user`, {
        headers: this.jsonHeaders(),
        params,
      })
      .pipe(tap((res) => writeCache(this.dashboardStatsCache, cacheKey, res, this.DASHBOARD_TTL_MS)));
  }

  exportRevenueReport(q: RevenueExportQuery): Observable<HttpResponse<Blob>> {
    return this.http.get(`${constant.baseUrl}/super-admin/dashboard/revenue/export`, {
      headers: this.exportHeaders(),
      params: this.revenueExportParams(q),
      responseType: 'blob',
      observe: 'response',
    });
  }
}
