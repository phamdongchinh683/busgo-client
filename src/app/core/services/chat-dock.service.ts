import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ChatDockService {
  readonly panelOpen = signal(false);
  readonly unreadCount = signal(0);

  private readonly _panelOpenedViaHeaderToggle = signal(false);

  togglePanel(): void {
    if (this.panelOpen()) {
      this.panelOpen.set(false);
    } else {
      this._panelOpenedViaHeaderToggle.set(true);
      this.panelOpen.set(true);
      this.unreadCount.set(0);
    }
  }

  consumePanelOpenedViaHeaderToggle(): boolean {
    const v = this._panelOpenedViaHeaderToggle();
    this._panelOpenedViaHeaderToggle.set(false);
    return v;
  }

  closePanel(): void {
    this.panelOpen.set(false);
  }

  bumpUnreadIfNeeded(panelOpen: boolean, activeBoxId: number | null, eventBoxId: number): void {
    if (!panelOpen) {
      this.unreadCount.update((n) => Math.min(99, n + 1));
      return;
    }
    if (activeBoxId === null || activeBoxId !== eventBoxId) {
      this.unreadCount.update((n) => Math.min(99, n + 1));
    }
  }
}
