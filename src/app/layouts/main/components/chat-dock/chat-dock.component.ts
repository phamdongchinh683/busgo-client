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
import { firstValueFrom } from 'rxjs';
import { finalize, map } from 'rxjs/operators';
import { chat, upload, user as userApi } from '@app/data/services';
import { User } from '@app/data/interfaces/user';
import { ChatBox, ChatMessage, ChatMessagesListResponse } from '@app/data/interfaces/chat';
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
  ChatMessageRecalledPayload,
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
  private readonly uploadService = inject(upload.ApiService);
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
  readonly loadingThreadMessages = signal(false);
  readonly loadingOlderMessages = signal(false);
  readonly threadMessagesError = signal<string | null>(null);

  readonly selectedBoxId = signal<number | null>(null);
  readonly selectedTitle = signal('');
  readonly draft = signal('');
  readonly sendError = signal('');
  readonly sendingImage = signal(false);
  readonly peerTyping = signal(false);
  readonly callStatus = signal('');
  readonly callIncoming = signal<ChatCallStartPayload | null>(null);
  readonly callOutgoing = signal<ChatCallType | null>(null);
  readonly activeCallType = signal<ChatCallType | null>(null);
  readonly inCall = signal(false);
  /** Hiện PiP camera local chỉ khi đã có track video (tránh ô viền trống kiểu Messenger). */
  readonly callLocalPipVisible = signal(false);

  /** voice/video cho UI popup — ưu tiên payload cuộc gọi đến (activeCallType có lúc chưa sync). */
  readonly callPopupMediaType = computed<ChatCallType | null>(() => {
    const incoming = this.callIncoming();
    if (incoming) return incoming.callType;
    return this.activeCallType();
  });
  readonly messageSearchDraft = signal('');
  readonly messageSearchApplied = signal('');
  readonly messageSearchOpen = signal(false);
  readonly imagePreviewUrl = signal<string | null>(null);
  readonly chatDragOver = signal(false);
  readonly recallingMessageIds = signal<ReadonlySet<number>>(new Set());

  readonly panelStyle = computed<Record<string, string> | null>(() => {
    const view = this.view();
    if (view === 'thread') return null;
    const anchor = this.dock.panelAnchor();
    if (!anchor) return null;
    return {
      top: `${anchor.top}px`,
      right: `${anchor.right}px`,
      bottom: 'auto',
    };
  });

  readonly newMessage = signal('');
  readonly selectedReceiver = signal<User | null>(null);
  readonly searchQuery = signal('');
  readonly searchResults = signal<User[]>([]);
  readonly searchingUsers = signal(false);
  readonly creating = signal(false);
  readonly createError = signal('');
  readonly newChatPopupOpen = signal(false);

  private boxesLoadInFlight = false;
  private messagesHistoryLoadInFlight = false;
  /** Đổi thread / reload → bỏ response HTTP cũ (race), không liên quan tới `next`. */
  private threadMessagesEpoch = 0;
  private typingStopDebounce: ReturnType<typeof setTimeout> | null = null;
  private typingActiveBoxId: number | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pendingIncomingOffer: RTCSessionDescriptionInit | null = null;
  private pendingImageObjectUrls = new Map<number, string>();

  @ViewChild('messageScroll') private messageScroll?: ElementRef<HTMLElement>;
  @ViewChild('chatImageInput') private chatImageInput?: ElementRef<HTMLInputElement>;
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
    this.socket.onMessageRecalled$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChatMessageRecalledPayload) => this.handleMessageRecalled(p));
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
      for (const url of this.pendingImageObjectUrls.values()) URL.revokeObjectURL(url);
      this.pendingImageObjectUrls.clear();
    });

    effect(() => {
      const open = this.dock.panelOpen();
      if (!open) {
        untracked(() => {
          this.stopTypingNow();
          this.peerTyping.set(false);
          this.newChatPopupOpen.set(false);
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
    if (this.imagePreviewUrl()) {
      ev.preventDefault();
      this.closeImagePreview();
      return;
    }
    if (this.view() === 'thread') {
      ev.preventDefault();
      this.backToList();
      return;
    }
    if (this.newChatPopupOpen()) {
      ev.preventDefault();
      this.closeNewChatPopup();
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
    if (this.view() === 'thread' && this.selectedBoxId() !== null) {
      this.reloadThreadMessages();
    }
  }

  toggleMessageSearch(): void {
    const next = !this.messageSearchOpen();
    this.messageSearchOpen.set(next);
    if (!next) {
      const hadApplied = this.messageSearchApplied().trim().length > 0;
      this.messageSearchDraft.set('');
      this.messageSearchApplied.set('');
      if (hadApplied && this.view() === 'thread' && this.selectedBoxId() !== null) {
        this.reloadThreadMessages();
      }
    }
  }

  openThread(box: ChatBox, emitRead = false): void {
    const sameThread = this.view() === 'thread' && this.selectedBoxId() === box.id;
    if (sameThread) {
      if (emitRead) this.socket.emitChatRead(box.id);
      return;
    }

    this.threadMessagesEpoch++;
    this.messageSearchDraft.set('');
    this.messageSearchApplied.set('');
    this.stopTypingNow();
    this.resetCallState();
    this.peerTyping.set(false);
    this.selectedBoxId.set(box.id);
    this.selectedTitle.set(box.displayName?.trim() || 'Chat');
    this.view.set('thread');
    this.messages.set([]);
    this.messagesNext.set(null);
    this.threadMessagesError.set(null);
    this.socket.joinBox(box.id);
    this.loadThreadMessagesInitial();
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
    const boxId = +p.boxId!;
    if (!(boxId >= 1)) return;
    const lm = p.lastMessage;
    if (typeof lm === 'string' && lm.trim()) {
      this.patchBoxPreview(boxId, lm, undefined, { clearLastMessageSenderWhenNoId: true });
    }
    const vid = getChatViewerUserId();
    const isActiveThreadBox =
      this.dock.panelOpen() &&
      this.view() === 'thread' &&
      this.selectedBoxId() === boxId;

    const ur =
      p.unreadReceiverCount != null ? Math.max(0, Math.floor(+p.unreadReceiverCount)) : null;
    const us = p.unreadSenderCount != null ? Math.max(0, Math.floor(+p.unreadSenderCount)) : null;
    const hasTotals = ur !== null || us !== null;
    const legacyCount =
      p.unreadCount != null
        ? Math.max(0, Math.floor(+p.unreadCount))
        : p.count != null
          ? Math.max(0, Math.floor(+p.count))
          : null;

    let viewerUnreadNext: number | null = null;

    this.boxes.update((list) => {
      const i = list.findIndex((b) => b.id === boxId);
      if (i < 0) {
        if (isActiveThreadBox) viewerUnreadNext = 0;
        else if (legacyCount !== null) viewerUnreadNext = legacyCount;
        else if (hasTotals) {
          viewerUnreadNext = Math.max(ur ?? 0, us ?? 0);
        }
        return list;
      }

      const b = list[i];
      let next: ChatBox = { ...b };

      if (isActiveThreadBox && vid !== null) {
        next = patchBoxViewerUnread(b, 0, vid);
      } else if (hasTotals) {
        if (ur !== null) next.unreadReceiverCount = ur;
        if (us !== null) next.unreadSenderCount = us;
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
    this.newChatPopupOpen.set(true);
  }

  closeNewChatPopup(): void {
    if (this.creating()) return;
    this.newChatPopupOpen.set(false);
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
          this.newChatPopupOpen.set(false);
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

  canRecallMessage(msg: ChatMessage): boolean {
    if (!this.isMine(msg)) return false;
    if (this.isPendingUpload(msg)) return false;
    const id = +msg.id;
    if (!(id >= 1 && id <= 2147483647)) return false;
    if (this.isRecalledMessageBody(msg.message)) return false;
    return true;
  }

  recallMessage(msg: ChatMessage): void {
    if (!this.canRecallMessage(msg)) return;
    const boxId = this.selectedBoxId();
    const messageId = +msg.id;
    if (boxId === null) return;
    this.recallingMessageIds.update((prev) => {
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
    this.chatService
      .recallMessage(boxId, messageId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.applyRecalledMessage(boxId, messageId, 'Tin nhắn này đã bị thu hồi');
          this.recallingMessageIds.update((prev) => {
            const next = new Set(prev);
            next.delete(messageId);
            return next;
          });
        },
        error: () => {
          this.sendError.set('Thu hồi tin nhắn thất bại.');
          this.recallingMessageIds.update((prev) => {
            const next = new Set(prev);
            next.delete(messageId);
            return next;
          });
        },
      });
  }

  triggerImagePicker(): void {
    this.chatImageInput?.nativeElement?.click();
  }

  onImagePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    void this.sendImageFiles(files);
  }

  onChatDragOver(event: DragEvent): void {
    if (!this.hasImageDrag(event)) return;
    event.preventDefault();
    this.chatDragOver.set(true);
  }

  onChatDragLeave(event: DragEvent): void {
    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as Node | null;
    if (related && current?.contains(related)) return;
    this.chatDragOver.set(false);
  }

  onChatDrop(event: DragEvent): void {
    if (!this.hasImageDrag(event)) return;
    event.preventDefault();
    this.chatDragOver.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    void this.sendImageFiles(files);
  }

  openImagePreview(url: string): void {
    this.imagePreviewUrl.set(url);
  }

  closeImagePreview(): void {
    this.imagePreviewUrl.set(null);
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

  onMessageScroll(event: Event): void {
    if (this.view() !== 'thread') return;
    const el = event.target as HTMLElement;
    if (el.scrollTop > 80) return;
    const cursor = this.messagesNext();
    if (cursor === null || this.loadingOlderMessages() || this.loadingThreadMessages()) return;
    if (this.messagesHistoryLoadInFlight) return;
    this.loadMoreThreadMessages(cursor);
  }

  retryLoadThreadMessages(): void {
    this.reloadThreadMessages();
  }

  private loadThreadMessagesInitial(): void {
    const boxId = this.selectedBoxId();
    if (boxId === null) return;
    const epoch = this.threadMessagesEpoch;
    this.threadMessagesError.set(null);
    this.loadingThreadMessages.set(true);
    this.messagesNext.set(null);
    this.chatService
      .listMessages(boxId, {
        limit: 10,
        message: this.messageSearchApplied().trim() || undefined,
      })
      .pipe(
        finalize(() => this.loadingThreadMessages.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          if (epoch !== this.threadMessagesEpoch || this.selectedBoxId() !== boxId) {
            return;
          }
          const raw = res.messages ?? [];
          this.messages.set(
            this.coalesceSenderNamesInThread(this.sortMessages(raw)),
          );
          this.messagesNext.set(this.readNextPageCursor(res));
          this.scrollToBottom();
        },
        error: (err: unknown) => {
          if (epoch !== this.threadMessagesEpoch || this.selectedBoxId() !== boxId) {
            return;
          }
          this.threadMessagesError.set(
            httpErrMessage(err) || 'Không tải được tin nhắn.',
          );
        },
      });
  }

  private reloadThreadMessages(): void {
    const boxId = this.selectedBoxId();
    if (boxId === null) return;
    this.threadMessagesEpoch++;
    this.messages.set([]);
    this.messagesNext.set(null);
    this.threadMessagesError.set(null);
    this.loadThreadMessagesInitial();
  }

  private loadMoreThreadMessages(nextCursor: number): void {
    const boxId = this.selectedBoxId();
    if (boxId === null) return;
    const epoch = this.threadMessagesEpoch;
    this.messagesHistoryLoadInFlight = true;
    this.loadingOlderMessages.set(true);
    this.chatService
      .listMessages(boxId, {
        limit: 10,
        next: nextCursor,
        message: this.messageSearchApplied().trim() || undefined,
      })
      .pipe(
        finalize(() => {
          this.messagesHistoryLoadInFlight = false;
          this.loadingOlderMessages.set(false);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          if (epoch !== this.threadMessagesEpoch || this.selectedBoxId() !== boxId) {
            return;
          }
          const raw = res.messages ?? [];
          const have = new Set(this.messages().map((m) => +m.id));
          const fresh = raw.filter((m) => !have.has(+m.id));
          if (!fresh.length) {
            this.messagesNext.set(null);
            return;
          }
          this.prependOlderChunk(
            this.coalesceSenderNamesInThread(this.sortMessages(fresh)),
          );
          this.messagesNext.set(this.readNextPageCursor(res));
        },
        error: () => {
          /* giữ scroll; có thể thử lại bằng cuộn lại */
        },
      });
  }

  /** API `next` hoặc min(id) trong trang khi `next` null. */
  private readNextPageCursor(res: ChatMessagesListResponse): number | null {
    if (res.next != null) return +res.next;
    const ids = (res.messages ?? []).map((m) => +m.id).filter((id) => id > 0);
    return ids.length ? Math.min(...ids) : null;
  }

  private prependOlderChunk(olderSorted: ChatMessage[]): void {
    const el = this.messageScroll?.nativeElement;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    const prevScrollTop = el?.scrollTop ?? 0;
    this.messages.update((list) =>
      this.coalesceSenderNamesInThread(this.sortMessages([...olderSorted, ...list])),
    );
    requestAnimationFrame(() => {
      const box = this.messageScroll?.nativeElement;
      if (!box) return;
      box.scrollTop = box.scrollHeight - prevScrollHeight + prevScrollTop;
    });
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
    const s = box.senderId != null ? +box.senderId : NaN;
    const r = box.receiverId != null ? +box.receiverId : NaN;
    if (!Number.isNaN(s) && !Number.isNaN(r) && me !== null) {
      return s === me ? r : r === me ? s : s;
    }
    if (!Number.isNaN(s) && (me === null || s !== me)) return s;
    if (!Number.isNaN(r) && (me === null || r !== me)) return r;
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
      const id = +m.id;
      if (id > 0) {
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
    this.scrollToBottom();
  }

  private appendLocalImagePending(boxId: number, localUrl: string): number {
    const uid = getChatViewerUserId();
    const tempId = Date.now();
    const optimistic: ChatMessage & { pendingUpload?: boolean } = {
      id: tempId,
      message: localUrl,
      senderId: uid ?? -1,
      fullName: storedUserFullName(),
      createdAt: new Date().toISOString(),
      pendingUpload: true,
    };
    this.messages.update((list) =>
      this.coalesceSenderNamesInThread(this.sortMessages([...list, optimistic])),
    );
    this.patchBoxPreview(boxId, '[Ảnh]', positiveSenderId(uid));
    this.scrollToBottom();
    return tempId;
  }

  private markPendingImageUploaded(boxId: number, tempId: number, remoteUrl: string): void {
    this.messages.update((list) =>
      list.map((m) =>
        m.id === tempId
          ? ({ ...m, message: remoteUrl, pendingUpload: false } as ChatMessage & {
            pendingUpload?: boolean;
          })
          : m,
      ),
    );
    this.patchBoxPreview(boxId, '[Ảnh]', positiveSenderId(getChatViewerUserId()));
    this.cleanupPendingObjectUrl(tempId);
  }

  private removePendingImage(boxId: number, tempId: number): void {
    this.messages.update((list) => list.filter((m) => m.id !== tempId));
    this.cleanupPendingObjectUrl(tempId);
  }

  isPendingUpload(msg: ChatMessage): boolean {
    return Boolean((msg as ChatMessage & { pendingUpload?: boolean }).pendingUpload);
  }

  private cleanupPendingObjectUrl(tempId: number): void {
    const objectUrl = this.pendingImageObjectUrls.get(tempId);
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    this.pendingImageObjectUrls.delete(tempId);
  }

  extractImageUrl(value: string | null | undefined): string | null {
    const text = (value ?? '').trim();
    if (!text) return null;
    if (/^blob:/i.test(text)) return text;
    if (/^data:image\//i.test(text)) return text;
    if (!/^https?:\/\//i.test(text)) return null;
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(text)) return text;
    if (text.includes('/image/upload/')) return text;
    return null;
  }

  private async sendImageFiles(files: File[]): Promise<void> {
    if (!files.length) return;
    this.sendingImage.set(true);
    try {
      for (const file of files) {
        await this.sendSingleImageFile(file);
      }
    } finally {
      this.sendingImage.set(false);
    }
  }

  private async sendSingleImageFile(file: File): Promise<void> {
    const boxId = this.selectedBoxId();
    if (boxId === null) return;
    if (!file.type.startsWith('image/')) {
      this.sendError.set('Chỉ hỗ trợ tệp ảnh.');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    const tempId = this.appendLocalImagePending(boxId, localUrl);
    this.pendingImageObjectUrls.set(tempId, localUrl);
    this.sendError.set('');

    try {
      const presigned = await firstValueFrom(this.uploadService.getPresigned('chat', Date.now()));
      const uploadFile = await this.uploadService.prepareImageForUpload(file, presigned, {
        maxBytes: 12 * 1024 * 1024,
        minResizeBytes: 2 * 1024 * 1024,
        maxDimension: 1440,
        preferredOutputType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        quality: 0.86,
      });
      const imageUrl = await this.uploadService.uploadImageToCloudinary(uploadFile, presigned);
      await firstValueFrom(this.chatService.sendMessage(boxId, { message: imageUrl }));
      this.socket.emitMessageSend(boxId, imageUrl);
      this.markPendingImageUploaded(boxId, tempId, imageUrl);
    } catch (err: unknown) {
      this.removePendingImage(boxId, tempId);
      const msg = err instanceof Error ? err.message : httpErrMessage(err) || 'Gửi ảnh thất bại.';
      this.sendError.set(msg);
    }
  }

  private hasImageDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files');
  }

  private isRecalledMessageBody(value: string | null | undefined): boolean {
    const text = (value ?? '').trim().toLowerCase();
    if (!text) return false;
    const normalized = text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ');
    return normalized.includes('thu hoi') && normalized.includes('tin nhan');
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

  private handleMessageRecalled(p: ChatMessageRecalledPayload): void {
    const boxId = Number(p.boxId);
    const messageId = Number(p.messageId);
    if (!Number.isFinite(boxId) || !Number.isFinite(messageId)) return;
    this.applyRecalledMessage(boxId, messageId, p.body);
  }

  private applyRecalledMessage(boxId: number, messageId: number, body: string): void {
    let changed = false;
    this.messages.update((list) =>
      list.map((m) => {
        if (Number(m.id) !== messageId) return m;
        changed = true;
        return { ...m, message: body };
      }),
    );
    if (!changed) return;
    this.recallingMessageIds.update((prev) => {
      if (!prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
    if (this.selectedBoxId() === boxId) {
      const list = this.messages();
      const last = list[list.length - 1];
      if (last?.message?.trim()) {
        this.patchBoxPreview(boxId, last.message, positiveSenderId(last.senderId));
      }
    }
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
      this.refreshCallLocalPipVisible();
    });
  }

  private refreshCallLocalPipVisible(): void {
    const show =
      this.activeCallType() === 'video' &&
      !!this.localStream?.getVideoTracks().some((t) => t.readyState !== 'ended');
    this.callLocalPipVisible.set(show);
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
    this.refreshCallLocalPipVisible();
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

