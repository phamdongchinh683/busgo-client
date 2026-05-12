import { CommonModule } from '@angular/common';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';

import { balance, dashboard, fxRate } from '../../data/services';
import type { RevenueExportMethod, RevenueExportQuery, RevenueExportTimeType } from '../../data/interfaces/dashboard/revenue-export';
import { BalanceMoneyItem, BalanceResponse } from '../../data/interfaces/balance';
import { PageToastHostComponent } from '@app/shared/components/page-toast-host/page-toast-host.component';
import { PageHeaderIntroComponent } from '@app/shared/components/page-header-intro/page-header-intro.component';
import { PageToastService } from '@app/shared/services/page-toast.service';
import { BalanceStatusCardComponent } from './components/balance-status-card/balance-status-card.component';
import { getApiErrorMessage } from '@app/shared/utils/api-error.util';
import { buildYearOptions } from '@app/shared/utils/year-options';
import { payoutStatusLabel as mapPayoutStatusLabel } from '@app/shared/utils/domain-labels';

@Component({
  selector: 'app-balance',
  standalone: true,
  imports: [CommonModule, FormsModule, PageToastHostComponent, PageHeaderIntroComponent, BalanceStatusCardComponent],
  templateUrl: './balance.component.html',
  styleUrl: './balance.component.css',
})
export class BalanceComponent implements OnInit {
  private static readonly MIN_WITHDRAW_VND = 500000;
  private static readonly FALLBACK_USD_TO_VND_RATE = 26000;
  data: BalanceResponse | null = null;
  loading = true;

