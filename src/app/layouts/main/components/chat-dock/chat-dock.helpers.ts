import { HttpErrorResponse } from '@angular/common/http';
import { ChatBox, ChatMessage } from '@app/data/interfaces/chat';
import { User } from '@app/data/interfaces/user';
import type { UserFilters } from '@app/data/services/user';

export function httpErrMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error;
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const m = (body as { message?: string }).message;
      if (typeof m === 'string' && m.trim()) return m;
    }
    if (err.status === 401 || err.status === 403) {
      return 'Phiên đăng nhập hết hạn hoặc không có quyền.';
    }
    if (err.message?.trim()) return err.message;
  }
  return '';
}

export function buildUserSearchFilters(term: string): UserFilters | null {
  const t = term.trim();
  if (t.length < 2) return null;
  if (t.includes('@')) return { limit: 20, email: t };
  const digits = t.replace(/\D/g, '');
  if (digits.length >= 9) return { limit: 20, phone: digits };
  return { limit: 25, search: t };
}

export function clientFilterUsers(users: User[], term: string): User[] {
  const q = term.trim().toLowerCase();
  if (q.length < 2) return users;
  return users.filter(
    (u) =>
      u.fullName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
      u.username.toLowerCase().includes(q),
  );
}

export function mergeUniqueBoxes(existing: ChatBox[], chunk: ChatBox[]): ChatBox[] {
  const seen = new Set(existing.map((x) => x.id));
  const merged = [...existing];
  for (const b of chunk) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    merged.push(b);
  }
  return merged;
}

export function storedFullNameOrEmpty(): string {
  try {
    const u = JSON.parse(localStorage.getItem('user') ?? '{}') as { fullName?: string };
    return u.fullName?.trim() ?? '';
  } catch {
    return '';
  }
}

export function storedUserFullName(): string {
  const raw = storedFullNameOrEmpty();
  return raw || 'Tôi';
}

export function listRowPreview(box: ChatBox, myUserId: number | null): string {
  const text = box.lastMessage?.trim();
  if (!text) return '';
  const lastSid = +box.lastMessageSenderId!;
  const labeled = myUserId !== null && lastSid === myUserId;
  const who = labeled ? storedUserFullName() : box.displayName?.trim();
  return who ? `${who}: ${text}` : text;
}

export function msgSenderId(m: ChatMessage): number {
  const n = +m.senderId;
  return n || -1;
}

export function positiveSenderId(id: unknown): number | undefined {
  const n = +(id as string | number);
  return n > 0 ? (n | 0) : undefined;
}
