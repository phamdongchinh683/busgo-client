import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import { device } from '../../data/services';
import { DeviceFcmToken } from '../../data/interfaces/device';
import { FcmDeviceService } from '../../core/services/fcm-device.service';
import { PageToastHostComponent } from '../../shared/components/page-toast-host/page-toast-host.component';
import { PageHeaderIntroComponent } from '../../shared/components/page-header-intro/page-header-intro.component';
import { PageToastService } from '../../shared/services/page-toast.service';
import { Messaging } from '@angular/fire/messaging';
import { firebaseVapidKey, firebaseWebConfig } from '../../data/constants';
import { getToken, isSupported } from 'firebase/messaging';
import { getApiErrorMessage } from '@app/shared/utils/api-error.util';

@Component({
  selector: 'app-device',
  standalone: true,
  imports: [CommonModule, PageToastHostComponent, PageHeaderIntroComponent],
  templateUrl: './device.component.html',
  styleUrl: './device.component.css',
})
export class DeviceComponent implements OnInit {
  tokens: DeviceFcmToken[] = [];
  loading = false;
  registering = false;
  deletingId: number | null = null;
  currentFcmToken = '';

  private readonly toast = inject(PageToastService);
  private readonly deviceApi = inject(device.ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly messaging = inject(Messaging);
  private readonly fcmDeviceService = inject(FcmDeviceService);
  ngOnInit(): void {
    this.fetchTokens();
  }

  fetchTokens(): void {
    this.loading = true;
    this.deviceApi
      .getFcmTokens()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.tokens = res ? res : [];
          this.loading = false;
        },
        error: (err: unknown) => {
          this.loading = false;
          this.toast.show(getApiErrorMessage(err, 'Tải danh sách FCM token thất bại.'), 'error');
        },
      });
  }

  deleteToken(id: number): void {
    if (this.deletingId !== null || this.loading) return;
    this.deletingId = id;
    this.deviceApi
      .deleteFcmToken(id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.deletingId = null;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: () => {
          this.tokens = this.tokens.filter((item) => Number(item.id) !== Number(id));
          if (this.fcmDeviceService.getCurrentDeviceId() === Number(id)) {
            this.fcmDeviceService.clearCurrentDeviceId();
          }
          this.toast.show('Đã xóa', 'success');
          this.cdr.markForCheck();
        },
        error: (err: unknown) =>
          this.toast.show(getApiErrorMessage(err, 'Xóa FCM token thất bại.'), 'error'),
      });
  }

  registerCurrentDevice(): void {
    void this.saveFcmToken(true);
  }

  private async saveFcmToken(_force = false): Promise<void> {
    if (!this.supportsNotificationApi()) {
      this.toast.show('Trình duyệt này không hỗ trợ quyền thông báo', 'warning');
      return;
    }

    const permission = await this.requestNotificationPermission();
    if (permission !== 'granted') {
      this.toast.show('Bạn chưa cấp quyền thông báo.', 'warning');
      return;
    }

    const token = await this.getFirebaseToken();
    if (!token) {
      this.toast.show('Không thể lấy FCM token từ Firebase.', 'error');
      return;
    }

    if (this.tokens.some((item) => item.fcmToken === token)) {
      this.currentFcmToken = token;
      this.toast.show('Thiết bị này đã được đăng ký.', 'info');
      return;
    }

    this.persistToken(token);
  }

  private supportsNotificationApi(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  private async requestNotificationPermission(): Promise<NotificationPermission> {
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      return Notification.permission;
    }
    return Notification.requestPermission();
  }

  private async getFirebaseToken(): Promise<string | null> {
    if (!(await isSupported())) return null;
    const registration = await this.registerMessagingServiceWorker();
    if (!registration) return null;
    registration.active?.postMessage({
      type: 'INIT_FIREBASE_CONFIG',
      firebaseConfig: firebaseWebConfig,
    });

    try {
      const token = await getToken(this.messaging, {
        vapidKey: firebaseVapidKey,
        serviceWorkerRegistration: registration,
      });
      return token || null;
    } catch {
      return null;
    }
  }

  private async registerMessagingServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    try {
      return await navigator.serviceWorker.register('/firebase-messaging-sw.js', { type: 'module' });
    } catch {
      try {
        return await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      } catch {
        return null;
      }
    }
  }

  private persistToken(token: string): void {
    this.registering = true;
    this.deviceApi
      .saveFcmToken({ fcmToken: token })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: DeviceFcmToken) => {
          this.registering = false;
          if (!this.tokens.some((item) => Number(item.id) === Number(res.id) || item.fcmToken === res.fcmToken)) {
            this.tokens = [res, ...this.tokens];
          }
          this.currentFcmToken = res.fcmToken;
          if (res?.id != null) {
            this.fcmDeviceService.storeCurrentDeviceId(Number(res.id));
          }
          this.toast.show('Đã lưu', 'success');
          this.cdr.markForCheck();
        },
        error: (err: unknown) => {
          this.registering = false;
          this.toast.show(getApiErrorMessage(err, 'Lưu FCM token thất bại.'), 'error');
          this.cdr.markForCheck();
        },
      });
  }
}
