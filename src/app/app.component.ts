import { Component, HostListener, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatSocketService } from './core/services/chat-socket.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
})
export class AppComponent {
  private readonly chatSocket = inject(ChatSocketService);

  @HostListener('window:beforeunload')
  @HostListener('window:pagehide')
  onWindowClose(): void {
    this.chatSocket.disconnect();
  }
}
