import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { constant } from '../../constants';
import {
  ChatBoxListResponse,
  ChatMessageListResponse,
  CreateChatBoxBody,
  SendChatMessageBody,
} from '../../interfaces/chat';

const chatBase = () => `${constant.baseUrl}/chat`;

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  private authHeaders(): { Authorization: string } {
    return { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` };
  }

  listBoxes(limit = 10, next?: number | null): Observable<ChatBoxListResponse> {
    let params = new HttpParams().set('limit', String(limit));
    if (next !== undefined && next !== null) params = params.set('next', String(next));
    return this.http.get<ChatBoxListResponse>(`${chatBase()}/box`, {
      params,
      headers: this.authHeaders(),
    });
  }

  createBox(body: CreateChatBoxBody): Observable<unknown> {
    return this.http.post(`${chatBase()}/box`, body, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  listMessages(boxId: number, limit = 10, next?: number | null): Observable<ChatMessageListResponse> {
    let params = new HttpParams().set('limit', String(limit));
    if (next !== undefined && next !== null) params = params.set('next', String(next));
    return this.http.get<ChatMessageListResponse>(`${chatBase()}/box/${boxId}/message`, {
      params,
      headers: this.authHeaders(),
    });
  }

  sendMessage(boxId: number, body: SendChatMessageBody): Observable<unknown> {
    return this.http.post(`${chatBase()}/box/${boxId}/message`, body, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }
}