  private readonly api = inject(balance.ApiService);
  private readonly dashboardApi = inject(dashboard.ApiService);
  private readonly fxApi = inject(fxRate.ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(PageToastService);

  usdToVndRate: number | null = null;

  exportType: RevenueExportTimeType = 'monthly';
  exportYear!: number;
  exportMethod: RevenueExportMethod = 'vnpay';
  exportLoading = false;
  withdrawOpen = false;
  withdrawAmountVnd: number | null = null;
  withdrawAmountInput = '';
  withdrawing = false;
  withdrawResult: balance.WithdrawBalanceResponse | null = null;
  payoutOpen = false;
  payoutLoading = false;
  payouts: balance.PayoutItem[] = [];
  payoutLimit = 10;
  payoutStatus: '' | balance.PayoutStatus = '';
  payoutNext: string | null = null;
  payoutLoadingMore = false;
  private payoutRequestSeq = 0;
  yearOptions: number[] = [];
  readonly withdrawSuggestions = [500000, 1000000, 2000000, 5000000, 10000000];

  readonly exportMethods: { value: RevenueExportMethod; label: string }[] = [
    { value: 'vnpay', label: 'VNPay' },
    { value: 'stripe', label: 'Stripe' },
    { value: 'cash', label: 'Tiền mặt' },
  ];
  readonly amountFormatter = (item: BalanceMoneyItem) => this.formatAmountVndOnly(item);
  readonly secondaryAmountFormatter = (item: BalanceMoneyItem) => this.formatUsdAsVndSecondary(item);
  readonly contextFormatter = (item: BalanceMoneyItem, section: 'available' | 'pending') =>
    this.balanceContextMessage(item, section);
  readonly payoutStatusLabel = mapPayoutStatusLabel;

  ngOnInit(): void {
    this.yearOptions = buildYearOptions();
    this.exportYear = new Date().getFullYear();
    this.load();
  }

  load(): void {
    this.fetchUsdVndRate();
    this.loading = true;
    this.api
      .getBalance()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => (this.loading = false)),
      )
      .subscribe({
        next: (res) => {
          this.data = res;
        },
        error: (err: unknown) =>
          this.toast.show(getApiErrorMessage(err, 'Tải số dư thất bại.'), 'error'),
      });
  }

  isUsd(item: BalanceMoneyItem): boolean {
    return item.currency.trim().toLowerCase() === 'usd';
  }
  balanceContextMessage(item: BalanceMoneyItem, section: 'available' | 'pending'): string {
    if (section === 'pending') {
      if (item.amount < 0) {
        return 'Số dư đang âm và đang chờ xử lý';
      }
      if (item.amount > 0) {
        return 'Tiền hoa hồng chờ về từ các công ty nhà xe.';
      }
      return 'Đang chờ xác nhận — thường khoảng 2–3 ngày để cập nhật.';
    }

    if (item.amount < 0) {
      return 'Hiện tại số dư đang âm.';
    }
    if (item.amount > 0) {
      return 'Tiền hoa hồng nhận được từ các công ty nhà xe.';
    }
    return 'Số dư đang bằng 0 — chưa có số dư khả dụng cho khoản này.';
  }

  formatUsdPrimary(item: BalanceMoneyItem): string {
    const major = item.amount / 100;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(major);
    } catch {
      return `${major.toFixed(2)} USD`;
    }
  }

  formatUsdAsVnd(item: BalanceMoneyItem): string {
    const rate = this.usdToVndRate ?? BalanceComponent.FALLBACK_USD_TO_VND_RATE;
    const major = item.amount / 100;
    const vnd = Math.round(major * rate);
    return this.formatVnd(vnd);
  }

  formatAmountVndOnly(item: BalanceMoneyItem): string {
    if (this.isUsd(item)) {
      return this.formatUsdPrimary(item);
    }
    return this.formatMoney(item);
  }

  formatUsdAsVndSecondary(item: BalanceMoneyItem): string {
    const code = item.currency.trim().toLowerCase();
    const rate = this.usdToVndRate ?? BalanceComponent.FALLBACK_USD_TO_VND_RATE;
    if (!Number.isFinite(rate) || rate <= 0) return '';

    if (code === 'usd') {
      return this.formatUsdAsVnd(item);
    }

    if (code === 'vnd') {
      const vndMajor = Math.round(item.amount / 100);
      const usdMajor = vndMajor / rate;
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(usdMajor);
      } catch {
        return `${usdMajor.toFixed(2)} USD`;
      }
    }

    return '';
  }

  formatMoney(item: BalanceMoneyItem): string {
    const major = item.amount / 100;
    const code = item.currency.trim().toLowerCase();

    if (code === 'vnd') {
      return this.formatVnd(Math.round(major));
    }

    try {
      return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: item.currency.toUpperCase(),
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(major);
    } catch {
      return `${major.toLocaleString('vi-VN')} ${item.currency.toUpperCase()}`;
    }
  }

  private fetchUsdVndRate(): void {
    this.fxApi
      .getUsdVndRate()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rate) => {
          this.usdToVndRate = rate !== null && Number.isFinite(rate) ? rate : null;
        },
        error: () => {
          this.usdToVndRate = null;
        },
      });
  }

  private formatVnd(value: number): string {
    try {
      return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return `${value.toLocaleString('vi-VN')} VND`;
    }
  }

  exportRevenueExcel(): void {
    const year = Number.isFinite(this.exportYear) ? this.exportYear : new Date().getFullYear();
    const q: RevenueExportQuery = {
      type: this.exportType,
      method: this.exportMethod,
      year,
    };

    this.exportLoading = true;
    this.dashboardApi
      .exportRevenueReport(q)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => (this.exportLoading = false)),
      )
      .subscribe({
        next: (res) => this.handleExportResponse(res),
        error: (err: unknown) => this.handleExportError(err),
      });
  }

  openWithdrawModal(): void {
    this.withdrawOpen = true;
    this.withdrawAmountVnd = null;
    this.withdrawAmountInput = '';
    this.withdrawResult = null;
  }

  closeWithdrawModal(): void {
    if (this.withdrawing) return;
    this.withdrawOpen = false;
  }

  stopWithdrawModalPropagation(ev: Event): void {
    ev.stopPropagation();
  }

  selectWithdrawSuggestion(amount: number): void {
    this.withdrawAmountVnd = amount;
    this.withdrawAmountInput = this.formatWithdrawAmountInput(amount);
  }

  onWithdrawInputChange(value: string): void {
    const digitsOnly = value.replace(/\D/g, '');
    if (!digitsOnly) {
      this.withdrawAmountVnd = null;
      this.withdrawAmountInput = '';
      return;
    }

    const parsed = Number(digitsOnly);
    this.withdrawAmountVnd = Number.isFinite(parsed) ? parsed : null;
    this.withdrawAmountInput = this.formatWithdrawAmountInput(parsed);
  }

  private formatWithdrawAmountInput(amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) return '';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(amount));
  }

  submitWithdraw(): void {
    const amountVnd = Number(this.withdrawAmountVnd);
    if (!Number.isFinite(amountVnd) || amountVnd < BalanceComponent.MIN_WITHDRAW_VND) {
      this.toast.show(`Số tiền rút phải từ ${BalanceComponent.MIN_WITHDRAW_VND.toLocaleString('vi-VN')} VND.`, 'warning');
      return;
    }

    this.withdrawing = true;
    this.withdrawResult = null;

    this.api.withdrawBalance({ amount: Math.round(amountVnd) }).subscribe({
      next: (res) => {
        this.toast.show(res.message || 'Rút tiền thành công.', 'success');
        this.withdrawing = false;
        this.closeWithdrawModal();
        this.load();
      },
      error: (err: unknown) => {
        this.toast.show(getApiErrorMessage(err, 'Rút tiền thất bại.'), 'error');
        this.withdrawing = false;
      },
      complete: () => {
        this.withdrawing = false;
      },
    });
  }

  openPayoutModal(): void {
    this.payoutOpen = true;
    this.fetchPayouts(true);
  }

  closePayoutModal(): void {
    if (this.payoutLoading) return;
    this.payoutOpen = false;
  }

  stopPayoutModalPropagation(ev: Event): void {
    ev.stopPropagation();
  }

  applyPayoutFilter(): void {
    this.fetchPayouts(true);
  }

  loadMorePayouts(): void {
    if (!this.payoutNext || this.payoutLoading || this.payoutLoadingMore) return;
    this.fetchPayouts(false);
  }

  get hasMorePayouts(): boolean {
    return !!this.payoutNext;
  }

  private fetchPayouts(reset: boolean): void {
    const requestSeq = ++this.payoutRequestSeq;
    if (reset) {
      this.payoutLoading = true;
      this.payoutNext = null;
    } else {
      this.payoutLoadingMore = true;
    }

    this.api
      .getPayouts({
        limit: this.payoutLimit,
        status: this.payoutStatus || undefined,
        next: reset ? undefined : this.payoutNext || undefined,
      })
      .subscribe({
        next: (res) => {
          if (requestSeq !== this.payoutRequestSeq) return;
          const items = Array.isArray(res.payouts) ? res.payouts : [];
          this.payouts = reset ? items : [...this.payouts, ...items];
          const nextCursor = typeof res.next === 'string' ? res.next.trim() : '';
          this.payoutNext = nextCursor && nextCursor.toLowerCase() !== 'null' ? nextCursor : null;
        },
        error: (err: unknown) => {
          if (requestSeq !== this.payoutRequestSeq) return;
          this.toast.show(getApiErrorMessage(err, 'Không tải được lịch sử giao dịch.'), 'error');
        },
        complete: () => {
          if (requestSeq !== this.payoutRequestSeq) return;
          this.payoutLoading = false;
          this.payoutLoadingMore = false;
        },
      });
  }

  formatPayoutAmount(item: balance.PayoutItem): string {
    const major = item.amount / 100;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: item.currency.toUpperCase(),
        minimumFractionDigits: item.currency.toLowerCase() === 'vnd' ? 0 : 2,
        maximumFractionDigits: item.currency.toLowerCase() === 'vnd' ? 0 : 2,
      }).format(major);
    } catch {
      return `${major.toLocaleString('en-US')} ${item.currency.toUpperCase()}`;
    }
  }

  formatPayoutVnd(item: balance.PayoutItem): string {
    const code = item.currency.trim().toLowerCase();
    if (code === 'vnd') {
      return this.formatVnd(Math.round(item.amount / 100));
    }
    if (code === 'usd') {
      const rate = this.usdToVndRate ?? BalanceComponent.FALLBACK_USD_TO_VND_RATE;
      if (!Number.isFinite(rate) || rate <= 0) return '—';
      const usdMajor = item.amount / 100;
      return this.formatVnd(Math.round(usdMajor * rate));
    }
    return '—';
  }

  formatUnixDate(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    return new Date(seconds * 1000).toLocaleString('vi-VN');
  }

  private handleExportResponse(res: HttpResponse<Blob>): void {
    const blob = res.body;
    if (!blob) {
      this.toast.show('Không nhận được file từ máy chủ.', 'error');
      return;
    }
    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      blob.text().then(
        (text) => {
          try {
            const j = JSON.parse(text) as { message?: string };
            this.toast.show(j.message || 'Xuất Excel không thành công.', 'error');
          } catch {
            this.toast.show('Xuất Excel không thành công.', 'error');
          }
        },
        () => this.toast.show('Xuất Excel không thành công.', 'error'),
      );
      return;
    }
    const filename = this.filenameFromContentDisposition(res.headers.get('Content-Disposition'));
    this.downloadBlob(blob, filename);
    this.toast.show('Đã tải file Excel.', 'success');
  }

  private handleExportError(err: unknown): void {
    if (err instanceof HttpErrorResponse && err.error instanceof Blob) {
      err.error.text().then(
        (text) => {
          try {
            const j = JSON.parse(text) as { message?: string };
            this.toast.show(j.message || 'Xuất Excel không thành công.', 'error');
          } catch {
            this.toast.show('Xuất Excel không thành công.', 'error');
          }
        },
        () => this.toast.show('Xuất Excel không thành công.', 'error'),
      );
      return;
    }
    const msg =
      err instanceof HttpErrorResponse
        ? (typeof err.error === 'object' && err.error && 'message' in err.error
          ? String((err.error as { message?: unknown }).message)
          : err.message)
        : err instanceof Error
          ? err.message
          : 'Xuất Excel thất bại.';
    this.toast.show(msg || 'Xuất Excel thất bại.', 'error');
  }

  private filenameFromContentDisposition(header: string | null): string {
    if (!header) {
      return `doanh-thu-${new Date().toISOString().slice(0, 10)}.xlsx`;
    }
    const star = /filename\*=UTF-8''([^;\s]+)/i.exec(header);
    if (star?.[1]) {
      try {
        return decodeURIComponent(star[1].replace(/"/g, ''));
      } catch {}
    }
    const quoted = /filename="([^"]+)"/i.exec(header);
    if (quoted?.[1]) return quoted[1];
    const plain = /filename=([^;\s]+)/i.exec(header);
    if (plain?.[1]) return plain[1].replace(/"/g, '');
    return `doanh-thu-${new Date().toISOString().slice(0, 10)}.xlsx`;
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.click();
    URL.revokeObjectURL(url);
  }

}
