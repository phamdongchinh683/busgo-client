import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { ChatCallType } from '@app/core/services/chat-socket.service';

@Component({
  selector: 'app-chat-call-popup',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-call-popup.component.html',
  styleUrl: './chat-call-popup.component.css',
})
export class ChatCallPopupComponent {
  readonly visible = input(false);
  readonly status = input('');
  readonly callType = input<ChatCallType | null>(null);
  readonly incoming = input(false);
  readonly ongoing = input(false);
  readonly title = input('');
  /** Ảnh đại diện người gọi (nếu có); không có thì hiển thị chữ cái đầu. */
  readonly avatarUrl = input('');

  readonly accept = output<void>();
  readonly reject = output<void>();
  readonly end = output<void>();

  onAccept(): void {
    this.accept.emit();
  }

  onReject(): void {
    this.reject.emit();
  }

  onEnd(): void {
    this.end.emit();
  }

  initials(name: string): string {
    const words = name.trim().split(/\s+/).slice(0, 2);
    return words.map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  }
}
