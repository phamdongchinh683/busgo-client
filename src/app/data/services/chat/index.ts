import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { constant } from '../../constants';
import {
  ChatBoxListResponse,
  ChatMessagesListResponse,
  CreateChatBoxBody,
  SendChatMessageBody,
} from '../../interfaces/chat';

const chatBase = () => `${constant.baseUrl}/chat`;

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) { }

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

  listMessages(
    boxId: number,
    opts: { limit?: number; next?: number | null; message?: string } = {},
  ): Observable<ChatMessagesListResponse> {
    const limit = opts.limit ?? 10;
    let params = new HttpParams().set('limit', String(limit));
    if (opts.next !== undefined && opts.next !== null) {
      params = params.set('next', String(opts.next));
    }
    const q = opts.message?.trim();
    if (q) params = params.set('message', q);
    return this.http.get<ChatMessagesListResponse>(`${chatBase()}/box/${boxId}/message`, {
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

  sendMessage(boxId: number, body: SendChatMessageBody): Observable<unknown> {
    return this.http.post(`${chatBase()}/box/${boxId}/message`, body, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  recallMessage(boxId: number, messageId: number): Observable<unknown> {
    return this.http.put(`${chatBase()}/box/${boxId}/message/${messageId}`, {}, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }
}
