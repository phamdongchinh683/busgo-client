import { Injectable, signal } from '@angular/core';
import type { PageToastType } from '../types/page-toast';

@Injectable({ providedIn: 'root' })
export class PageToastService {
  readonly visible = signal(false);
  readonly message = signal('');
  readonly type = signal<PageToastType>('info');

  show(message: string, type: PageToastType = 'info'): void {
    this.message.set(message);
    this.type.set(type);
    this.visible.set(true);
  }

  hide(): void {
    this.visible.set(false);
  }
}
