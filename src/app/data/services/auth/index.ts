import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { constant } from '../../constants';
import { AuthResponse } from '../../interfaces/auth';
import { isDigitsOnly } from '@app/shared/utils/validators';

export interface UpdatePasswordBody {
  oldPassword: string;
  newPassword: string;
}

export interface UpdatePasswordResponse {
  message: string;
}

export interface SendNotificationRequest {
  userId: number;
  title: string;
  body: string;
  data?: string;
}

export interface SendNotificationResponse {
  message?: string;
}

export interface SendOtpRequest {
  field: 'email' | 'phone';
  value: string;
}

export interface SendOtpResponse {
  message?: string;
}

export interface ResetPasswordWithOtpRequest {
  otp: string;
  email?: string;
  phone?: string;
  password: string;
}

export interface ResetPasswordWithOtpResponse {
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  signIn(input: string, password: string): Observable<AuthResponse> {
    const body: Record<string, string> = { password };

    if (isDigitsOnly(input)) {
      body['phone'] = input;
    } else if (input.includes('@')) {
      body['email'] = input;
    } else {
      body['username'] = input;
    }

    return this.http.post<AuthResponse>(`${constant.baseUrl}/super-admin/sign-in`, body);
  }

  logout(): Observable<unknown> {
    return this.http.post<unknown>(`${constant.baseUrl}/auth/logout`, {});
  }

  updatePassword(payload: UpdatePasswordBody): Observable<UpdatePasswordResponse> {
    return this.http.put<UpdatePasswordResponse>(`${constant.baseUrl}/auth/password`, payload);
  }

  sendNotification(payload: SendNotificationRequest): Observable<SendNotificationResponse> {
    return this.http.post<SendNotificationResponse>(`${constant.baseUrl}/auth/notification`, payload);
  }

  sendOtp(payload: SendOtpRequest): Observable<SendOtpResponse> {
    return this.http.post<SendOtpResponse>(`${constant.baseUrl}/auth/send-otp`, payload);
  }

  resetPasswordWithOtp(payload: ResetPasswordWithOtpRequest): Observable<ResetPasswordWithOtpResponse> {
    return this.http.put<ResetPasswordWithOtpResponse>(`${constant.baseUrl}/auth/reset-password`, payload);
  }
}
