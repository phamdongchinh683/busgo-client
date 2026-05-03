import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { socketUrl } from '@app/data/constants';
import { clearStoredCredentials, textIndicatesExpiredSession } from '@app/core/utils/auth-expiry';

export interface ChatRealtimeMessage {
  senderId: number;
  body: string;
  boxId: number | string;
  createdAt?: string;
  title?: string;
  userIds?: number[];
}

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
  private readonly chatJoined$ = new Subject<{ boxId: number | string }>();
  private socketHandlers: Array<{ event: string; fn: (...args: unknown[]) => void }> = [];

  readonly onMessageNew$ = this.messageNew$.asObservable();
  readonly onChatNew$ = this.chatNew$.asObservable();
  readonly onChatJoined$ = this.chatJoined$.asObservable();

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
    this.teardownSocket();

    this.socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
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
      const payload = args[0] as ChatRealtimeMessage;
      this.messageNew$.next(payload);
    };
    const onChatNew = (...args: unknown[]) => {
      this.chatNew$.next(args[0] as ChatRealtimeMessage);
    };
    const onChatJoined = (...args: unknown[]) => {
      const p = args[0] as { boxId?: number | string };
      if (p?.boxId !== undefined && p?.boxId !== null) {
        this.chatJoined$.next({ boxId: p.boxId });
      }
    };

    this.socket.on('message:new', onMessageNew);
    this.socketHandlers.push({ event: 'message:new', fn: onMessageNew });

    this.socket.on('chat:new', onChatNew);
    this.socketHandlers.push({ event: 'chat:new', fn: onChatNew });

    this.socket.on('chat:joined', onChatJoined);
    this.socketHandlers.push({ event: 'chat:joined', fn: onChatJoined });
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

  emitMessageSend(boxId: number, body: string): void {
    const id = Number(boxId);
    if (!Number.isFinite(id)) return;
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('chat:message:send', {
      body,
      boxId: id,
      createdAt: new Date().toISOString(),
    });
  }

  private teardownSocket(): void {
    if (!this.socket) return;
    for (const { event, fn } of this.socketHandlers) this.socket.off(event, fn);
    this.socketHandlers = [];
    this.socket.disconnect();
    this.socket = null;
  }
}
