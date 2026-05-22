import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
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
import { buildCacheKey, CacheEntry, clearCacheByPrefix, readCache, SHORT_READ_CACHE_TTL_MS, writeCache } from '../cache-utils';

export interface UserFilters {
  limit: number;
  next?: number;
  status?: UserStatus;
  role?: UserRole;
  companyId?: number;
  email?: string;
  phone?: string;
  fullName?: string;
  /** Generic search; depends on API support */
  search?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly usersCache = new Map<string, CacheEntry<UserListResponse>>();

  constructor(private http: HttpClient) {}

  getUsers(filters: UserFilters): Observable<UserListResponse> {
    const params: Record<string, string> = { limit: String(filters.limit) };
    if (filters.next !== undefined && filters.next !== null) params['next'] = String(filters.next);
    if (filters.status) params['status'] = filters.status;
    if (filters.role) params['role'] = filters.role;
    if (filters.companyId) params['companyId'] = String(filters.companyId);
    if (filters.email) params['email'] = filters.email;
    if (filters.phone) params['phone'] = filters.phone;
    if (filters.fullName) params['fullName'] = filters.fullName;
    if (filters.search) params['search'] = filters.search;

    const cacheKey = buildCacheKey('user-list', params);
    const cached = readCache(this.usersCache, cacheKey);
    if (cached) return of(cached);

    return this.http
      .get<UserListResponse>(`${constant.baseUrl}/super-admin/user`, {
        params,
      })
      .pipe(tap((res) => writeCache(this.usersCache, cacheKey, res, SHORT_READ_CACHE_TTL_MS)));
  }

  createUser(payload: CreateUserBody): Observable<CreateUserResponse> {
    return this.http
      .post<CreateUserResponse>(`${constant.baseUrl}/super-admin/user`, payload)
      .pipe(tap(() => clearCacheByPrefix(this.usersCache, 'user-list')));
  }

  updateUser(userId: number, payload: UpdateUserBody): Observable<UpdateUserResponse> {
    return this.http
      .put<UpdateUserResponse>(`${constant.baseUrl}/super-admin/user/${userId}`, payload)
      .pipe(tap(() => clearCacheByPrefix(this.usersCache, 'user-list')));
  }

  deleteUser(userId: number): Observable<DeleteUserResponse> {
    return this.http
      .delete<DeleteUserResponse>(`${constant.baseUrl}/super-admin/user/${userId}`)
      .pipe(tap(() => clearCacheByPrefix(this.usersCache, 'user-list')));
  }

  updatePassword(userId: number, password: string): Observable<UpdateUserPasswordResponse> {
    return this.http.put<UpdateUserPasswordResponse>(
      `${constant.baseUrl}/super-admin/user/${userId}/password`,
      { password },
    );
  }
}
