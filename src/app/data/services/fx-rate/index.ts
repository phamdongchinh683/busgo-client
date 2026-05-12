import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { FxRatesLatestResponse } from '../../interfaces/fx-rates';
import { CacheEntry, readCache, SHORT_READ_CACHE_TTL_MS, writeCache } from '../cache-utils';

const FX_RATES_LATEST = 'https://api.fxratesapi.com/latest';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly rateCache = new Map<string, CacheEntry<number>>();

  constructor(private http: HttpClient) {}

  getUsdVndRate(): Observable<number> {
    const cacheKey = 'usd-vnd';
    const cached = readCache(this.rateCache, cacheKey);
    if (cached !== null) return of(cached);

    return this.http.get<FxRatesLatestResponse>(FX_RATES_LATEST).pipe(
      map((res) => {
        const vnd = res.rates?.['VND'];
        if (typeof vnd !== 'number' || !Number.isFinite(vnd) || vnd <= 0) {
          throw new Error('Invalid VND rate');
        }
        return vnd;
      }),
      tap((rate) => writeCache(this.rateCache, cacheKey, rate, SHORT_READ_CACHE_TTL_MS)),
    );
  }
}
