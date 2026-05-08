import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { constant } from '../../constants';
import {
  PromotionListResponse,
  PromotionUpsertBody,
  PromotionUpsertResponse,
} from '../../interfaces/promotion';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  getPublicPromotions(limit: number, next?: number): Observable<PromotionListResponse> {
    const params: Record<string, string> = { limit: String(limit) };
    if (next !== undefined && next !== null) params['next'] = String(next);
    return this.http.get<PromotionListResponse>(`${constant.baseUrl}/public/promotion-new`, { params });
  }

  createPromotion(body: PromotionUpsertBody): Observable<PromotionUpsertResponse> {
    return this.http.post<PromotionUpsertResponse>(`${constant.baseUrl}/super-admin/promotion-new`, body, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
  }

  updatePromotion(id: number, body: PromotionUpsertBody): Observable<PromotionUpsertResponse> {
    return this.http.put<PromotionUpsertResponse>(`${constant.baseUrl}/super-admin/promotion-new/${id}`, body, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
  }
}
