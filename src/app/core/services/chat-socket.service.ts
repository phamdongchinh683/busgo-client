import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { socketUrl } from '@app/data/constants';
import { clearStoredCredentials, textIndicatesExpiredSession } from '@app/core/utils/auth-expiry';
import {
  chatConversationTitle,
  chatSenderName,
  pickStr,
  viewerFullNameFromStorage,
} from '@app/core/utils/chat-record-coerce';

export interface ChatRealtimeMessage {
  senderId: number;
  body: string;
  boxId: number | string;
  createdAt?: string;
  senderName: string;
  title?: string;
}

function coerceChatRealtimePayload(raw: unknown): ChatRealtimeMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const boxId = o['boxId'];
  if (boxId === undefined || boxId === null) return null;
  const senderRaw = o['senderId'];
  const senderId =
    typeof senderRaw === 'number' && Number.isFinite(senderRaw)
      ? senderRaw
      : typeof senderRaw === 'string' && senderRaw.trim() !== ''
        ? parseInt(senderRaw, 10)
        : NaN;
  if (!Number.isFinite(senderId)) return null;

  const body = pickStr(o, 'body') ?? pickStr(o, 'message') ?? '';
  const createdAt = pickStr(o, 'createdAt');
  const senderName = chatSenderName(o);
  const title = chatConversationTitle(o);

  return {
    senderId,
    body,
    boxId: boxId as number | string,
    senderName,
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(title !== undefined ? { title } : {}),
  };
}

export interface ChatUnreadCountPayload {
  boxId: number | string;
  count?: number;
  unreadCount?: number;
  unreadReceiverCount?: number;
  unreadSenderCount?: number;
  lastMessage?: string;
}

export interface ChatTypingPayload {
  userId: number;
  boxId: number | string;
}

function optNonNegativeIntSocket(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined;
  }
  return undefined;
}

function stringifySocketError(err: unknown): string {
  if (err instanceof Error) return `${err.name} ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function parseSocketUserId(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceOnlineUserIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const x of raw) {
    const id = parseSocketUserId(x);
    if (id !== null) out.push(id);
  }
  return out;
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
  private socketHandlers: Array<{ event: string; fn: (...args: unknown[]) => void }> = [];

  readonly onMessageNew$ = this.messageNew$.asObservable();
  readonly onChatNew$ = this.chatNew$.asObservable();
  readonly onChatUnreadCount$ = this.chatUnreadCount$.asObservable();
  readonly onChatTypingStart$ = this.chatTypingStart$.asObservable();
  readonly onChatTypingStop$ = this.chatTypingStop$.asObservable();

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
      // reconnection: true,
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
      const raw = args[0] as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') return;

      const boxId = raw['boxId'];
      if (boxId === undefined || boxId === null) return;

      const unreadCountAlias = optNonNegativeIntSocket(raw['unreadCount']);
      const countLegacy = optNonNegativeIntSocket(raw['count']);
      const viewerUnread =
        unreadCountAlias !== undefined ? unreadCountAlias : countLegacy !== undefined ? countLegacy : undefined;
      const unreadReceiverCount = optNonNegativeIntSocket(raw['unreadReceiverCount']);
      const unreadSenderCount = optNonNegativeIntSocket(raw['unreadSenderCount']);
      const lastMessage =
        typeof raw['lastMessage'] === 'string' && raw['lastMessage'].trim()
          ? raw['lastMessage'].trim()
          : undefined;

      if (
        viewerUnread === undefined &&
        unreadReceiverCount === undefined &&
        unreadSenderCount === undefined
      ) {
        return;
      }

      this.chatUnreadCount$.next({
        boxId: boxId as number | string,
        ...(viewerUnread !== undefined ? { count: viewerUnread } : {}),
        ...(unreadCountAlias !== undefined ? { unreadCount: unreadCountAlias } : {}),
        ...(unreadReceiverCount !== undefined ? { unreadReceiverCount } : {}),
        ...(unreadSenderCount !== undefined ? { unreadSenderCount } : {}),
        ...(lastMessage !== undefined ? { lastMessage } : {}),
      });
    };
    const onChatTypingStart = (...args: unknown[]) => {
      const raw = args[0] as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') return;
      const boxId = raw['boxId'];
      if (boxId === undefined || boxId === null) return;
      const userId = parseSocketUserId(raw['userId']);
      if (userId === null) return;
      this.chatTypingStart$.next({ userId, boxId: boxId as number | string });
    };
    const onChatTypingStop = (...args: unknown[]) => {
      const raw = args[0] as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') return;
      const boxId = raw['boxId'];
      if (boxId === undefined || boxId === null) return;
      const userId = parseSocketUserId(raw['userId']);
      if (userId === null) return;
      this.chatTypingStop$.next({ userId, boxId: boxId as number | string });
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
          ? parseSocketUserId((raw as Record<string, unknown>)['userId'])
          : null;
      if (id === null) return;
      this.onlineUserIds.update((prev: ReadonlySet<number>) => new Set([...prev, id]));
    };
    const onUserOffline = (...args: unknown[]) => {
      const raw = args[0];
      const id =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? parseSocketUserId((raw as Record<string, unknown>)['userId'])
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

  private teardownSocket(): void {
    if (!this.socket) return;
    for (const { event, fn } of this.socketHandlers) this.socket.off(event, fn);
    this.socketHandlers = [];
    this.socket.disconnect();
    this.socket = null;
    this.onlineUserIds.set(new Set());
  }
}
