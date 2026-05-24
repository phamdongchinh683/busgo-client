import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Company } from '@app/data/interfaces/company';

@Component({
  selector: 'app-company-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app-company-list.component.html',
  styleUrl: './app-company-list.component.css',
})
export class AppCompanyListComponent {
  @Input() companies: Company[] = [];
  @Input() loading = false;
  @Output() editCompany = new EventEmitter<Company>();
  @Output() deleteCompany = new EventEmitter<Company>();

  readonly skeletonRows = Array.from({ length: 6 });

  displayReviewCount(v: number | string | undefined): string {
    if (v === undefined || v === null || v === '') return '-';
    if (typeof v === 'string') return v;
    return Number.isFinite(v) ? new Intl.NumberFormat('vi-VN').format(v) : '-';
  }

  displayReviewAvg(v: number | string | undefined): string {
    if (v === undefined || v === null || v === '') return '-';
    if (typeof v === 'string') return v;
    if (!Number.isFinite(v)) return '-';
    return Number(v).toFixed(1);
  }
}
