import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { constant } from '../../constants';
import {
  NotificationListResponse,
  NotificationReadResponse,
  NotificationStatus,
  VerifyAccountRequest,
  VerifyAccountResponse,
} from '../../interfaces/notification';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  getNotifications(next?: number, status?: NotificationStatus | null): Observable<NotificationListResponse> {
    const params: Record<string, string> = { limit: '20' };
    if (next !== undefined && next !== null) params['next'] = String(next);
    if (status !== undefined && status !== null) params['status'] = String(status);

    return this.http.get<NotificationListResponse>(`${constant.baseUrl}/auth/notification`, {
      params,
    });
  }

  markAsRead(notificationId: number | string): Observable<NotificationReadResponse> {
    return this.http.put<NotificationReadResponse>(
      `${constant.baseUrl}/auth/notification/${encodeURIComponent(String(notificationId))}/read`,
      {},
    );
  }

  verifyAccount(payload: VerifyAccountRequest): Observable<VerifyAccountResponse> {
    return this.http.post<VerifyAccountResponse>(`${constant.baseUrl}/auth/verify-account`, payload);
  }
}
