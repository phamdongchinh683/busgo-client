import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { constant } from '../../constants';
import {
  CreateUserBody,
  CreateUserResponse,
  DeleteUserResponse,
  UpdateUserBody,
  UpdateUserPasswordResponse,
  UpdateUserResponse,
  UserListResponse,
  UserRole,
  UserStatus,
} from '../../interfaces/user';

export interface UserFilters {
  limit: number;
  next?: number;
  status?: UserStatus;
  role?: UserRole;
  companyId?: number;
  email?: string;
  phone?: string;
  /** Partial match; depends on API support */
  username?: string;
  fullName?: string;
  /** Generic search; depends on API support */
  search?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  getUsers(filters: UserFilters): Observable<UserListResponse> {
    const params: Record<string, string> = { limit: String(filters.limit) };
    if (filters.next !== undefined && filters.next !== null) params['next'] = String(filters.next);
    if (filters.status) params['status'] = filters.status;
    if (filters.role) params['role'] = filters.role;
    if (filters.companyId) params['companyId'] = String(filters.companyId);
    if (filters.email) params['email'] = filters.email;
    if (filters.phone) params['phone'] = filters.phone;
    if (filters.username) params['username'] = filters.username;
    if (filters.fullName) params['fullName'] = filters.fullName;
    if (filters.search) params['search'] = filters.search;

    return this.http.get<UserListResponse>(`${constant.baseUrl}/super-admin/user`, {
      params,
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
  }

  createUser(payload: CreateUserBody): Observable<CreateUserResponse> {
    return this.http.post<CreateUserResponse>(`${constant.baseUrl}/super-admin/user`, payload, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
  }

  updateUser(userId: number, payload: UpdateUserBody): Observable<UpdateUserResponse> {
    return this.http.put<UpdateUserResponse>(`${constant.baseUrl}/super-admin/user/${userId}`, payload, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
  }

  deleteUser(userId: number): Observable<DeleteUserResponse> {
    return this.http.delete<DeleteUserResponse>(`${constant.baseUrl}/super-admin/user/${userId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
  }

  updatePassword(userId: number, password: string): Observable<UpdateUserPasswordResponse> {
    return this.http.put<UpdateUserPasswordResponse>(
      `${constant.baseUrl}/super-admin/user/${userId}/password`,
      { password },
      { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } },
    );
  }
}
