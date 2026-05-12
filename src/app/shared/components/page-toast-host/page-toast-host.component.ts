import { Component, inject } from '@angular/core';
import { AppNotificationComponent } from '../app-notification/app-notification.component';
import { PageToastService } from '../../services/page-toast.service';

@Component({
  selector: 'app-page-toast-host',
  standalone: true,
  imports: [AppNotificationComponent],
  template: `
    @if (toast.visible()) {
      <app-notification
        [message]="toast.message()"
        [type]="toast.type()"
        (closed)="toast.hide()"
      />
    }
  `,
})
export class PageToastHostComponent {
  readonly toast = inject(PageToastService);
}
