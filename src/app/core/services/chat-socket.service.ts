import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { socketUrl } from '@app/data/constants';
import { clearStoredCredentials, textIndicatesExpiredSession } from '@app/core/utils/auth-expiry';
import { viewerFullNameFromStorage } from '@app/core/utils/chat-record-coerce';
import {
  coerceCallActivePayload,
  coerceCallSignalPayload,
  coerceCallStartPayload,
  coerceChatRealtimePayload,
  coerceOnlineUserIds,
  coerceTypingPayload,
  coerceUnreadPayload,
  normalizeCallType,
  toSocketNumber,
} from './chat-socket.parsers';
export type {
  ChatCallActivePayload,
  ChatCallSignalPayload,
  ChatCallStartPayload,
  ChatCallType,
  ChatRealtimeMessage,
  ChatTypingPayload,
  ChatUnreadCountPayload,
} from './chat-socket.types';
import {
  ChatCallActivePayload,
  ChatCallSignalPayload,
  ChatCallStartPayload,
  ChatRealtimeMessage,
  ChatTypingPayload,
  ChatUnreadCountPayload,
} from './chat-socket.types';

function stringifySocketError(err: unknown): string {
  if (err instanceof Error) return `${err.name} ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  private readonly router = inject(Router);
  private socket: Socket | null = null;
  private readonly messageNew$ = new Subject<ChatRealtimeMessage>();
  private readonly chatNew$ = new Subject<ChatRealtimeMessage>();
  private readonly chatUnreadCount$ = new Subject<ChatUnreadCountPayload>();
  private readonly chatTypingStart$ = new Subject<ChatTypingPayload>();
  private readonly chatTypingStop$ = new Subject<ChatTypingPayload>();
  private readonly chatCallStart$ = new Subject<ChatCallStartPayload>();
  private readonly chatCallActive$ = new Subject<ChatCallActivePayload>();
  private readonly chatCallOffer$ = new Subject<ChatCallSignalPayload>();
  private readonly chatCallAnswer$ = new Subject<ChatCallSignalPayload>();
  private readonly chatCallIceCandidate$ = new Subject<ChatCallSignalPayload>();
  private readonly chatCallReject$ = new Subject<ChatCallStartPayload>();
  private readonly chatCallEnd$ = new Subject<ChatCallStartPayload>();
  private socketHandlers: Array<{ event: string; fn: (...args: unknown[]) => void }> = [];

  readonly onMessageNew$ = this.messageNew$.asObservable();
  readonly onChatNew$ = this.chatNew$.asObservable();
  readonly onChatUnreadCount$ = this.chatUnreadCount$.asObservable();
  readonly onChatTypingStart$ = this.chatTypingStart$.asObservable();
  readonly onChatTypingStop$ = this.chatTypingStop$.asObservable();
  readonly onChatCallStart$ = this.chatCallStart$.asObservable();
  readonly onChatCallActive$ = this.chatCallActive$.asObservable();
  readonly onChatCallOffer$ = this.chatCallOffer$.asObservable();
  readonly onChatCallAnswer$ = this.chatCallAnswer$.asObservable();
  readonly onChatCallIceCandidate$ = this.chatCallIceCandidate$.asObservable();
  readonly onChatCallReject$ = this.chatCallReject$.asObservable();
  readonly onChatCallEnd$ = this.chatCallEnd$.asObservable();

  readonly onlineUserIds = signal<ReadonlySet<number>>(new Set());

  private joinedBoxId: number | null = null;

  private readonly onSocketConnect = (): void => {
    if (this.joinedBoxId === null) return;
    this.emitChatJoin(this.joinedBoxId);
  };

  private emitChatJoin(boxId: number): void {
    this.socket?.emit('chat:join', { boxId: Number(boxId) });
  }

  private forceLogoutFromSocket(reason: string): void {
    try {
      this.socket?.io?.reconnection(false);
    } catch {
    }
    clearStoredCredentials();
    this.joinedBoxId = null;
    this.teardownSocket();
    if (this.router.url !== '/login') {
      void this.router.navigate(['/login']);
    }
  }

  private logoutIfSocketAuthFailure(source: string, err: unknown): void {
    const text = stringifySocketError(err);
    if (!textIndicatesExpiredSession(text)) return;
    this.forceLogoutFromSocket(`${source}: ${text}`);
  }

  connect(): void {
    if (!localStorage.getItem('token')) return;
    if (this.socket?.connected) return;
    if (this.socket?.active) return;

    if (this.socket) {
      this.socket.connect();
      return;
    }

    this.socket = io(socketUrl, {
      transports: ['websocket'],
      auth: (cb) => {
        const raw = localStorage.getItem('token')?.replace(/^Bearer\s+/i, '').trim() ?? '';
        cb({ token: raw });
      },
    });

    const onConnectError = (err: unknown): void => {
      this.logoutIfSocketAuthFailure('connect_error', err);
    };
    this.socket.on('connect_error', onConnectError);
    this.socketHandlers.push({ event: 'connect_error', fn: onConnectError });

    const onUnauthorized = (payload?: unknown): void => {
      this.forceLogoutFromSocket('unauthorized');
    };
    this.socket.on('unauthorized', onUnauthorized);
    this.socketHandlers.push({ event: 'unauthorized', fn: onUnauthorized });

    const onError = (payload: unknown): void => {
      if (textIndicatesExpiredSession(stringifySocketError(payload))) {
        this.logoutIfSocketAuthFailure('error', payload);
      }
    };
    this.socket.on('error', onError);
    this.socketHandlers.push({ event: 'error', fn: onError });

    this.socket.on('connect', this.onSocketConnect);
    this.socketHandlers.push({ event: 'connect', fn: this.onSocketConnect });

    const onMessageNew = (...args: unknown[]) => {
      const normalized = coerceChatRealtimePayload(args[0]);
      if (normalized) this.messageNew$.next(normalized);
    };
    const onChatNew = (...args: unknown[]) => {
      console.log('[socket][chat:new] raw payload:', args[0]);
      const normalized = coerceChatRealtimePayload(args[0]);
      if (normalized) this.chatNew$.next(normalized);
    };
    const onChatUnreadCount = (...args: unknown[]) => {
      const normalized = coerceUnreadPayload(args[0]);
      if (normalized) this.chatUnreadCount$.next(normalized);
    };
    const onChatTypingStart = (...args: unknown[]) => {
      const normalized = coerceTypingPayload(args[0]);
      if (normalized) this.chatTypingStart$.next(normalized);
    };
    const onChatTypingStop = (...args: unknown[]) => {
      const normalized = coerceTypingPayload(args[0]);
      if (normalized) this.chatTypingStop$.next(normalized);
    };
    const onChatCallStart = (...args: unknown[]) => {
      const normalized = coerceCallStartPayload(args[0]);
      if (normalized) this.chatCallStart$.next(normalized);
    };
    const onChatCallActive = (...args: unknown[]) => {
      const normalized = coerceCallActivePayload(args[0]);
      if (normalized) this.chatCallActive$.next(normalized);
    };
    const onChatCallOffer = (...args: unknown[]) => {
      const normalized = coerceCallSignalPayload(args[0], 'offer');
      if (normalized) this.chatCallOffer$.next(normalized);
    };
    const onChatCallAnswer = (...args: unknown[]) => {
      const normalized = coerceCallSignalPayload(args[0], 'answer');
      if (normalized) this.chatCallAnswer$.next(normalized);
    };
    const onChatCallIceCandidate = (...args: unknown[]) => {
      const normalized = coerceCallSignalPayload(args[0], 'candidate');
      if (normalized) this.chatCallIceCandidate$.next(normalized);
    };
    const onChatCallReject = (...args: unknown[]) => {
      const normalized = coerceCallStartPayload(args[0]);
      if (normalized) this.chatCallReject$.next(normalized);
    };
    const onChatCallEnd = (...args: unknown[]) => {
      const normalized = coerceCallStartPayload(args[0]);
      if (normalized) this.chatCallEnd$.next(normalized);
    };

    this.socket.on('message:new', onMessageNew);
    this.socketHandlers.push({ event: 'message:new', fn: onMessageNew });

    this.socket.on('chat:new', onChatNew);
    this.socketHandlers.push({ event: 'chat:new', fn: onChatNew });

    this.socket.on('chat:unread:count', onChatUnreadCount);
    this.socketHandlers.push({ event: 'chat:unread:count', fn: onChatUnreadCount });

    this.socket.on('chat:typing:start', onChatTypingStart);
    this.socketHandlers.push({ event: 'chat:typing:start', fn: onChatTypingStart });

    this.socket.on('chat:typing:stop', onChatTypingStop);
    this.socketHandlers.push({ event: 'chat:typing:stop', fn: onChatTypingStop });

    this.socket.on('chat:call:start', onChatCallStart);
    this.socketHandlers.push({ event: 'chat:call:start', fn: onChatCallStart });

    this.socket.on('chat:call:active', onChatCallActive);
    this.socketHandlers.push({ event: 'chat:call:active', fn: onChatCallActive });

    this.socket.on('chat:call:offer', onChatCallOffer);
    this.socketHandlers.push({ event: 'chat:call:offer', fn: onChatCallOffer });

    this.socket.on('chat:call:answer', onChatCallAnswer);
    this.socketHandlers.push({ event: 'chat:call:answer', fn: onChatCallAnswer });

    this.socket.on('chat:call:ice-candidate', onChatCallIceCandidate);
    this.socketHandlers.push({ event: 'chat:call:ice-candidate', fn: onChatCallIceCandidate });

    this.socket.on('chat:call:reject', onChatCallReject);
    this.socketHandlers.push({ event: 'chat:call:reject', fn: onChatCallReject });

    this.socket.on('chat:call:end', onChatCallEnd);
    this.socketHandlers.push({ event: 'chat:call:end', fn: onChatCallEnd });

    const onUsersOnline = (...args: unknown[]) => {
      const raw = args[0];
      const ids =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? coerceOnlineUserIds((raw as Record<string, unknown>)['userIds'])
          : [];
      this.onlineUserIds.set(new Set(ids));
    };
    const onUserOnline = (...args: unknown[]) => {
      const raw = args[0];
      const id =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? toSocketNumber((raw as Record<string, unknown>)['userId'])
          : null;
      if (id === null) return;
      this.onlineUserIds.update((prev: ReadonlySet<number>) => new Set([...prev, id]));
    };
    const onUserOffline = (...args: unknown[]) => {
      const raw = args[0];
      const id =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? toSocketNumber((raw as Record<string, unknown>)['userId'])
          : null;
      if (id === null) return;
      this.onlineUserIds.update((prev: ReadonlySet<number>) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    };

    this.socket.on('users:online', onUsersOnline);
    this.socketHandlers.push({ event: 'users:online', fn: onUsersOnline });

    this.socket.on('user:online', onUserOnline);
    this.socketHandlers.push({ event: 'user:online', fn: onUserOnline });

    this.socket.on('user:offline', onUserOffline);
    this.socketHandlers.push({ event: 'user:offline', fn: onUserOffline });
  }

  disconnect(): void {
    if (this.joinedBoxId !== null) this.leaveBox(this.joinedBoxId);
    this.teardownSocket();
  }

  joinBox(boxId: number): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;

    if (!this.socket?.connected) this.connect();
    const sock = this.socket;
    if (!sock) return;
    if (this.joinedBoxId !== null && this.joinedBoxId !== id) {
      this.leaveBox(this.joinedBoxId);
    }
    this.joinedBoxId = id;

    if (sock.connected) {
      this.emitChatJoin(id);
    }
  }

  leaveBox(boxId: number): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    this.socket?.emit('chat:leave', { boxId: id });
    if (this.joinedBoxId === id) this.joinedBoxId = null;
  }

  leaveJoinedRoom(): void {
    if (this.joinedBoxId === null) return;
    this.leaveBox(this.joinedBoxId);
  }

  emitMessageSend(boxId: number, body: string): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:message:send', {
      body,
      boxId: id,
      createdAt: new Date().toISOString(),
      senderName: viewerFullNameFromStorage(),
    });
  }

  emitChatRead(boxId: number): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:read', { boxId: id });
  }

  emitTypingStart(boxId: number): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:typing:start', { boxId: id });
  }

  emitTypingStop(boxId: number): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:typing:stop', { boxId: id });
  }

  emitCallStart(boxId: number, callType: string): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:call:start', { boxId: id, callType: normalizeCallType(callType) });
  }

  emitCallOffer(boxId: number, offer: unknown): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:call:offer', { boxId: id, offer });
  }

  emitCallAnswer(boxId: number, answer: unknown): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:call:answer', { boxId: id, answer });
  }

  emitCallIceCandidate(boxId: number, candidate: unknown): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:call:ice-candidate', { boxId: id, candidate });
  }

  emitCallReject(boxId: number): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:call:reject', { boxId: id });
  }

  emitCallEnd(boxId: number): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:call:end', { boxId: id });
  }

  private teardownSocket(): void {
    if (!this.socket) return;
    for (const { event, fn } of this.socketHandlers) this.socket.off(event, fn);
    this.socketHandlers = [];
    this.socket.disconnect();
    this.socket = null;
    this.onlineUserIds.set(new Set());
  }
}
