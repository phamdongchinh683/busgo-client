import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  Injector,
  Input,
  OnInit,
  Output,
  ViewChild,
  afterNextRender,
  effect,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import { timeout } from 'rxjs/operators';
import { notification } from '../../../../data/services';
import { ChatDockService } from '../../../../core/services/chat-dock.service';
import { NotificationItem, NotificationStatus, VerifyAccountStatus } from '../../../../data/interfaces/notification';
import { Messaging } from '@angular/fire/messaging';
import { onMessage } from 'firebase/messaging';

@Component({
  selector: 'app-main-topbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './main-topbar.component.html',
  styleUrl: './main-topbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainTopbarComponent implements OnInit {
  selectedNotificationStatus: NotificationStatus | null = null;

  @Input() pageTitle = '';

  @Output() signOut = new EventEmitter<void>();

  notifications: NotificationItem[] = [];
  isNotificationOpen = false;
  isLoadingNotifications = false;
  isLoadingMore = false;
  nextCursor: number | null = null;
  isFetching = false;
  private pendingLoadMore = false;
  private pendingFilterReload = false;
  private hasLoadedNotifications = false;
  private loadedNotificationStatus: NotificationStatus | null | undefined;
  selectedNotification: NotificationItem | null = null;
  isVerifyDialogOpen = false;
  isVerifyingAccount = false;
  verifyErrorMessage = '';
  private readonly newNotificationIds = new Set<string>();

  @ViewChild('notificationMenu') private notificationMenuRef?: ElementRef<HTMLElement>;
  @ViewChild('notificationRoot') private notificationRootRef?: ElementRef<HTMLElement>;

  readonly verifyStatuses: Array<{ value: VerifyAccountStatus; label: string }> = [
    { value: 'active', label: 'Hoạt động' },
    { value: 'inactive', label: 'Tạm ngưng' },
    { value: 'banned', label: 'Bị cấm' },
  ];

  private readonly notificationApi = inject(notification.ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly messaging = inject(Messaging);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  readonly chatDock = inject(ChatDockService);

  constructor() {
    effect(() => {
      this.chatDock.unreadCount();
      this.chatDock.panelOpen();
      this.cdr.markForCheck();
    });
  }

  ngOnInit() {
    const unsubscribe = onMessage(this.messaging, (payload) => {
      this.handleIncomingFcmPayload(payload);
    });
    this.destroyRef.onDestroy(() => unsubscribe());

    const swMessageHandler = (event: MessageEvent) => {
      if (event.data?.type !== 'FCM_BACKGROUND_MESSAGE') return;
      this.handleIncomingFcmPayload(event.data.payload);
    };
    navigator.serviceWorker?.addEventListener('message', swMessageHandler);
    this.destroyRef.onDestroy(() => navigator.serviceWorker?.removeEventListener('message', swMessageHandler));

    this.destroyRef.onDestroy(() => {
      document.body.classList.remove('notification-menu-open');
      this.unmountNotificationMenu();
    });

    const onScrollReposition = () => {
      if (!this.isNotificationOpen) return;
      this.syncNotificationMenuPosition();
    };
    document.addEventListener('scroll', onScrollReposition, { capture: true, passive: true });
    this.destroyRef.onDestroy(() =>
      document.removeEventListener('scroll', onScrollReposition, { capture: true }),
    );

    this.prefetchNotifications();
  }

  get unreadCount(): number {
    return this.notifications.reduce((count, noti) => count + (noti.isRead ? 0 : 1), 0);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    if (!this.isNotificationOpen || this.isVerifyDialogOpen) return;
    const target = event.target as Node | null;
    if (!target) return;
    const root = this.notificationRootRef?.nativeElement ?? this.host.nativeElement;
    const menu = this.notificationMenuRef?.nativeElement;
    if (!root.contains(target) && !menu?.contains(target)) {
      this.closeNotificationMenu();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;

    if (this.chatDock.panelOpen()) {
      return;
    }

    if (this.isVerifyDialogOpen) {
      if (!this.isVerifyingAccount) {
        event.preventDefault();
        this.closeVerifyDialog();
      }
      return;
    }

    if (this.isNotificationOpen) {
      event.preventDefault();
      this.closeNotificationMenu();
    }
  }

  toggleNotifications() {
    if (this.isNotificationOpen) {
      this.closeNotificationMenu();
      return;
    }

    if (this.chatDock.panelOpen()) {
      this.chatDock.closePanel();
    }

    this.isNotificationOpen = true;
    document.body.classList.add('notification-menu-open');
    this.ensureNotificationsLoaded();
    afterNextRender(
      () => {
        this.mountNotificationMenu();
        this.syncNotificationMenuPosition();
        this.cdr.markForCheck();
      },
      { injector: this.injector },
    );
    this.cdr.markForCheck();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.isNotificationOpen) return;
    this.syncNotificationMenuPosition();
  }

  private ensureNotificationsLoaded(force = false): void {
    const status = this.selectedNotificationStatus;
    const hasCachedData =
      this.hasLoadedNotifications &&
      this.loadedNotificationStatus === status &&
      this.notifications.length > 0;

    if (!force && (hasCachedData || this.isFetching)) {
      if (this.isFetching) {
        this.isLoadingNotifications = true;
      }
      return;
    }

    if (!this.isFetching) {
      this.loadNotifications();
    }
  }

  private prefetchNotifications(): void {
    if (this.isFetching || this.hasLoadedNotifications) return;
    this.loadNotifications({ background: true });
  }

  private syncNotificationMenuPosition(): void {
    const root = this.notificationRootRef?.nativeElement;
    const menu = this.notificationMenuRef?.nativeElement;
    if (!root || !menu) return;

    const rect = root.getBoundingClientRect();
    const gutter = 12;
    const width = Math.min(400, window.innerWidth - 24);
    const maxHeight = Math.min(480, window.innerHeight - rect.bottom - gutter - 16);

    menu.style.setProperty('--notification-menu-top', `${Math.round(rect.bottom + gutter)}px`);
    menu.style.setProperty('--notification-menu-right', `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`);
    menu.style.setProperty('--notification-menu-width', `${Math.round(width)}px`);
    menu.style.setProperty('--notification-menu-max-height', `${Math.max(220, Math.round(maxHeight))}px`);
  }

  private mountNotificationMenu(): void {
    const menu = this.notificationMenuRef?.nativeElement;
    if (!menu || menu.parentElement === document.body) return;
    document.body.appendChild(menu);
  }

  private unmountNotificationMenu(): void {
    const menu = this.notificationMenuRef?.nativeElement;
    const root = this.notificationRootRef?.nativeElement;
    if (!menu || !root || menu.parentElement !== document.body) return;
    root.appendChild(menu);
  }

  private closeNotificationMenu(): void {
    if (!this.isNotificationOpen) return;
    this.isNotificationOpen = false;
    document.body.classList.remove('notification-menu-open');
    this.unmountNotificationMenu();
    this.cdr.markForCheck();
  }

  onChatButtonClick(button: HTMLElement): void {
    const chatWasOpen = this.chatDock.panelOpen();
    if (!chatWasOpen && this.isNotificationOpen) {
      this.closeNotificationMenu();
    }
    const rect = button.getBoundingClientRect();
    this.chatDock.togglePanel({
      top: Math.round(rect.bottom + 10),
      right: Math.max(8, Math.round(window.innerWidth - rect.right)),
    });
  }

  onNotificationScroll(event: Event) {
    if (this.nextCursor === null) return;
    const target = (event.currentTarget ?? event.target) as HTMLElement | null;
    if (!target) return;
    const reachedBottom = this.isMenuNearBottom(target);
    if (!reachedBottom) return;
    if (this.isFetching) {
      this.pendingLoadMore = true;
      return;
    }
    this.loadMoreNotifications();
  }

  onNotificationClick(event: Event, noti: NotificationItem) {
    event.stopPropagation();
    this.markNotificationAsRead(noti);
    this.openVerifyDialog(noti);
  }

  onLoadMoreNotificationsClick(event: Event): void {
    event.stopPropagation();
    if (this.isFetching) {
      this.pendingLoadMore = true;
      return;
    }
    this.loadMoreNotifications();
  }

  isNewNotification(noti: NotificationItem): boolean {
    return this.newNotificationIds.has(String(noti.id));
  }

  canShowVerifyActions(noti: NotificationItem | null): boolean {
    if (!noti) return false;
    if (this.resolveUserNewAccountId(noti) !== undefined) return true;
    const normalizedTitle = this.normalizeTextForMatching(noti.title);
    return normalizedTitle.includes('hien tai co yeu cau tao');
  }

  closeVerifyDialog() {
    this.isVerifyDialogOpen = false;
    this.selectedNotification = null;
    this.verifyErrorMessage = '';
    this.isVerifyingAccount = false;

    this.cdr.markForCheck();
  }

  submitVerifyAccount(status: VerifyAccountStatus) {
    if (!this.selectedNotification || this.isVerifyingAccount) return;

    const accountId = this.resolveUserNewAccountId(this.selectedNotification);
    if (accountId === '' || accountId === null || accountId === undefined) {
      this.verifyErrorMessage = 'Không tìm thấy mã tài khoản để xác minh.';
      this.cdr.markForCheck();
      return;
    }

    this.verifyErrorMessage = '';
    this.isVerifyingAccount = true;
    this.notificationApi
      .verifyAccount({ id: Number(accountId), status })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        timeout(15000),
        finalize(() => {
          this.isVerifyingAccount = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: () => {
          this.isVerifyDialogOpen = false;
          this.selectedNotification = null;
        },
        error: (err: unknown) => {
          this.verifyErrorMessage = this.extractErrorMessage(err);
        },
      });
  }

  notificationTitle(noti: NotificationItem): string {
    return noti.title?.trim() || 'Thông báo';
  }

  notificationBody(noti: NotificationItem): string {
    return noti.body?.trim() || '';
  }

  trackByNotificationId(_index: number, noti: NotificationItem): string {
    return String(noti.id);
  }

  setNotificationStatusFilter(status: NotificationStatus | null): void {
    if (this.selectedNotificationStatus === status) return;

    this.selectedNotificationStatus = status;
    this.nextCursor = null;
    this.pendingLoadMore = false;
    this.cdr.markForCheck();

    if (this.isFetching) {
      this.pendingFilterReload = true;
      return;
    }

    this.loadNotifications({ force: true });
  }

  private loadNotifications(options: { background?: boolean; force?: boolean } = {}) {
    if (this.isFetching) return;

    const status = this.selectedNotificationStatus;
    const hasCachedData =
      this.hasLoadedNotifications &&
      this.loadedNotificationStatus === status &&
      this.notifications.length > 0;

    if (!options.force && hasCachedData) {
      return;
    }

    this.pendingLoadMore = false;
    this.isFetching = true;

    const showLoading = options.background !== true || this.isNotificationOpen;
    if (showLoading) {
      this.isLoadingNotifications = true;
    }

    this.cdr.markForCheck();

    this.notificationApi
      .getNotifications(undefined, status)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.isFetching = false;
          this.isLoadingNotifications = false;
          this.cdr.markForCheck();
          if (this.flushPendingFilterReload()) return;
          this.flushPendingLoadMore();
        }),
      )
      .subscribe({
        next: (res) => {
          const incoming = res.notifications ? res.notifications.map((item) => this.normalizeNotification(item)) : [];
          this.notifications = incoming;
          this.nextCursor = this.parseNextCursor(res.next);
          this.hasLoadedNotifications = true;
          this.loadedNotificationStatus = status;
          this.cdr.markForCheck();
          if (this.isNotificationOpen) {
            queueMicrotask(() => {
              this.mountNotificationMenu();
              this.syncNotificationMenuPosition();
            });
          }
        },
        error: () => {
          this.cdr.markForCheck();
        },
      });
  }

  private loadMoreNotifications() {
    if (this.nextCursor === null) return;
    if (this.isFetching) {
      this.pendingLoadMore = true;
      return;
    }

    this.isFetching = true;
    this.isLoadingMore = true;
    const next = this.nextCursor;

    this.notificationApi
      .getNotifications(next, this.selectedNotificationStatus)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.isFetching = false;
          this.isLoadingMore = false;
          this.cdr.markForCheck();
          if (this.flushPendingFilterReload()) return;
          this.flushPendingLoadMore();
        }),
      )
      .subscribe({
        next: (res) => {
          const incoming = res.notifications ? res.notifications.map((item) => this.normalizeNotification(item)) : [];
          this.notifications = [...this.notifications, ...incoming];
          this.nextCursor = this.parseNextCursor(res.next);
          this.cdr.markForCheck();
          this.loadMoreIfNearBottom();
        },
        error: () => {
          this.cdr.markForCheck();
        },
      });
  }

  private loadMoreIfNearBottom(): void {
    queueMicrotask(() => {
      const menu = this.notificationMenuRef?.nativeElement;
      if (!menu || !this.isNotificationOpen || this.isFetching || this.nextCursor === null) return;
      if (this.isMenuNearBottom(menu)) {
        this.loadMoreNotifications();
      }
    });
  }

  private isMenuNearBottom(menu: HTMLElement): boolean {
    const threshold = 120;
    return menu.scrollHeight - menu.scrollTop - menu.clientHeight <= threshold;
  }

  private flushPendingLoadMore(): void {
    if (!this.pendingLoadMore || this.nextCursor === null || this.isFetching) return;
    this.pendingLoadMore = false;
    this.loadMoreNotifications();
  }

  private flushPendingFilterReload(): boolean {
    if (!this.pendingFilterReload || this.isFetching) return false;
    this.pendingFilterReload = false;
    this.loadNotifications({ force: true });
    return true;
  }

  private parseNextCursor(next: unknown): number | null {
    if (typeof next === 'number' && Number.isFinite(next)) return next;
    return null;
  }

  private handleIncomingFcmPayload(payload: {
    notification?: {
      title?: string;
      body?: string;
    };
    data?: Record<string, string>;
  }) {
    const incoming: NotificationItem = {
      id: payload.data?.['id'] ?? '',
      userId: payload.data?.['userId'] ?? '',
      title: payload.notification?.title ?? '',
      body: payload.notification?.body ?? '',
      data: payload.data,
      isRead: false,
    };
    const menu = this.notificationMenuRef?.nativeElement;
    const previousScrollTop = menu?.scrollTop ?? 0;
    const previousScrollHeight = menu?.scrollHeight ?? 0;
    const wasNearTop = previousScrollTop <= 8;

    const normalizedIncoming = this.normalizeNotification(incoming);
    this.notifications = [normalizedIncoming, ...this.notifications];
    this.newNotificationIds.add(String(normalizedIncoming.id));
    setTimeout(() => {
      this.newNotificationIds.delete(String(normalizedIncoming.id));
      this.cdr.markForCheck();
    }, 2200);

    queueMicrotask(() => {
      const currentMenu = this.notificationMenuRef?.nativeElement;
      if (!currentMenu || !this.isNotificationOpen) return;
      if (wasNearTop) {
        currentMenu.scrollTop = 0;
        return;
      }
      const nextScrollHeight = currentMenu.scrollHeight;
      currentMenu.scrollTop = previousScrollTop + (nextScrollHeight - previousScrollHeight);
    });

    this.cdr.markForCheck();
  }

  private setReadStatus(notificationId: NotificationItem['id'], isRead: boolean): NotificationItem[] {
    return this.notifications.map((item) => (item.id === notificationId ? { ...item, isRead } : item));
  }

  private markNotificationAsRead(noti: NotificationItem) {
    if (noti.isRead) return;
    this.notifications = this.setReadStatus(noti.id, true);
    this.cdr.markForCheck();

    this.notificationApi
      .markAsRead(noti.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          this.notifications = this.setReadStatus(noti.id, false);
          this.cdr.markForCheck();
        },
      });
  }

  private openVerifyDialog(noti: NotificationItem) {
    this.selectedNotification = noti;
    this.isVerifyDialogOpen = true;
    this.verifyErrorMessage = '';

    this.cdr.markForCheck();
  }

  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'object' && err !== null) {
      const maybeError = err as { error?: { message?: unknown }; message?: unknown };
      if (typeof maybeError.error?.message === 'string' && maybeError.error.message.trim() !== '') {
        return maybeError.error.message;
      }
      if (typeof maybeError.message === 'string' && maybeError.message.trim() !== '') {
        return maybeError.message;
      }
    }
    return 'Xác minh tài khoản thất bại. Vui lòng thử lại.';
  }

  private normalizeNotification(item: NotificationItem): NotificationItem {
    const d = item.data;
    if (d == null) return item;
    if (typeof d !== 'string') return item;
    const trimmed = d.trim();
    if (trimmed === '') return item;
    try {
      return { ...item, data: JSON.parse(trimmed) as Record<string, unknown> };
    } catch {
      return item;
    }
  }

  private resolveUserNewAccountId(noti: NotificationItem): string | number | undefined {
    const data = this.getNotificationDataRecord(noti);
    const id = data?.['userNewAccountId'];
    if (id !== undefined && id !== null && String(id).trim() !== '') return id as string | number;
    return undefined;
  }

  private getNotificationDataRecord(noti: NotificationItem): Record<string, unknown> | null {
    const raw = noti.data;
    if (raw == null) return null;
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (t === '') return null;
      try {
        const parsed = JSON.parse(t) as unknown;
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    return null;
  }

  private normalizeTextForMatching(value: string | null | undefined): string {
    if (!value) return '';
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
