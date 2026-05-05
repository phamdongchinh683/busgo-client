import { CommonModule } from '@angular/common';
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
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, map } from 'rxjs/operators';
import { chat, user as userApi } from '@app/data/services';
import { User } from '@app/data/interfaces/user';
import { ChatBox, ChatMessage } from '@app/data/interfaces/chat';
import { ChatDockService } from '@app/core/services/chat-dock.service';
import {
  getChatViewerUserId,
  normalizeBoxPayload,
  patchBoxViewerUnread,
  viewerUnreadCount,
} from '@app/core/utils/chat-box-list';
import {
  ChatRealtimeMessage,
  ChatSocketService,
  ChatUnreadCountPayload,
} from '@app/core/services/chat-socket.service';
import {
  buildUserSearchFilters,
  clientFilterUsers,
  httpErrMessage,
  listRowPreview,
  mergeUniqueBoxes,
  msgSenderId,
  positiveSenderId,
  storedFullNameOrEmpty,
  storedUserFullName,
} from './chat-dock.helpers';

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
      return (
        body.includes(q) ||
        name.includes(q)
      );
    });
  });

  readonly newMessage = signal('');
  readonly selectedReceiver = signal<User | null>(null);
  readonly searchQuery = signal('');
  readonly searchResults = signal<User[]>([]);
  readonly searchingUsers = signal(false);
  readonly creating = signal(false);
  readonly createError = signal('');

  private boxesLoadInFlight = false;
  private threadCache = new Map<number, { messages: ChatMessage[]; next: number | null }>();

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

    this.socket.onChatUnreadCount$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatUnreadCountPayload) => this.handleChatUnreadCount(p));

    this.destroyRef.onDestroy(() => {
      this.socket.leaveJoinedRoom();
    });

    effect(() => {
      const open = this.dock.panelOpen();
      if (!open) {
        untracked(() => {
          this.socket.leaveJoinedRoom();
          if (this.view() === 'thread') {
            this.messageSearchDraft.set('');
            this.messageSearchApplied.set('');
            this.selectedBoxId.set(null);
            this.view.set('list');
          }
        });
        return;
      }

      if (this.dock.consumePanelOpenedViaHeaderToggle()) {
        if (untracked(() => this.view()) === 'thread') {
          const id = untracked(() => this.selectedBoxId());
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
          const myId = getChatViewerUserId();
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
    this.selectedReceiver.set(u);
    this.searchResults.set([]);
    this.searchQuery.set('');
  }

  clearSelectedReceiver(): void {
    this.selectedReceiver.set(null);
  }

  applyMessageSearch(event?: Event): void {
    event?.preventDefault();
    this.messageSearchApplied.set(this.messageSearchDraft().trim());
  }

  openThread(box: ChatBox, emitRead = false): void {
    const sameThread = this.view() === 'thread' && this.selectedBoxId() === box.id;
    if (sameThread) {
      if (emitRead) this.socket.emitChatRead(box.id);
      return;
    }

    this.messageSearchDraft.set('');
    this.messageSearchApplied.set('');
    this.selectedBoxId.set(box.id);
    this.selectedTitle.set(box.displayName?.trim() || 'Chat');
    this.view.set('thread');
    const cached = this.threadCache.get(box.id);
    if (cached) {
      this.messages.set(cached.messages);
      this.messagesNext.set(cached.next);
    } else {
      this.messages.set([]);
      this.messagesNext.set(null);
    }
    this.socket.joinBox(box.id);
    if (emitRead) {
      const vid = getChatViewerUserId();
      this.boxes.update((list) =>
        list.map((b) => (b.id === box.id && vid !== null ? patchBoxViewerUnread(b, 0, vid) : b)),
      );
      const row = this.boxes().find((x) => x.id === box.id);
      if (vid !== null && row)
        this.dock.applySocketUnreadCount(box.id, viewerUnreadCount(row, vid));
      this.socket.emitChatRead(box.id);
      this.refreshBoxStateOnOpen(box.id);
    }
    this.loadMessages(box.id);
  }

  private refreshBoxStateOnOpen(boxId: number): void {
    this.chatService
      .listBoxes(50)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const { boxes } = normalizeBoxPayload(res);
          const fresh = boxes.find((b: ChatBox) => b.id === boxId);
          if (!fresh) return;
          this.boxes.update((list) => list.map((b) => (b.id === boxId ? { ...b, ...fresh } : b)));
          this.dock.syncUnreadBaselineFromBoxes([fresh], getChatViewerUserId(), true);
        },
      });
  }

  private handleChatUnreadCount(p: ChatUnreadCountPayload): void {
    const rawId = p.boxId;
    const boxId =
      typeof rawId === 'string'
        ? parseInt(rawId, 10)
        : typeof rawId === 'number'
          ? rawId
          : NaN;
    if (!Number.isFinite(boxId)) return;
    if (typeof p.lastMessage === 'string' && p.lastMessage.trim()) {
      this.patchBoxPreview(boxId, p.lastMessage, undefined, { clearLastMessageSenderWhenNoId: true });
    }
    const vid = getChatViewerUserId();
    const isActiveThreadBox =
      this.dock.panelOpen() &&
      this.view() === 'thread' &&
      this.selectedBoxId() === boxId;

    const hasTotals =
      (typeof p.unreadReceiverCount === 'number' && Number.isFinite(p.unreadReceiverCount)) ||
      (typeof p.unreadSenderCount === 'number' && Number.isFinite(p.unreadSenderCount));
    const legacyCount = ((): number | null => {
      if (typeof p.unreadCount === 'number' && Number.isFinite(p.unreadCount)) {
        return Math.max(0, Math.floor(p.unreadCount));
      }
      if (typeof p.count === 'number' && Number.isFinite(p.count)) {
        return Math.max(0, Math.floor(p.count));
      }
      return null;
    })();

    let viewerUnreadNext: number | null = null;

    this.boxes.update((list) => {
      const i = list.findIndex((b) => b.id === boxId);
      if (i < 0) {
        if (isActiveThreadBox) viewerUnreadNext = 0;
        else if (legacyCount !== null) viewerUnreadNext = legacyCount;
        else if (hasTotals) {
          const ur =
            typeof p.unreadReceiverCount === 'number' && Number.isFinite(p.unreadReceiverCount)
              ? Math.max(0, Math.floor(p.unreadReceiverCount))
              : 0;
          const us =
            typeof p.unreadSenderCount === 'number' && Number.isFinite(p.unreadSenderCount)
              ? Math.max(0, Math.floor(p.unreadSenderCount))
              : 0;
          viewerUnreadNext = Math.max(ur, us);
        }
        return list;
      }

      const b = list[i];
      let next: ChatBox = { ...b };

      if (isActiveThreadBox && vid !== null) {
        next = patchBoxViewerUnread(b, 0, vid);
      } else if (hasTotals) {
        if (typeof p.unreadReceiverCount === 'number' && Number.isFinite(p.unreadReceiverCount)) {
          next.unreadReceiverCount = Math.max(0, Math.floor(p.unreadReceiverCount));
        }
        if (typeof p.unreadSenderCount === 'number' && Number.isFinite(p.unreadSenderCount)) {
          next.unreadSenderCount = Math.max(0, Math.floor(p.unreadSenderCount));
        }
      } else if (legacyCount !== null) {
        next = patchBoxViewerUnread(b, legacyCount, vid);
      }

      viewerUnreadNext = viewerUnreadCount(next, vid);

      const out = [...list];
      out[i] = next;
      return out;
    });

    if (viewerUnreadNext !== null) {
      this.dock.applySocketUnreadCount(boxId, isActiveThreadBox ? 0 : viewerUnreadNext);
    }
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
    this.newMessage.set('');
    this.selectedReceiver.set(null);
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.createError.set('');
    this.view.set('new');
  }

  submitNewChat(): void {
    const message = this.newMessage().trim();
    const myId = getChatViewerUserId();
    const peer = this.selectedReceiver();
    const receiverId = peer ? Number(peer.id) : NaN;

    if (!message || myId === null) {
      this.createError.set('Nhập nội dung và đăng nhập hợp lệ.');
      return;
    }
    if (!peer?.fullName?.trim()) {
      this.createError.set('Chọn người nhận có họ tên hợp lệ.');
      return;
    }
    if (!peer || !Number.isFinite(receiverId) || receiverId <= 0) {
      this.createError.set('Tìm và chọn một người nhận.');
      return;
    }
    if (receiverId === myId) {
      this.createError.set('Không thể chọn chính mình làm người nhận.');
      return;
    }

    this.creating.set(true);
    this.createError.set('');
    this.chatService
      .createBox({ message, receiverId })
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
          this.boxes.update((existing) => mergeUniqueBoxes(existing, boxes));
          this.boxesNext.set(n);
          this.dock.syncUnreadBaselineFromBoxes(boxes, getChatViewerUserId(), true);
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
    const uid = getChatViewerUserId();
    return uid !== null && msgSenderId(msg) === uid;
  }

  initials(name: string): string {
    const p = name.trim().split(/\s+/).slice(0, 2);
    return p.map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  }

  boxDisplayLabel(box: ChatBox): string {
    return box.displayName?.trim() ?? '';
  }

  peerUserId(box: ChatBox): number | null {
    const me = getChatViewerUserId();
    const n = (v: number | undefined): number | null =>
      v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null;
    const s = n(box.senderId);
    const r = n(box.receiverId);
    if (s !== null && r !== null && me !== null) return s === me ? r : r === me ? s : s;
    if (s !== null && (me === null || s !== me)) return s;
    if (r !== null && (me === null || r !== me)) return r;
    return null;
  }

  peerOnline(box: ChatBox): boolean {
    const pid = this.peerUserId(box);
    if (pid === null) return false;
    return this.socket.onlineUserIds().has(pid);
  }

  selectedPeerOnline(): boolean {
    const id = this.selectedBoxId();
    if (id === null) return false;
    const box = this.boxes().find((b) => b.id === id);
    return box ? this.peerOnline(box) : false;
  }

  userSearchHitOnline(u: User): boolean {
    const uid = Number(u.id);
    if (!Number.isFinite(uid)) return false;
    return this.socket.onlineUserIds().has(uid);
  }

  boxUnreadCount(box: ChatBox): number {
    return viewerUnreadCount(box, getChatViewerUserId());
  }

  boxUnreadBadgeText(box: ChatBox): string {
    const n = this.boxUnreadCount(box);
    if (n <= 0) return '';
    return n > 99 ? '99+' : String(n);
  }

  threadPreviewLine(box: ChatBox): string {
    return listRowPreview(box, getChatViewerUserId());
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
          this.dock.syncUnreadBaselineFromBoxes(boxes, getChatViewerUserId(), false);
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
          const coalesced = this.coalesceSenderNamesInThread(sorted);
          this.messages.set(coalesced);
          this.messagesNext.set(res.next ?? null);
          this.threadCache.set(boxId, { messages: coalesced, next: res.next ?? null });
          const last = coalesced[coalesced.length - 1];
          if (last?.message?.trim()) {
            this.patchBoxPreview(boxId, last.message, positiveSenderId(last.senderId));
          }
          this.scrollToBottom();
        },
      });
  }

  private patchBoxPreview(
    boxId: number,
    text: string,
    lastMessageSenderId?: number,
    opts?: { clearLastMessageSenderWhenNoId?: boolean },
  ): void {
    const t = text.trim();
    if (!t) return;
    const sid =
      lastMessageSenderId !== undefined ? positiveSenderId(lastMessageSenderId) : undefined;
    this.boxes.update((list) =>
      list.map((b) => {
        if (b.id !== boxId) return b;
        const next: ChatBox = { ...b, lastMessage: t };
        if (sid !== undefined) {
          next.lastMessageSenderId = sid;
        } else if (opts?.clearLastMessageSenderWhenNoId) {
          delete next.lastMessageSenderId;
        }
        return next;
      }),
    );
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
          const merged = this.coalesceSenderNamesInThread(
            this.sortMessages([...sorted, ...this.messages()]),
          );
          const nextCursor = res.next ?? null;
          this.messages.set(merged);
          this.messagesNext.set(nextCursor);
          this.threadCache.set(boxId, { messages: merged, next: nextCursor });
          requestAnimationFrame(() => {
            const sc = this.messageScroll?.nativeElement;
            if (sc) sc.scrollTop = sc.scrollHeight - prior;
          });
        },
      });
  }

  private coalesceSenderNamesInThread(messages: ChatMessage[]): ChatMessage[] {
    const bySender = new Map<number, string>();
    for (const m of messages) {
      const sid = msgSenderId(m);
      if (sid <= 0) continue;
      const fn = m.fullName?.trim();
      if (!fn) continue;
      if (fn !== 'Người dùng') {
        bySender.set(sid, fn);
      } else if (!bySender.has(sid)) {
        bySender.set(sid, fn);
      }
    }
    const myId = getChatViewerUserId();
    if (myId !== null && !bySender.has(myId)) {
      const selfName = storedFullNameOrEmpty();
      if (selfName) bySender.set(myId, selfName);
    }
    return messages.map((m) => {
      const sid = msgSenderId(m);
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
    const uid = getChatViewerUserId();
    const optimistic: ChatMessage = {
      id: Date.now(),
      message: text,
      senderId: uid ?? -1,
      fullName: storedUserFullName(),
      createdAt: new Date().toISOString(),
    };
    this.patchBoxPreview(_boxId, text, positiveSenderId(uid));
    this.messages.update((list) =>
      this.coalesceSenderNamesInThread(this.sortMessages([...list, optimistic])),
    );
    this.threadCache.set(_boxId, { messages: this.messages(), next: this.messagesNext() });
    this.scrollToBottom();
  }

  private inChatThread(): boolean {
    return this.dock.panelOpen() && this.view() === 'thread';
  }

  private handleSocketMessageNew(msg: ChatRealtimeMessage): void {
    const boxId = Number(msg.boxId);
    if (!Number.isFinite(boxId)) return;

    const myId = getChatViewerUserId();
    if (myId !== null && Number(msg.senderId) === myId) return;

    this.dock.bumpUnreadIfNeeded(this.dock.panelOpen(), this.selectedBoxId(), boxId);

    const body = msg.body;
    if (!body) return;
    const convoFill = msg.title?.trim() || msg.senderName.trim();
    if (convoFill && myId !== null && Number(msg.senderId) !== myId) {
      this.boxes.update((list) =>
        list.map((b) => {
          if (b.id !== boxId) return b;
          if (b.displayName?.trim()) return b;
          return { ...b, displayName: convoFill };
        }),
      );
    }
    this.patchBoxPreview(boxId, body, positiveSenderId(msg.senderId));

    if (!this.inChatThread()) return;
    if (this.selectedBoxId() !== boxId) return;

    const listSnap = this.messages();
    if (this.isDupRealtime(listSnap, msg)) {
      this.scrollToBottom();
      return;
    }

    const sid = Number(msg.senderId);

    this.messages.update((list) => {
      const row: ChatMessage = {
        id: Date.now(),
        message: body,
        senderId: Number.isFinite(sid) ? sid : msg.senderId,
        fullName: msg.senderName.trim(),
        createdAt: msg.createdAt || new Date().toISOString(),
      };
      return this.coalesceSenderNamesInThread(this.sortMessages([...list, row]));
    });
    this.threadCache.set(boxId, { messages: this.messages(), next: this.messagesNext() });

    this.scrollToBottom();
  }

  private isDupRealtime(list: ChatMessage[], msg: ChatRealtimeMessage): boolean {
    const sid = Number(msg.senderId);
    return list.some(
      (m) =>
        m.message === msg.body &&
        msgSenderId(m) === sid &&
        Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt || 0).getTime()) < 5000,
    );
  }

  private handleChatNew(msg: ChatRealtimeMessage): void {
    const boxId = Number(msg.boxId);
    if (!Number.isFinite(boxId)) return;

    const peerTitle = msg.title?.trim() || msg.senderName.trim() || 'Chat';

    const preview =
      typeof msg.body === 'string' && msg.body.trim() ? msg.body.trim() : undefined;
    this.boxes.update((list) => {
      if (list.some((b) => b.id === boxId)) return list;
      const row: ChatBox = { id: boxId, displayName: peerTitle };
      if (preview) row.lastMessage = preview;
      return [row, ...list];
    });

    this.dock.panelOpen.set(true);
    const openBox: ChatBox = { id: boxId, displayName: peerTitle };
    if (preview) openBox.lastMessage = preview;
    this.openThread(openBox, false);
  }
}

