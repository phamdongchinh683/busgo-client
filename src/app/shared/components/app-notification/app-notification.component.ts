import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-notification',
  imports: [CommonModule],
  templateUrl: './app-notification.component.html',
  styleUrl: './app-notification.component.css',
})
export class AppNotificationComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() message = '';
  @Input() type: 'success' | 'error' | 'warning' | 'info' = 'info';
  @Input() duration = 1000;
  @Output() closed = new EventEmitter<void>();

  visible = true;
  isClosing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private portalPlaceholder: Comment | null = null;

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  get icon(): string {
    const icons: Record<string, string> = {
      success: '\u2713',
      error: '\u2717',
      warning: '\u26A0',
      info: '\u24D8',
    };
    return icons[this.type] || icons['info'];
  }

  ngOnInit() {
    this.timer = setTimeout(() => this.close(), this.duration);
  }

  ngAfterViewInit() {
    const host = this.host.nativeElement;
    const parent = host.parentElement;
    if (!parent || parent === document.body) return;

    this.portalPlaceholder = document.createComment('app-notification');
    parent.insertBefore(this.portalPlaceholder, host);
    document.body.appendChild(host);
    this.destroyRef.onDestroy(() => this.restorePortalHost());
  }

  close() {
    if (this.isClosing || !this.visible) return;
    this.isClosing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.closeTimer = setTimeout(() => {
      this.visible = false;
      this.closed.emit();
      this.closeTimer = null;
    }, 180);
  }

  ngOnDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
    }
    this.restorePortalHost();
  }

  private restorePortalHost(): void {
    const host = this.host.nativeElement;
    const placeholder = this.portalPlaceholder;
    if (!placeholder?.parentNode || host.parentElement !== document.body) {
      this.portalPlaceholder = null;
      return;
    }

    placeholder.parentNode.insertBefore(host, placeholder);
    placeholder.remove();
    this.portalPlaceholder = null;
  }
}
