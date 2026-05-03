import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, map } from 'rxjs/operators';
import { chat, user as userApi } from '@app/data/services';
import { User } from '@app/data/interfaces/user';
import { ChatBox, ChatMessage } from '@app/data/interfaces/chat';
import type { UserFilters } from '@app/data/services/user';
import { ChatDockService } from '@app/core/services/chat-dock.service';
import { ChatRealtimeMessage, ChatSocketService } from '@app/core/services/chat-socket.service';

function getCurrentUserId(): number | null {
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

function normalizeBoxItem(raw: unknown): ChatBox | null {
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
  return { id, title: titleRaw.trim() };
}

function normalizeBoxPayload(res: unknown): { boxes: ChatBox[]; next: number | null } {
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

function httpErrMessage(err: unknown): string {
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

function buildUserSearchFilters(term: string): UserFilters | null {
  const t = term.trim();
  if (t.length < 2) return null;
  if (t.includes('@')) return { limit: 20, email: t };
  const digits = t.replace(/\D/g, '');
  if (digits.length >= 9) return { limit: 20, phone: digits };
  return { limit: 25, search: t };
}

function clientFilterUsers(users: User[], term: string): User[] {
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

@Component({
  selector: 'app-chat-dock',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-dock.component.html',
  styleUrl: './chat-dock.component.css',
})
export class ChatDockComponent {
  private readonly chatService = inject(chat.ApiService);
  private readonly userService = inject(userApi.ApiService);
  private readonly socket = inject(ChatSocketService);
  readonly dock = inject(ChatDockService);
  private readonly destroyRef = inject(DestroyRef);

  readonly view = signal<'list' | 'thread' | 'new'>('list');
  readonly boxes = signal<ChatBox[]>([]);
  readonly boxesNext = signal<number | null>(null);
  readonly loadingBoxes = signal(false);
  readonly listBoxesError = signal<string | null>(null);

  readonly messages = signal<ChatMessage[]>([]);
  readonly messagesNext = signal<number | null>(null);
  readonly loadingMessages = signal(false);
  readonly loadingMoreMessages = signal(false);

  readonly selectedBoxId = signal<number | null>(null);
  readonly selectedTitle = signal('');
  readonly draft = signal('');
  readonly sendError = signal('');
  readonly messageSearchDraft = signal('');
  readonly messageSearchApplied = signal('');

  readonly visibleMessages = computed(() => {
    const list = this.messages();
    const q = this.messageSearchApplied().trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const body = (m.message ?? '').toLowerCase();
      const name = (m.fullName ?? '').toLowerCase();
      const mail = (m.email ?? '').toLowerCase();
      const phoneDigits = (m.phone ?? '').replace(/\D/g, '');
      const qDigits = q.replace(/\D/g, '');
      return (
        body.includes(q) ||
        name.includes(q) ||
        mail.includes(q) ||
        (qDigits.length >= 3 && phoneDigits.includes(qDigits))
      );
    });
  });

  readonly newTitle = signal('');
  readonly newMessage = signal('');
  readonly selectedParticipants = signal<User[]>([]);
  readonly searchQuery = signal('');
  readonly searchResults = signal<User[]>([]);
  readonly searchingUsers = signal(false);
  readonly creating = signal(false);
  readonly createError = signal('');

  private boxesLoadInFlight = false;

  @ViewChild('messageScroll') private messageScroll?: ElementRef<HTMLElement>;
  @ViewChild('boxListScroll') private boxListScroll?: ElementRef<HTMLElement>;

  constructor() {
    this.socket.connect();

    this.socket.onMessageNew$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((msg: ChatRealtimeMessage) => this.handleSocketMessageNew(msg));

    this.socket.onChatNew$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((msg: ChatRealtimeMessage) => this.handleChatNew(msg));

    this.socket.onChatJoined$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {});

    effect(() => {
      const open = this.dock.panelOpen();
      if (!open) return;

      if (this.dock.consumePanelOpenedViaHeaderToggle()) {
        if (this.view() === 'thread') {
          const id = this.selectedBoxId();
          if (id !== null) this.socket.leaveBox(id);
          this.selectedBoxId.set(null);
        }
        this.messageSearchDraft.set('');
        this.messageSearchApplied.set('');
        this.view.set('list');
      }

      this.loadBoxesInitial();
    });
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(ev: KeyboardEvent) {
    if (ev.key !== 'Escape' || !this.dock.panelOpen()) return;
    if (this.view() === 'thread') {
      ev.preventDefault();
      this.backToList();
      return;
    }
    if (this.view() === 'new') {
      ev.preventDefault();
      this.view.set('list');
      return;
    }
    ev.preventDefault();
    this.dock.closePanel();
  }

  onRecipientSearchInput(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.searchQuery.set(v);
  }

  onRecipientSearchSubmit(event?: Event): void {
    event?.preventDefault();
    this.runUserSearch(this.searchQuery());
  }

  private runUserSearch(term: string): void {
    const filters = buildUserSearchFilters(term);
    if (!filters) {
      this.searchResults.set([]);
      return;
    }
    this.searchingUsers.set(true);
    this.userService
      .getUsers(filters)
      .pipe(
        map((res) => {
          const myId = getCurrentUserId();
          let list = res.users.filter((u) => u.id !== myId);
          if (filters.search) list = clientFilterUsers(list, filters.search);
          return list;
        }),
        finalize(() => this.searchingUsers.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (users) => this.searchResults.set(users),
        error: () => this.searchResults.set([]),
      });
  }

  pickUser(u: User): void {
    this.selectedParticipants.update((list) => {
      if (list.some((x) => x.id === u.id)) return list.filter((x) => x.id !== u.id);
      return [...list, u];
    });
    this.searchResults.set([]);
    this.searchQuery.set('');
  }

  removeParticipant(u: User): void {
    this.selectedParticipants.update((list) => list.filter((x) => x.id !== u.id));
  }

  applyMessageSearch(event?: Event): void {
    event?.preventDefault();
    this.messageSearchApplied.set(this.messageSearchDraft().trim());
  }

  openThread(box: ChatBox): void {
    this.messageSearchDraft.set('');
    this.messageSearchApplied.set('');
    this.selectedBoxId.set(box.id);
    this.selectedTitle.set(box.title);
    this.view.set('thread');
    this.messages.set([]);
    this.messagesNext.set(null);
    this.socket.joinBox(box.id);
    this.loadMessages(box.id);
  }

  backToList(): void {
    this.messageSearchDraft.set('');
    this.messageSearchApplied.set('');
    const id = this.selectedBoxId();
    if (id !== null) this.socket.leaveBox(id);
    this.selectedBoxId.set(null);
    this.view.set('list');
    this.loadBoxesInitial();
  }

  goToListView(): void {
    if (this.view() === 'thread') {
      this.backToList();
      return;
    }
    this.view.set('list');
    this.loadBoxesInitial();
  }

  startNewChat(): void {
    if (this.view() === 'thread') {
      const id = this.selectedBoxId();
      if (id !== null) this.socket.leaveBox(id);
      this.selectedBoxId.set(null);
    }
    this.newTitle.set('');
    this.newMessage.set('');
    this.selectedParticipants.set([]);
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.createError.set('');
    this.view.set('new');
  }

  submitNewChat(): void {
    const title = this.newTitle().trim();
    const message = this.newMessage().trim();
    const myId = getCurrentUserId();
    const others = this.selectedParticipants().map((u) => u.id);
    if (!title || !message || myId === null) {
      this.createError.set('Nhập tiêu đề, nội dung và chọn ít nhất một người.');
      return;
    }
    if (others.length === 0) {
      this.createError.set('Tìm và chọn người nhận.');
      return;
    }
    const userIds = [...new Set([...others, myId])];
    this.creating.set(true);
    this.createError.set('');
    this.chatService
      .createBox({ title, message, userIds })
      .pipe(finalize(() => this.creating.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.view.set('list');
          this.loadBoxesInitial();
        },
        error: () => this.createError.set('Không tạo được cuộc trò chuyện.'),
      });
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    if (event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.sendDraft();
  }

  sendDraft(): void {
    const boxId = this.selectedBoxId();
    const text = this.draft().trim();
    if (boxId === null || !text) return;
    this.sendError.set('');
    this.chatService
      .sendMessage(boxId, { message: text })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.socket.emitMessageSend(boxId, text);
          this.draft.set('');
          this.appendLocalOutgoing(boxId, text);
        },
        error: () => this.sendError.set('Gửi tin nhắn thất bại.'),
      });
  }

  onMessagesScroll(event: Event): void {
    const el = event.target as HTMLElement;
    if (el.scrollTop > 80 || this.loadingMoreMessages()) return;
    const next = this.messagesNext();
    const boxId = this.selectedBoxId();
    if (next === null || boxId === null) return;
    this.loadOlder(boxId, next);
  }

  onBoxListScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!nearBottom || this.loadingBoxes()) return;
    const next = this.boxesNext();
    if (next === null) return;
    this.loadMoreBoxes(next);
  }

  loadMoreBoxes(next: number): void {
    this.loadingBoxes.set(true);
    this.chatService
      .listBoxes(10, next)
      .pipe(finalize(() => this.loadingBoxes.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const { boxes, next: n } = normalizeBoxPayload(res);
          this.boxes.update((b) => {
            const seen = new Set(b.map((x) => x.id));
            const merged = [...b];
            for (const box of boxes) {
              if (seen.has(box.id)) continue;
              seen.add(box.id);
              merged.push(box);
            }
            return merged;
          });
          this.boxesNext.set(n);
        },
        error: (err: unknown) =>
          this.listBoxesError.set(httpErrMessage(err) || 'Không tải thêm được.'),
      });
  }

  retryLoadBoxes(): void {
    this.boxesLoadInFlight = false;
    this.listBoxesError.set(null);
    this.loadBoxesInitial();
  }

  trackBox = (_: number, b: ChatBox) => b.id;
  trackMsg = (_: number, m: ChatMessage) => m.id;

  isMine(msg: ChatMessage): boolean {
    const uid = getCurrentUserId();
    return uid !== null && this.messageSenderId(msg) === uid;
  }

  initials(name: string): string {
    const p = name.trim().split(/\s+/).slice(0, 2);
    return p.map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  }

  private loadBoxesInitial(): void {
    if (this.boxesLoadInFlight) return;
    this.boxesLoadInFlight = true;
    this.listBoxesError.set(null);
    this.loadingBoxes.set(true);
    this.chatService
      .listBoxes(10)
      .pipe(
        finalize(() => {
          this.loadingBoxes.set(false);
          this.boxesLoadInFlight = false;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          const { boxes, next } = normalizeBoxPayload(res);
          this.boxes.set(boxes);
          this.boxesNext.set(next);
        },
        error: (err: unknown) => {
          this.listBoxesError.set(
            httpErrMessage(err) ||
              'Không tải được danh sách chat.',
          );
        },
      });
  }

  private loadMessages(boxId: number): void {
    this.loadingMessages.set(true);
    this.chatService
      .listMessages(boxId, 10)
      .pipe(finalize(() => this.loadingMessages.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const sorted = this.sortMessages(res.messages);
          this.messages.set(this.coalesceSenderNamesInThread(sorted));
          this.messagesNext.set(res.next ?? null);
          this.scrollToBottom();
        },
      });
  }

  private loadOlder(boxId: number, next: number): void {
    this.loadingMoreMessages.set(true);
    this.chatService
      .listMessages(boxId, 10, next)
      .pipe(finalize(() => this.loadingMoreMessages.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const prior = this.messageScroll?.nativeElement?.scrollHeight ?? 0;
          const sorted = this.sortMessages(res.messages);
          this.messages.update((m) =>
            this.coalesceSenderNamesInThread(this.sortMessages([...sorted, ...m])),
          );
          this.messagesNext.set(res.next ?? null);
          requestAnimationFrame(() => {
            const sc = this.messageScroll?.nativeElement;
            if (sc) sc.scrollTop = sc.scrollHeight - prior;
          });
        },
      });
  }

  private messageSenderId(m: ChatMessage): number {
    const n = Number(m.senderId);
    return Number.isFinite(n) ? n : -1;
  }

  private resolveSenderDisplayName(senderId: number, list: ChatMessage[]): string {
    const sid = Number(senderId);
    if (!Number.isFinite(sid) || sid <= 0) return '';

    for (let i = list.length - 1; i >= 0; i--) {
      if (this.messageSenderId(list[i]) !== sid) continue;
      const fn = list[i].fullName?.trim();
      if (fn && fn !== 'Người dùng') return fn;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      if (this.messageSenderId(list[i]) !== sid) continue;
      const fn = list[i].fullName?.trim();
      if (fn) return fn;
    }
    return '';
  }

  private coalesceSenderNamesInThread(messages: ChatMessage[]): ChatMessage[] {
    const bySender = new Map<number, string>();
    for (const m of messages) {
      const sid = this.messageSenderId(m);
      if (sid <= 0) continue;
      const fn = m.fullName?.trim();
      if (!fn) continue;
      if (fn !== 'Người dùng') {
        bySender.set(sid, fn);
      } else if (!bySender.has(sid)) {
        bySender.set(sid, fn);
      }
    }
    const myId = getCurrentUserId();
    let selfName = '';
    if (myId !== null && !bySender.has(myId)) {
      try {
        selfName = (JSON.parse(localStorage.getItem('user') ?? '{}') as { fullName?: string }).fullName?.trim() ?? '';
      } catch {
        selfName = '';
      }
      if (selfName) bySender.set(myId, selfName);
    }
    return messages.map((m) => {
      const sid = this.messageSenderId(m);
      const merged = (bySender.get(sid)?.trim() || m.fullName?.trim() || '').trim() || 'Người dùng';
      return { ...m, senderId: sid > 0 ? sid : m.senderId, fullName: merged };
    });
  }

  private sortMessages(items: ChatMessage[]): ChatMessage[] {
    const sorted = [...items].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const seenIds = new Set<number>();
    const out: ChatMessage[] = [];
    for (const m of sorted) {
      const id = Number(m.id);
      if (Number.isFinite(id)) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      out.push(m);
    }
    return out;
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      const el = this.messageScroll?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private appendLocalOutgoing(_boxId: number, text: string): void {
    const uid = getCurrentUserId();
    const raw = localStorage.getItem('user');
    let fullName = '';
    try {
      fullName = (JSON.parse(raw ?? '{}') as { fullName?: string }).fullName ?? '';
    } catch {
      fullName = '';
    }
    const optimistic: ChatMessage = {
      id: Date.now(),
      message: text,
      senderId: uid ?? -1,
      fullName,
      phone: '',
      email: '',
      createdAt: new Date().toISOString(),
    };
    this.messages.update((list) =>
      this.coalesceSenderNamesInThread(this.sortMessages([...list, optimistic])),
    );
    this.scrollToBottom();
  }

  private inChatThread(): boolean {
    return this.dock.panelOpen() && this.view() === 'thread';
  }

  private handleSocketMessageNew(msg: ChatRealtimeMessage): void {
    if (!this.inChatThread()) return;

    const boxId = Number(msg.boxId);
    if (!Number.isFinite(boxId)) return;

    const myId = getCurrentUserId();
    if (myId !== null && Number(msg.senderId) === myId) return;

    this.dock.bumpUnreadIfNeeded(this.dock.panelOpen(), this.selectedBoxId(), boxId);

    if (this.selectedBoxId() !== boxId) return;

    const body = msg.body;
    if (!body) return;
    this.messages.update((list) => {
      if (this.isDupRealtime(list, msg)) return list;
      const sid = Number(msg.senderId);
      const resolvedName = Number.isFinite(sid) ? this.resolveSenderDisplayName(sid, list) : '';
      const row: ChatMessage = {
        id: Date.now(),
        message: body,
        senderId: Number.isFinite(sid) ? sid : msg.senderId,
        fullName: resolvedName,
        phone: '',
        email: '',
        createdAt: msg.createdAt || new Date().toISOString(),
      };
      return this.coalesceSenderNamesInThread(this.sortMessages([...list, row]));
    });

    this.scrollToBottom();
  }

  private isDupRealtime(list: ChatMessage[], msg: ChatRealtimeMessage): boolean {
    const sid = Number(msg.senderId);
    return list.some(
      (m) =>
        m.message === msg.body &&
        this.messageSenderId(m) === sid &&
        Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt || 0).getTime()) < 5000,
    );
  }

  private handleChatNew(msg: ChatRealtimeMessage): void {
    const boxId = Number(msg.boxId);
    if (!Number.isFinite(boxId)) return;

    const title =
      typeof msg.title === 'string' && msg.title.trim() ? msg.title.trim() : 'Chat';

    this.boxes.update((list) => {
      if (list.some((b) => b.id === boxId)) return list;
      return [{ id: boxId, title }, ...list];
    });

    this.dock.panelOpen.set(true);
    this.dock.unreadCount.set(0);

    if (this.selectedBoxId() === boxId && this.view() === 'thread') {
      this.selectedTitle.set(title);
      return;
    }

    this.openThread({ id: boxId, title });
  }
}

