import { Component, DestroyRef, effect, inject, OnInit } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { filter, take, catchError, finalize, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { navItems } from '../../data/mocks';
import { auth } from '../../data/services';
import { MainSidebarComponent, type MainNavItem } from './components/main-sidebar/main-sidebar.component';
import { MainTopbarComponent } from './components/main-topbar/main-topbar.component';
import { ChatDockComponent } from './components/chat-dock/chat-dock.component';
import { FcmDeviceService } from '../../core/services/fcm-device.service';
import { ChatDockService } from '../../core/services/chat-dock.service';
import { ChatSocketService } from '../../core/services/chat-socket.service';
import { chat } from '../../data/services';
import { getChatViewerUserId, normalizeBoxPayload } from '../../core/utils/chat-box-list';
import { staffProfileRoleLabel } from '@app/shared/utils/domain-labels';
@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, MainSidebarComponent, MainTopbarComponent, ChatDockComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.css',
})
export class MainLayoutComponent implements OnInit {
  readonly currentYear = new Date().getFullYear();
  currentUrl = '';
  userName = 'Người dùng';
  userEmail = '';
  userRole = '';
  userInitial = 'U';
  notificationUnreadCount = 0;
  isMobileSidebarOpen = false;

  items: MainNavItem[] = navItems as MainNavItem[];

  private readonly pageTitles: Record<string, string> = {
    '/dashboard': 'Tổng quan',
    '/companies': 'Nhà xe',
    '/operators': 'Tài khoản nhà xe',
    '/promotions': 'Tin khuyến mãi',
    '/users': 'Người dùng',
    '/devices': 'Thiết bị',
    '/balance': 'Số dư',
    '/password': 'Đổi mật khẩu',
  };

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(auth.ApiService);
  private readonly title = inject(Title);
  private readonly fcmDeviceService = inject(FcmDeviceService);
  private readonly chatDock = inject(ChatDockService);
  private readonly chatSocket = inject(ChatSocketService);
  private readonly chatApi = inject(chat.ApiService);
  private hasRequestedNotificationAccess = false;

  get pageTitle(): string {
    return this.resolveTitleFromUrl(this.currentUrl);
  }

  constructor() {
    effect(() => {
      this.chatDock.unreadCount();
      this.updateDocumentTitle();
    });
  }

  ngOnInit() {
    this.destroyRef.onDestroy(() => {
      document.body.style.overflow = '';
    });

    this.loadUser();

    this.currentUrl = this.router.url;
    this.updateDocumentTitle();
    this.requestNotificationOnDashboard(this.currentUrl);
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        this.currentUrl = e.urlAfterRedirects || e.url;
        this.updateDocumentTitle();
        this.requestNotificationOnDashboard(this.currentUrl);
        // Close mobile drawer after navigation on small screens
        if (this.isMobileSidebarOpen) {
          this.closeMobileSidebar();
        }
      });

    this.prefetchChatUnreadBadgeFromBoxList();
  }

  private prefetchChatUnreadBadgeFromBoxList(): void {
    if (!localStorage.getItem('token')) return;
    this.chatApi
      .listBoxes(100)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const { boxes } = normalizeBoxPayload(res);
          this.chatDock.syncUnreadBaselineFromBoxes(boxes, getChatViewerUserId(), false);
        },
      });
  }

  logout() {
    this.fcmDeviceService
      .removeCurrentDeviceToken()
      .pipe(
        switchMap(() => this.api.logout()),
        catchError(() => of(null)),
        finalize(() => this.handleLogoutSuccess()),
      )
      .subscribe();
  }

  onNotificationUnreadChange(count: number): void {
    this.notificationUnreadCount = Math.max(0, Math.floor(Number(count) || 0));
    this.updateDocumentTitle();
  }

  toggleMobileSidebar(): void {
    this.isMobileSidebarOpen = !this.isMobileSidebarOpen;
    if (this.isMobileSidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }

  closeMobileSidebar(): void {
    if (this.isMobileSidebarOpen) {
      this.isMobileSidebarOpen = false;
      document.body.style.overflow = '';
    }
  }

  private loadUser() {
    const raw = localStorage.getItem('user');
    if (!raw) return;
    try {
      const user = JSON.parse(raw) as {
        fullName?: string;
        email?: string;
        staffProfileRole?: string;
        role?: string;
      };
      const rawRole = (user.staffProfileRole || user.role || '').trim();
      this.userName = user.fullName || '';
      this.userEmail = user.email || '';
      this.userRole = rawRole ? staffProfileRoleLabel(rawRole) : '';
      this.userInitial = this.userName.charAt(0).toUpperCase();
    } catch { }
  }

  private handleLogoutSuccess() {
    this.closeMobileSidebar();
    this.chatSocket.disconnect();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.notificationUnreadCount = 0;
    this.chatDock.clearUnreadState();
    this.title.setTitle('BusGo');
    this.router.navigate(['/login']);
  }

  private updateDocumentTitle(): void {
    const page = this.pageTitles[this.currentUrl] ?? this.resolveTitleFromUrl(this.currentUrl);
    const totalUnread = Math.min(99, this.notificationUnreadCount + this.chatDock.unreadCount());
    const prefix = totalUnread > 0 ? `(${totalUnread}) ` : '';
    this.title.setTitle(page === 'BusGo' ? `${prefix}BusGo` : `${prefix}${page} | BusGo`);
  }

  private resolveTitleFromUrl(url: string): string {
    const cleanUrl = (url || '').split('?')[0].split('#')[0];
    return this.pageTitles[cleanUrl] ?? 'BusGo';
  }

  private requestNotificationOnDashboard(url: string) {
    if (this.hasRequestedNotificationAccess || !url.startsWith('/dashboard')) return;
    this.hasRequestedNotificationAccess = true;
    setTimeout(() => {
      this.fcmDeviceService.ensureRegistered(true).subscribe();
    }, 0);
  }
}
