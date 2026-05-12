import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { constant } from '../../constants';
import { BalanceResponse } from '../../interfaces/balance';
import { CacheEntry, clearCacheByPrefix, readCache, writeCache } from '../cache-utils';

export interface WithdrawBalanceRequest {
  amount: number;
}

export interface WithdrawBalanceResponse {
  message: string;
  amountVnd: number;
  amountUsdCents: number;
}

export interface PayoutItem {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrival_date: number;
  created: number;
}

export interface PayoutListResponse {
  payouts: PayoutItem[];
  next: string | null;
}

export type PayoutStatus = 'paid' | 'pending' | 'in_transit' | 'canceled' | 'failed';

export interface PayoutListQuery {
  limit?: number;
  status?: PayoutStatus;
  next?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly balanceCache = new Map<string, CacheEntry<BalanceResponse>>();
  private readonly BALANCE_TTL_MS = 5 * 1000;

  constructor(private http: HttpClient) {}

  private jsonHeaders() {
    return {
      Accept: 'application/json',
    };
  }

  getBalance(): Observable<BalanceResponse> {
    const cacheKey = 'balance-overview';
    const cached = readCache(this.balanceCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get<BalanceResponse>(`${constant.baseUrl}/super-admin/balance`, {
        headers: this.jsonHeaders(),
      })
      .pipe(tap((res) => writeCache(this.balanceCache, cacheKey, res, this.BALANCE_TTL_MS)));
  }

  withdrawBalance(payload: WithdrawBalanceRequest): Observable<WithdrawBalanceResponse> {
    return this.http
      .post<WithdrawBalanceResponse>(`${constant.baseUrl}/super-admin/balance/withdraw`, payload, {
        headers: this.jsonHeaders(),
      })
      .pipe(tap(() => clearCacheByPrefix(this.balanceCache, 'balance-overview')));
  }

  getPayouts(query: PayoutListQuery = {}): Observable<PayoutListResponse> {
    let params = new HttpParams();
    if (query.limit != null) {
      params = params.set('limit', String(query.limit));
    }
    if (query.status) {
      params = params.set('status', query.status);
    }
    if (query.next) {
      params = params.set('next', query.next);
    }

    return this.http.get<PayoutListResponse>(`${constant.baseUrl}/super-admin/balance/payout`, {
      headers: this.jsonHeaders(),
      params,
    });
  }
}
