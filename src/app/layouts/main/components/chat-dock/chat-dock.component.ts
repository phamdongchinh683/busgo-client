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
  ChatCallActivePayload,
  ChatCallSignalPayload,
  ChatCallStartPayload,
  ChatCallType,
  ChatRealtimeMessage,
  ChatSocketService,
  ChatTypingPayload,
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
import { ChatCallPopupComponent } from './components/chat-call-popup/chat-call-popup.component';

@Component({
  selector: 'app-chat-dock',
  standalone: true,
  imports: [CommonModule, FormsModule, ChatCallPopupComponent],
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
  readonly peerTyping = signal(false);
  readonly callStatus = signal('');
  readonly callIncoming = signal<ChatCallStartPayload | null>(null);
  readonly callOutgoing = signal<ChatCallType | null>(null);
  readonly activeCallType = signal<ChatCallType | null>(null);
  readonly inCall = signal(false);
  readonly messageSearchDraft = signal('');
  readonly messageSearchApplied = signal('');
  readonly messageSearchOpen = signal(false);

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
  private typingStopDebounce: ReturnType<typeof setTimeout> | null = null;
  private typingActiveBoxId: number | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pendingIncomingOffer: RTCSessionDescriptionInit | null = null;

  @ViewChild('messageScroll') private messageScroll?: ElementRef<HTMLElement>;
  @ViewChild('callLocalVideo') private callLocalVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('callRemoteVideo') private callRemoteVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('callRemoteAudio') private callRemoteAudio?: ElementRef<HTMLAudioElement>;

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
    this.socket.onChatTypingStart$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatTypingPayload) => this.handleTypingStart(p));
    this.socket.onChatTypingStop$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatTypingPayload) => this.handleTypingStop(p));
    this.socket.onChatCallStart$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatCallStartPayload) => this.handleCallStart(p));
    this.socket.onChatCallActive$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatCallActivePayload) => this.handleCallActive(p));
    this.socket.onChatCallOffer$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatCallSignalPayload) => this.handleCallOffer(p));
    this.socket.onChatCallAnswer$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatCallSignalPayload) => this.handleCallAnswer(p));
    this.socket.onChatCallIceCandidate$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatCallSignalPayload) => this.handleCallIceCandidate(p));
    this.socket.onChatCallReject$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatCallStartPayload) => this.handleCallRejected(p));
    this.socket.onChatCallEnd$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatCallStartPayload) => this.handleCallEnded(p));

    this.destroyRef.onDestroy(() => {
      this.stopTypingNow();
      this.socket.leaveJoinedRoom();
      this.hangupLocal(false);
    });

    effect(() => {
      const open = this.dock.panelOpen();
      if (!open) {
        untracked(() => {
          this.stopTypingNow();
          this.peerTyping.set(false);
          this.socket.leaveJoinedRoom();
          if (this.view() === 'thread') {
            this.messageSearchDraft.set('');
            this.messageSearchApplied.set('');
            this.selectedBoxId.set(null);
            this.view.set('list');
            this.resetCallState();
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

  toggleMessageSearch(): void {
    const next = !this.messageSearchOpen();
    this.messageSearchOpen.set(next);
    if (!next) {
      this.messageSearchDraft.set('');
      this.messageSearchApplied.set('');
    }
  }

  openThread(box: ChatBox, emitRead = false): void {
    const sameThread = this.view() === 'thread' && this.selectedBoxId() === box.id;
    if (sameThread) {
      if (emitRead) this.socket.emitChatRead(box.id);
      return;
    }

    this.messageSearchDraft.set('');
    this.messageSearchApplied.set('');
    this.stopTypingNow();
    this.resetCallState();
    this.peerTyping.set(false);
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
    this.stopTypingNow();
    this.peerTyping.set(false);
    this.resetCallState();
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
    this.stopTypingNow();
    this.resetCallState();
    this.peerTyping.set(false);
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

  onComposerInput(v: string): void {
    this.draft.set(v);
    this.scheduleTypingSignal();
  }

  sendDraft(): void {
    const boxId = this.selectedBoxId();
    const text = this.draft().trim();
    if (boxId === null || !text) return;
    this.stopTypingNow();
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

  callStatusText(): string {
    return this.callStatus().trim();
  }

  startCall(callType: ChatCallType): void {
    void this.startCallInternal(callType);
  }

  private async startCallInternal(callType: ChatCallType): Promise<void> {
    const boxId = this.selectedBoxId();
    if (boxId === null) return;
    try {
      this.callIncoming.set(null);
      this.callOutgoing.set(callType);
      this.activeCallType.set(callType);
      this.callStatus.set(callType === 'video' ? 'Đang gọi video…' : 'Đang gọi thoại…');
      this.socket.emitCallStart(boxId, callType);
      await this.ensureLocalStream(callType);
      this.setLocalAudioEnabled(false);
      const pc = this.createPeerConnection(boxId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emitCallOffer(boxId, offer);
    } catch {
      this.callStatus.set('Không thể bắt đầu cuộc gọi.');
      this.hangupLocal(false);
    }
  }

  rejectIncomingCall(): void {
    const boxId = this.selectedBoxId();
    if (boxId === null) return;
    this.socket.emitCallReject(boxId);
    this.hangupLocal(false);
    this.callStatus.set('Đã từ chối cuộc gọi.');
  }

  acceptIncomingCall(): void {
    void this.acceptIncomingCallInternal();
  }

  private async acceptIncomingCallInternal(): Promise<void> {
    const incoming = this.callIncoming();
    const boxId = this.selectedBoxId();
    if (!incoming || boxId === null) return;
    try {
      this.callIncoming.set(null);
      this.callOutgoing.set(incoming.callType);
      this.activeCallType.set(incoming.callType);
      this.callStatus.set(
        incoming.callType === 'video' ? 'Đã nhận cuộc gọi video.' : 'Đã nhận cuộc gọi thoại.',
      );
      if (!this.pendingIncomingOffer) {
        this.callStatus.set('Đang tham gia cuộc gọi đang hoạt động…');
        await this.startCallInternal(incoming.callType);
        return;
      }
      await this.ensureLocalStream(incoming.callType);
      const pc = this.createPeerConnection(boxId);
      await pc.setRemoteDescription(this.pendingIncomingOffer);
      this.pendingIncomingOffer = null;
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emitCallAnswer(boxId, answer);
      this.inCall.set(true);
      this.setLocalAudioEnabled(true);
    } catch {
      this.callStatus.set('Không thể nhận cuộc gọi.');
      this.hangupLocal(false);
    }
  }

  endCall(): void {
    const boxId = this.selectedBoxId();
    if (boxId === null) return;
    this.socket.emitCallEnd(boxId);
    this.hangupLocal(false);
    this.callStatus.set('Đã kết thúc cuộc gọi.');
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

  private scheduleTypingSignal(): void {
    if (!this.inChatThread()) return;
    const boxId = this.selectedBoxId();
    if (boxId === null) return;
    if (this.typingActiveBoxId !== boxId) {
      this.typingActiveBoxId = boxId;
      this.socket.emitTypingStart(boxId);
    }
    if (this.typingStopDebounce !== null) {
      clearTimeout(this.typingStopDebounce);
    }
    this.typingStopDebounce = setTimeout(() => {
      this.stopTypingNow();
    }, 1200);
  }

  private stopTypingNow(): void {
    if (this.typingStopDebounce !== null) {
      clearTimeout(this.typingStopDebounce);
      this.typingStopDebounce = null;
    }
    if (this.typingActiveBoxId !== null) {
      this.socket.emitTypingStop(this.typingActiveBoxId);
      this.typingActiveBoxId = null;
    }
  }

  private handleTypingStart(p: ChatTypingPayload): void {
    const boxId = Number(p.boxId);
    if (!Number.isFinite(boxId)) return;
    if (!this.inChatThread() || this.selectedBoxId() !== boxId) return;
    const myId = getChatViewerUserId();
    if (myId !== null && p.userId === myId) return;
    this.peerTyping.set(true);
  }

  private handleTypingStop(p: ChatTypingPayload): void {
    const boxId = Number(p.boxId);
    if (!Number.isFinite(boxId)) return;
    if (this.selectedBoxId() !== boxId) return;
    const myId = getChatViewerUserId();
    if (myId !== null && p.userId === myId) return;
    this.peerTyping.set(false);
  }

  private resetCallState(): void {
    this.hangupLocal(false);
    this.callStatus.set('');
  }

  private shouldHandleCallPayload(boxIdRaw: number | string): boolean {
    const boxId = Number(boxIdRaw);
    return Number.isFinite(boxId) && this.inChatThread() && this.selectedBoxId() === boxId;
  }

  private isPayloadFromMe(userId: number): boolean {
    const myId = getChatViewerUserId();
    return myId !== null && myId === userId;
  }

  private handleCallStart(p: ChatCallStartPayload): void {
    if (!this.shouldHandleCallPayload(p.boxId) || this.isPayloadFromMe(p.userId)) return;
    this.activeCallType.set(p.callType);
    this.callIncoming.set(p);
    this.callOutgoing.set(null);
    this.callStatus.set(p.callType === 'video' ? 'Cuộc gọi video đến…' : 'Cuộc gọi thoại đến…');
  }

  private handleCallActive(p: ChatCallActivePayload): void {
    if (!this.shouldHandleCallPayload(p.boxId) || this.isPayloadFromMe(p.userId)) return;
    this.activeCallType.set(p.callType);
    this.callIncoming.set({
      userId: p.userId,
      boxId: p.boxId,
      callType: p.callType,
    });
    this.callOutgoing.set(null);
    this.callStatus.set(
      p.callType === 'video'
        ? 'Cuộc gọi video đang diễn ra. Nhấn Nhận để tham gia.'
        : 'Cuộc gọi thoại đang diễn ra. Nhấn Nhận để tham gia.',
    );
  }

  private async handleCallOffer(p: ChatCallSignalPayload): Promise<void> {
    if (!this.shouldHandleCallPayload(p.boxId) || this.isPayloadFromMe(p.userId)) return;
    if (!this.isSessionDescriptionInit(p.payload)) return;
    this.pendingIncomingOffer = p.payload;
    if (!this.callIncoming()) {
      this.callIncoming.set({
        userId: p.userId,
        boxId: p.boxId,
        callType: this.activeCallType() ?? 'voice',
      });
    }
    if (this.inCall() || this.callOutgoing() !== null) {
      this.callStatus.set('Đang đồng bộ cuộc gọi…');
      await this.acceptIncomingCallInternal();
      return;
    }
    this.callStatus.set('Có cuộc gọi đến.');
  }

  private async handleCallAnswer(p: ChatCallSignalPayload): Promise<void> {
    if (!this.shouldHandleCallPayload(p.boxId) || this.isPayloadFromMe(p.userId)) return;
    if (!this.peerConnection || !this.isSessionDescriptionInit(p.payload)) return;
    try {
      await this.peerConnection.setRemoteDescription(p.payload);
      this.callIncoming.set(null);
      this.callOutgoing.set(this.activeCallType());
      this.inCall.set(true);
      this.setLocalAudioEnabled(true);
      this.callStatus.set('Đã kết nối cuộc gọi.');
    } catch {
      this.callStatus.set('Không thể thiết lập kết nối cuộc gọi.');
    }
  }

  private async handleCallIceCandidate(p: ChatCallSignalPayload): Promise<void> {
    if (!this.shouldHandleCallPayload(p.boxId) || this.isPayloadFromMe(p.userId)) return;
    if (!this.peerConnection || !this.isIceCandidateInit(p.payload)) return;
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(p.payload));
    } catch {
    }
    this.callStatus.set('Đang đồng bộ kết nối cuộc gọi…');
  }

  private handleCallRejected(p: ChatCallStartPayload): void {
    if (!this.shouldHandleCallPayload(p.boxId) || this.isPayloadFromMe(p.userId)) return;
    this.hangupLocal(false);
    this.callStatus.set('Đối phương đã từ chối cuộc gọi.');
  }

  private handleCallEnded(p: ChatCallStartPayload): void {
    if (!this.shouldHandleCallPayload(p.boxId) || this.isPayloadFromMe(p.userId)) return;
    this.hangupLocal(false);
    this.callStatus.set('Đối phương đã kết thúc cuộc gọi.');
  }

  private createPeerConnection(boxId: number): RTCPeerConnection {
    if (this.peerConnection) return this.peerConnection;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
    });
    this.peerConnection = pc;

    const remote = new MediaStream();
    this.remoteStream = remote;
    this.syncCallMediaElements();

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.socket.emitCallIceCandidate(boxId, ev.candidate.toJSON());
    };
    pc.ontrack = (ev) => {
      const [incoming] = ev.streams;
      if (incoming) {
        this.remoteStream = incoming;
      } else {
        this.remoteStream?.addTrack(ev.track);
      }
      this.syncCallMediaElements();
      this.inCall.set(true);
      this.setLocalAudioEnabled(true);
      this.callStatus.set('Đã kết nối cuộc gọi.');
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        this.inCall.set(true);
        this.setLocalAudioEnabled(true);
        this.callStatus.set('Đã kết nối cuộc gọi.');
        return;
      }
      if (s === 'disconnected' || s === 'failed' || s === 'closed') {
        this.hangupLocal(false);
        if (s !== 'closed') this.callStatus.set('Kết nối cuộc gọi đã ngắt.');
      }
    };
    return pc;
  }

  private async ensureLocalStream(callType: ChatCallType): Promise<void> {
    if (this.localStream) return;
    const media = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: callType === 'video',
    });
    this.localStream = media;
    this.setLocalAudioEnabled(this.inCall());
    this.syncCallMediaElements();
  }

  private setLocalAudioEnabled(enabled: boolean): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }

  private syncCallMediaElements(): void {
    requestAnimationFrame(() => {
      const local = this.callLocalVideo?.nativeElement;
      if (local) local.srcObject = this.localStream;
      const remoteVideo = this.callRemoteVideo?.nativeElement;
      if (remoteVideo) remoteVideo.srcObject = this.remoteStream;
      const remoteAudio = this.callRemoteAudio?.nativeElement;
      if (remoteAudio) remoteAudio.srcObject = this.remoteStream;
    });
  }

  private hangupLocal(clearStatus: boolean): void {
    this.pendingIncomingOffer = null;
    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.ontrack = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
    if (this.remoteStream) {
      for (const track of this.remoteStream.getTracks()) track.stop();
      this.remoteStream = null;
    }
    this.callIncoming.set(null);
    this.callOutgoing.set(null);
    this.activeCallType.set(null);
    this.inCall.set(false);
    this.syncCallMediaElements();
    if (clearStatus) this.callStatus.set('');
  }

  private isSessionDescriptionInit(v: unknown): v is RTCSessionDescriptionInit {
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    const type = o['type'];
    const sdp = o['sdp'];
    return typeof type === 'string' && typeof sdp === 'string';
  }

  private isIceCandidateInit(v: unknown): v is RTCIceCandidateInit {
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return typeof o['candidate'] === 'string';
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
    this.peerTyping.set(false);

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

