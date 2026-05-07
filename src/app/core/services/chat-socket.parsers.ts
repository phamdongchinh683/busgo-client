import {
  chatConversationTitle,
  chatSenderName,
  pickStr,
} from '@app/core/utils/chat-record-coerce';
import {
  ChatCallActivePayload,
  ChatCallSignalPayload,
  ChatCallStartPayload,
  ChatCallType,
  ChatRealtimeMessage,
  ChatTypingPayload,
  ChatUnreadCountPayload,
} from './chat-socket.types';

export function toSocketNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toSocketInt(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.floor(n));
}

export function normalizeCallType(v: unknown): ChatCallType {
  return v === 'video' ? 'video' : 'voice';
}

export function coerceChatRealtimePayload(raw: unknown): ChatRealtimeMessage | null {
  const o = raw as Record<string, unknown>;
  if (!o) return null;
  const boxId = o['boxId'];
  const senderId = toSocketNumber(o['senderId']);
  if (boxId === undefined || boxId === null || senderId === null) return null;

  const body = pickStr(o, 'body') ?? pickStr(o, 'message') ?? '';
  const createdAt = pickStr(o, 'createdAt');
  const senderName = chatSenderName(o);
  const title = chatConversationTitle(o);

  return {
    senderId,
    body,
    boxId: boxId as number | string,
    senderName,
    ...(createdAt ? { createdAt } : {}),
    ...(title ? { title } : {}),
  };
}

export function coerceOnlineUserIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => toSocketNumber(x)).filter((x): x is number => x !== null);
}

export function coerceTypingPayload(raw: unknown): ChatTypingPayload | null {
  const o = raw as Record<string, unknown>;
  if (!o) return null;
  const boxId = o['boxId'];
  const userId = toSocketNumber(o['userId']);
  if (boxId === undefined || boxId === null || userId === null) return null;
  return { boxId: boxId as number | string, userId };
}

export function coerceUnreadPayload(raw: unknown): ChatUnreadCountPayload | null {
  const o = raw as Record<string, unknown>;
  if (!o) return null;
  const boxId = o['boxId'];
  if (boxId === undefined || boxId === null) return null;

  const unreadCountAlias = toSocketInt(o['unreadCount']);
  const countLegacy = toSocketInt(o['count']);
  const viewerUnread = unreadCountAlias ?? countLegacy;
  const unreadReceiverCount = toSocketInt(o['unreadReceiverCount']);
  const unreadSenderCount = toSocketInt(o['unreadSenderCount']);
  const lastMessage = typeof o['lastMessage'] === 'string' ? o['lastMessage'].trim() : '';

  if (viewerUnread === undefined && unreadReceiverCount === undefined && unreadSenderCount === undefined) {
    return null;
  }

  return {
    boxId: boxId as number | string,
    ...(viewerUnread !== undefined ? { count: viewerUnread } : {}),
    ...(unreadCountAlias !== undefined ? { unreadCount: unreadCountAlias } : {}),
    ...(unreadReceiverCount !== undefined ? { unreadReceiverCount } : {}),
    ...(unreadSenderCount !== undefined ? { unreadSenderCount } : {}),
    ...(lastMessage ? { lastMessage } : {}),
  };
}

export function coerceCallStartPayload(raw: unknown): ChatCallStartPayload | null {
  const o = raw as Record<string, unknown>;
  if (!o) return null;
  const boxId = o['boxId'];
  const userId = toSocketNumber(o['userId']);
  if (boxId === undefined || boxId === null || userId === null) return null;
  return {
    userId,
    boxId: boxId as number | string,
    callType: normalizeCallType(o['callType']),
  };
}

export function coerceCallActivePayload(raw: unknown): ChatCallActivePayload | null {
  const base = coerceCallStartPayload(raw);
  if (!base) return null;
  const o = raw as Record<string, unknown>;
  const startedAtRaw = o['startedAt'];
  const startedAt = toSocketNumber(startedAtRaw);
  return {
    ...base,
    ...(startedAt !== null ? { startedAt } : {}),
  };
}

export function coerceCallSignalPayload(
  raw: unknown,
  payloadKey: 'offer' | 'answer' | 'candidate',
): ChatCallSignalPayload | null {
  const o = raw as Record<string, unknown>;
  if (!o) return null;
  const boxId = o['boxId'];
  const userId = toSocketNumber(o['userId']);
  const payload = o[payloadKey];
  if (boxId === undefined || boxId === null || userId === null || payload === undefined) return null;
  return { userId, boxId: boxId as number | string, payload };
}
