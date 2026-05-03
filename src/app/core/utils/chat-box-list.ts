import { ChatBox } from '@app/data/interfaces/chat';

export function getChatViewerUserId(): number | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as { id?: number | string };
    if (u.id === undefined || u.id === null) return null;
    const n = typeof u.id === 'string' ? parseInt(u.id, 10) : Number(u.id);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function normUnread(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.floor(x));
}

export function viewerUnreadCount(box: ChatBox, viewerId: number | null): number {
  if (viewerId === null) return 0;
  const vid = viewerId;
  const knowsR =
    box.receiverId !== undefined && box.receiverId !== null && Number.isFinite(Number(box.receiverId));
  const knowsS =
    box.senderId !== undefined && box.senderId !== null && Number.isFinite(Number(box.senderId));

  if (knowsR && Number(box.receiverId) === vid) return normUnread(box.unreadReceiverCount);
  if (knowsS && Number(box.senderId) === vid) return normUnread(box.unreadSenderCount);

  if (!knowsR && !knowsS) {
    return Math.max(normUnread(box.unreadReceiverCount), normUnread(box.unreadSenderCount));
  }

  return 0;
}

export function unreadBadgeSumForViewer(boxes: ChatBox[], viewerId: number | null): number {
  if (viewerId === null) return 0;
  let sum = 0;
  for (const b of boxes) sum += viewerUnreadCount(b, viewerId);
  return Math.min(99, sum);
}

export function patchBoxViewerUnread(box: ChatBox, count: number, viewerId: number | null): ChatBox {
  const c = Math.max(0, Math.floor(count));
  if (viewerId === box.receiverId) return { ...box, unreadReceiverCount: c };
  if (viewerId === box.senderId) return { ...box, unreadSenderCount: c };
  return { ...box, unreadReceiverCount: c };
}

function parseNextCursor(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function nextFromPayload(r: Record<string, unknown>): number | null {
  const from = (o: Record<string, unknown> | undefined): number | null =>
    o ? parseNextCursor(o['next']) : null;
  return from(r) ?? (typeof r['data'] === 'object' && r['data'] !== null && !Array.isArray(r['data'])
    ? from(r['data'] as Record<string, unknown>)
    : null);
}

function extractBoxRows(r: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(r['boxes'])) return r['boxes'];
  if (Array.isArray(r['data'])) return r['data'];
  for (const k of ['items', 'results', 'rows', 'list', 'chats', 'payload'] as const) {
    if (Array.isArray(r[k])) return r[k] as unknown[];
  }
  const data = r['data'];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d['boxes'])) return d['boxes'];
    if (Array.isArray(d['data'])) return d['data'];
    for (const k of ['boxes', 'items', 'results', 'rows', 'list', 'chats', 'payload'] as const) {
      if (Array.isArray(d[k])) return d[k] as unknown[];
    }
  }
  return null;
}

function coerceBoxId(o: Record<string, unknown>): number | null {
  const raw = o['id'] ?? o['boxId'] ?? o['chatBoxId'];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function optNonNegativeInt(record: Record<string, unknown>, key: string): number | undefined {
  const v = record[key];
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

function coerceLastMessagePreview(o: Record<string, unknown>): string | undefined {
  const keys = ['lastMessage', 'lastMessge', 'last_message', 'preview', 'snippet'] as const;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  for (const nk of ['lastMessage', 'lastMessge'] as const) {
    const nested = o[nk];
    if (nested && typeof nested === 'object') {
      const bm = (nested as Record<string, unknown>)['message'] ?? (nested as Record<string, unknown>)['body'];
      if (typeof bm === 'string' && bm.trim()) return bm.trim();
    }
  }
  return undefined;
}

function coerceLastMessageAt(o: Record<string, unknown>): string | undefined {
  const keys = [
    'lastMessageAt',
    'last_message_at',
    'updatedAt',
    'lastActivityAt',
    'last_activity_at',
  ] as const;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export function normalizeBoxItem(raw: unknown): ChatBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = coerceBoxId(o);
  if (id === null) return null;
  const titleRaw =
    (typeof o['title'] === 'string' && o['title']) ||
    (typeof o['name'] === 'string' && o['name']) ||
    (typeof o['label'] === 'string' && o['label']) ||
    (typeof o['subject'] === 'string' && o['subject']) ||
    '';
  const box: ChatBox = { id, title: titleRaw.trim() };

  const lm = coerceLastMessagePreview(o);
  const la = coerceLastMessageAt(o);
  if (lm) box.lastMessage = lm;
  if (la) box.lastMessageAt = la;

  const sid = optNonNegativeInt(o, 'senderId');
  const rid = optNonNegativeInt(o, 'receiverId');
  if (sid !== undefined) box.senderId = sid;
  if (rid !== undefined) box.receiverId = rid;

  const smc = optNonNegativeInt(o, 'senderMessageCount');
  const rmc = optNonNegativeInt(o, 'receiverMessageCount');
  const ur = optNonNegativeInt(o, 'unreadReceiverCount');
  const us = optNonNegativeInt(o, 'unreadSenderCount');
  const lms = optNonNegativeInt(o, 'lastMessageSenderId');
  if (smc !== undefined) box.senderMessageCount = smc;
  if (rmc !== undefined) box.receiverMessageCount = rmc;
  if (ur !== undefined) box.unreadReceiverCount = ur;
  if (us !== undefined) box.unreadSenderCount = us;
  if (lms !== undefined) box.lastMessageSenderId = lms;

  const sfn = o['senderFullName'];
  if (typeof sfn === 'string' && sfn.trim()) box.senderFullName = sfn.trim();

  return box;
}

export function normalizeBoxPayload(res: unknown): { boxes: ChatBox[]; next: number | null } {
  if (!res || typeof res !== 'object') return { boxes: [], next: null };
  const r = res as Record<string, unknown>;
  const rows = extractBoxRows(r);
  const boxes: ChatBox[] = [];
  if (rows) {
    for (const row of rows) {
      const b = normalizeBoxItem(row);
      if (b) boxes.push(b);
    }
  }
  return { boxes, next: nextFromPayload(r) };
}
