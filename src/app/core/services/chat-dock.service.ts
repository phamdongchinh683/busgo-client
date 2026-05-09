import { Injectable, signal } from '@angular/core';
import { ChatBox } from '@app/data/interfaces/chat';
import { viewerUnreadCount } from '@app/core/utils/chat-box-list';

@Injectable({ providedIn: 'root' })
export class ChatDockService {
  readonly panelOpen = signal(false);
  readonly unreadCount = signal(0);
  readonly panelAnchor = signal<{ top: number; right: number } | null>(null);

  private readonly _panelOpenedViaHeaderToggle = signal(false);
  private lastUnreadByBox = new Map<number, number>();

  togglePanel(anchor?: { top: number; right: number }): void {
    if (anchor) this.panelAnchor.set(anchor);
    if (this.panelOpen()) {
      this.panelOpen.set(false);
      this.recomputeUnreadBadgeFromMap();
      return;
    }
    this._panelOpenedViaHeaderToggle.set(true);
    this.panelOpen.set(true);
    this.unreadCount.set(0);
  }

  consumePanelOpenedViaHeaderToggle(): boolean {
    const v = this._panelOpenedViaHeaderToggle();
    this._panelOpenedViaHeaderToggle.set(false);
    return v;
  }

  closePanel(): void {
    this.panelOpen.set(false);
    this.recomputeUnreadBadgeFromMap();
  }

  bumpUnreadIfNeeded(panelOpen: boolean, activeBoxId: number | null, eventBoxId: number): void {
    let should = false;
    if (!panelOpen) should = true;
    else if (activeBoxId === null || activeBoxId !== eventBoxId) should = true;
    if (!should) return;

    const id = +eventBoxId;

    const cur = this.lastUnreadByBox.get(id) ?? 0;
    this.lastUnreadByBox.set(id, cur + 1);
    this.unreadCount.update((n) => Math.min(99, n + 1));
  }

  syncUnreadBaselineFromBoxes(boxes: ChatBox[], viewerId: number | null, merge = false): void {
    const vid = viewerId;
    if (vid === null) {
      if (!merge) {
        this.lastUnreadByBox.clear();
        this.unreadCount.set(0);
      }
      return;
    }
    if (!merge) this.lastUnreadByBox.clear();
    for (const b of boxes) {
      this.lastUnreadByBox.set(b.id, viewerUnreadCount(b, vid));
    }
    this.recomputeUnreadBadgeFromMap();
  }

  applySocketUnreadCount(boxId: number, count: number): void {
    const id = +boxId;
    const next = Math.max(0, Math.floor(Number(count)));
    const prev = this.lastUnreadByBox.get(id) ?? 0;
    this.lastUnreadByBox.set(id, next);
    this.unreadCount.update((n) => Math.min(99, Math.max(0, n - prev + next)));
  }

  seedUnreadBadgeFromApi(totalUnread: number): void {
    this.unreadCount.set(Math.min(99, Math.max(0, Math.floor(totalUnread))));
  }

  clearUnreadState(): void {
    this.lastUnreadByBox.clear();
    this.unreadCount.set(0);
  }

  private recomputeUnreadBadgeFromMap(): void {
    let sum = 0;
    this.lastUnreadByBox.forEach((v) => (sum += v));
    this.unreadCount.set(Math.min(99, sum));
  }
}
