import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { BalanceMoneyItem } from '@app/data/interfaces/balance';

@Component({
  selector: 'app-balance-status-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './balance-status-card.component.html',
  styleUrl: './balance-status-card.component.css',
})
export class BalanceStatusCardComponent {
  @Input({ required: true }) title = '';
  @Input({ required: true }) hint = '';
  @Input({ required: true }) section!: 'available' | 'pending';
  @Input({ required: true }) items: BalanceMoneyItem[] = [];
  @Input({ required: true }) amountFormatter!: (item: BalanceMoneyItem) => string;
  @Input({ required: true }) contextFormatter!: (item: BalanceMoneyItem, section: 'available' | 'pending') => string;

  trackByIndex(index: number): number {
    return index;
  }
}
