import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { auth } from '../../data/services';
import { ChatSocketService } from '../../core/services/chat-socket.service';

@Component({
  selector: 'app-unauthorized',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './unauthorized.component.html',
  styleUrls: ['../shared/styles/status-page.css', './unauthorized.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnauthorizedComponent {
  constructor(
    private readonly router: Router,
    private readonly api: auth.ApiService,
    private readonly chatSocket: ChatSocketService,
  ) {}

  logout() {
    this.api.logout().subscribe(() => {
      this.chatSocket.disconnect();
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      this.router.navigate(['/login']);
    });
  }
}
