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

  @HostListener('document:contextmenu', ['$event'])
  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  @HostListener('document:selectstart', ['$event'])
  onSelectStart(event: Event): void {
    event.preventDefault();
  }

  @HostListener('document:dragstart', ['$event'])
  onDragStart(event: DragEvent): void {
    event.preventDefault();
  }

  @HostListener('document:copy', ['$event'])
  onCopy(event: ClipboardEvent): void {
    event.preventDefault();
  }

  @HostListener('document:cut', ['$event'])
  onCut(event: ClipboardEvent): void {
    event.preventDefault();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    const isCopy = (event.ctrlKey || event.metaKey) && key === 'c';
    const isCut = (event.ctrlKey || event.metaKey) && key === 'x';

    if (isCopy || isCut) {
      event.preventDefault();
    }
  }
}
