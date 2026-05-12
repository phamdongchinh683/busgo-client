import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, finalize, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { auth } from '../../data/services';
import { ChatSocketService } from '../../core/services/chat-socket.service';
import { FcmDeviceService } from '../../core/services/fcm-device.service';

@Component({
  selector: 'app-unauthorized',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './unauthorized.component.html',
  styleUrls: ['../shared/styles/status-page.css', './unauthorized.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnauthorizedComponent {
  private readonly router = inject(Router);
  private readonly api = inject(auth.ApiService);
  private readonly chatSocket = inject(ChatSocketService);
  private readonly fcmDeviceService = inject(FcmDeviceService);

  logout() {
    this.fcmDeviceService
      .removeCurrentDeviceToken()
      .pipe(
        switchMap(() => this.api.logout()),
        catchError(() => of(null)),
        finalize(() => this.clearSessionAndRedirect()),
      )
      .subscribe();
  }

  private clearSessionAndRedirect() {
    this.chatSocket.disconnect();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.router.navigate(['/login']);
  }
}
