import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { promotion, upload } from '@app/data/services';
import {
  PromotionItem,
  PromotionUpsertResponse,
  PromotionUpsertBody,
} from '@app/data/interfaces/promotion';
import { UploadPresignedResponse } from '@app/data/interfaces/upload';
import { imageUploadPresets } from '@app/data/services/upload/image-upload-presets';
import { PageToastHostComponent } from '@app/shared/components/page-toast-host/page-toast-host.component';
import { PageHeaderIntroComponent } from '@app/shared/components/page-header-intro/page-header-intro.component';
import { PageToastService } from '@app/shared/services/page-toast.service';

@Component({
  selector: 'app-promotion',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, PageToastHostComponent, PageHeaderIntroComponent],
  templateUrl: './promotion.component.html',
  styleUrl: './promotion.component.css',
})
export class PromotionComponent implements OnInit {
  private static readonly CACHE_TTL_MS = 5 * 1000;
  private static listCache: {
    items: PromotionItem[];
    nextCursor: number | null;
    expiredAt: number;
  } | null = null;
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(PageToastService);

  promotions: PromotionItem[] = [];
  filteredPromotionsView: PromotionItem[] = [];
  nextCursor: number | null = null;
  loading = true;
  loadingMore = false;
  filterStatus: boolean | null = null;

  showModal = false;
  submitting = false;
  uploading = false;
  uploadProgress = 0;
  editingPromotion: PromotionItem | null = null;
  pendingCreateImageFile: File | null = null;
  pendingCreateImagePreviewUrl = '';
  pendingCreateUploadedUrl = '';
  pendingCreateUploadTask: Promise<string> | null = null;

  readonly form = this.fb.group({
    title: ['', [Validators.required]],
    content: ['', [Validators.required]],
    imageUrl: [''],
    isActive: [true, [Validators.required]],
    startDate: ['', [Validators.required]],
    endDate: ['', [Validators.required]],
  });

  constructor(
    private readonly api: promotion.ApiService,
    private readonly uploadApi: upload.ApiService,
  ) {}

  ngOnInit(): void {
    this.fetch();
  }

  get canUploadImage(): boolean {
    return true;
  }

  get currentImagePreview(): string {
    return this.pendingCreateImagePreviewUrl || (this.form.controls.imageUrl.value ?? '').trim();
  }

  get minEndCalendarDate(): string {
    return this.todayCalendarDate();
  }

  private buildFilteredPromotions(): PromotionItem[] {
    if (this.filterStatus === null) return this.promotions;
    return this.promotions.filter((item) => item.isActive === this.filterStatus);
  }

  resetFilters(): void {
    this.filterStatus = null;
    this.applyPromotionFilters();
  }

  applyPromotionFilters(): void {
    this.filteredPromotionsView = this.buildFilteredPromotions();
  }

  fetch(force = false): void {
    const cached = PromotionComponent.listCache;
    if (!force && cached && cached.expiredAt > Date.now()) {
      this.promotions = [...cached.items];
      this.nextCursor = cached.nextCursor;
      this.applyPromotionFilters();
      this.loading = false;
      return;
    }

    this.loading = true;
    this.promotions = [];
    this.nextCursor = null;
    this.api.getPublicPromotions(10).subscribe({
      next: (res) => {
        this.promotions = res.items ?? [];
        this.nextCursor = res.next ?? null;
        this.updateListCache(this.promotions, this.nextCursor);
        this.applyPromotionFilters();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.toast.show('Không tải được danh sách khuyến mãi.', 'error');
      },
    });
  }

  loadMore(): void {
    if (this.nextCursor === null || this.loadingMore) return;
    this.loadingMore = true;
    this.api.getPublicPromotions(10, this.nextCursor).subscribe({
      next: (res) => {
        this.promotions = [...this.promotions, ...(res.items ?? [])];
        this.nextCursor = res.next ?? null;
        this.updateListCache(this.promotions, this.nextCursor);
        this.applyPromotionFilters();
        this.loadingMore = false;
      },
      error: () => {
        this.loadingMore = false;
        this.toast.show('Không tải thêm được khuyến mãi.', 'error');
      },
    });
  }

  openCreate(): void {
    this.editingPromotion = null;
    this.form.reset({
      title: '',
      content: '',
      imageUrl: '',
      isActive: true,
      startDate: '',
      endDate: '',
    });
    this.pendingCreateImageFile = null;
    this.uploadProgress = 0;
    this.pendingCreateUploadedUrl = '';
    this.pendingCreateUploadTask = null;
    this.revokePendingPreview();
    this.showModal = true;
  }

  openEdit(item: PromotionItem): void {
    this.editingPromotion = item;
    this.form.reset({
      title: item.title,
      content: item.content,
      imageUrl: item.imageUrl ?? '',
      isActive: !!item.isActive,
      startDate: this.toCalendarDate(item.startDate),
      endDate: this.toCalendarDate(item.endDate),
    });
    this.uploadProgress = 0;
    this.showModal = true;
  }

  closeModal(): void {
    this.showModal = false;
    this.submitting = false;
    this.uploading = false;
    this.uploadProgress = 0;
    this.editingPromotion = null;
    this.pendingCreateImageFile = null;
    this.pendingCreateUploadedUrl = '';
    this.pendingCreateUploadTask = null;
    this.revokePendingPreview();
  }

  async onPickImage(input: HTMLInputElement): Promise<void> {
    input.click();
  }

  async onImageChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!this.editingPromotion) {
      this.pendingCreateImageFile = file;
      this.setPendingPreview(file);
      this.startPendingCreateImageUpload(file);
      return;
    }

    this.uploading = true;
    this.uploadProgress = 0;
    try {
      const secureUrl = await this.uploadPromotionImage(this.editingPromotion.id, file);
      this.form.patchValue({ imageUrl: secureUrl });
      this.revokePendingPreview();
      this.toast.show('Tải ảnh lên thành công.', 'success');
    } catch (err: unknown) {
      let message = 'Tải ảnh lên thất bại.';
      if (err instanceof HttpErrorResponse) {
        message = (err.error as { message?: string })?.message ?? err.message ?? message;
      } else if (err instanceof Error) {
        message = err.message;
      }
      this.toast.show(message, 'error');
    } finally {
      this.uploading = false;
      this.uploadProgress = 0;
    }
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.show('Vui lòng điền đầy đủ thông tin.', 'warning');
      return;
    }

    const raw = this.form.getRawValue();
    const body: PromotionUpsertBody = {
      title: (raw.title ?? '').trim(),
      content: (raw.content ?? '').trim(),
      imageUrl: (raw.imageUrl ?? '').trim(),
      isActive: !!raw.isActive,
      startDate: this.toApiMonthDay(raw.startDate ?? ''),
      endDate: this.toApiMonthDay(raw.endDate ?? ''),
    };

    if (!body.title || !body.content || !body.startDate || !body.endDate) {
      this.toast.show('Thiếu dữ liệu bắt buộc.', 'warning');
      return;
    }

    if (!this.isValidMonthDay(body.startDate) || !this.isValidMonthDay(body.endDate)) {
      this.toast.show('Vui lòng chọn ngày bắt đầu và ngày kết thúc.', 'warning');
      return;
    }

    if (this.monthDayValue(body.endDate) < this.monthDayValue(this.todayMonthDay())) {
      this.toast.show('Ngày kết thúc chỉ được chọn từ hôm nay trở đi.', 'warning');
      return;
    }

    this.submitting = true;
    if (this.editingPromotion) {
      const editing = this.editingPromotion;
      this.api.updatePromotion(this.editingPromotion.id, body).subscribe({
        next: (res) => {
          const updated = this.pickUpsertItem(res, editing, body);
          this.promotions = this.promotions.map((x) => (x.id === updated.id ? updated : x));
          this.updateListCache(this.promotions, this.nextCursor);
          this.applyPromotionFilters();
          this.toast.show('Cập nhật khuyến mãi thành công.', 'success');
          this.closeModal();
        },
        error: () => {
          this.submitting = false;
          this.toast.show('Cập nhật khuyến mãi thất bại.', 'error');
        },
      });
      return;
    }

    const selectedImage = this.pendingCreateImageFile;
    const createBody: PromotionUpsertBody = {
      ...body,
      imageUrl: body.imageUrl || this.pendingCreateUploadedUrl,
    };
    const uploadTask =
      !this.editingPromotion && !createBody.imageUrl && selectedImage ? this.pendingCreateUploadTask : null;
    this.createPromotionWithBody(createBody, uploadTask);
  }

  formatDate(value: string): string {
    const monthDay = this.toMonthDay(value);
    if (!monthDay) return '-';
    const [month, day] = monthDay.split('-');
    return `${day}-${month}`;
  }

  private todayCalendarDate(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private toCalendarDate(value: string): string {
    const monthDay = this.toMonthDay(value);
    if (!monthDay) return '';
    const [month, day] = monthDay.split('-');
    return `${new Date().getFullYear()}-${month}-${day}`;
  }

  private toApiMonthDay(value: string): string {
    const v = value.trim();
    if (!v) return '';
    const calendar = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (calendar) return `${calendar[2]}-${calendar[3]}`;
    return this.toMonthDay(v);
  }

  private todayMonthDay(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private toMonthDay(value: string): string {
    const v = value.trim();
    if (!v) return '';
    if (/^\d{2}-\d{2}$/.test(v)) return v;
    const legacy = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (legacy) return `${legacy[2]}-${legacy[3]}`;
    return '';
  }

  private isValidMonthDay(value: string): boolean {
    const match = /^(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= daysInMonth[month - 1];
  }

  private monthDayValue(value: string): number {
    const match = /^(\d{2})-(\d{2})$/.exec(value);
    if (!match) return -1;
    return Number(match[1]) * 100 + Number(match[2]);
  }

  private async getPresignedForPromotion(id: number): Promise<UploadPresignedResponse> {
      return await firstValueFrom(this.uploadApi.getPresigned('promotion-new', id));
  }

  private async uploadPromotionImage(id: number, file: File): Promise<string> {
    const presigned = await this.getPresignedForPromotion(id);
    const prefersWebp = presigned.acceptedMimeTypes?.includes('image/webp');
    const p = imageUploadPresets.promotion;
    const uploadFile = await this.uploadApi.prepareImageForUpload(file, presigned, {
      maxBytes: p.maxBytes,
      minResizeBytes: p.minResizeBytes,
      maxDimension: p.maxDimension,
      preferredOutputType: prefersWebp ? 'image/webp' : 'image/jpeg',
      quality: prefersWebp ? p.qualityWebp : p.qualityJpeg,
    });
    return await this.uploadApi.uploadImageToCloudinaryWithProgress(uploadFile, presigned, (percent) => {
      this.uploadProgress = percent;
    });
  }

  private setPendingPreview(file: File): void {
    this.revokePendingPreview();
    this.pendingCreateImagePreviewUrl = URL.createObjectURL(file);
  }

  private revokePendingPreview(): void {
    if (!this.pendingCreateImagePreviewUrl) return;
    URL.revokeObjectURL(this.pendingCreateImagePreviewUrl);
    this.pendingCreateImagePreviewUrl = '';
  }

  private pickUpsertItem(
    res: PromotionUpsertResponse | PromotionItem,
    fallback: PromotionItem | null,
    body: PromotionUpsertBody,
  ): PromotionItem {
    const asObj = res as { item?: PromotionItem };
    const fromRes = asObj.item ?? (res as PromotionItem);
    if (fromRes && Number.isFinite(Number(fromRes.id))) return fromRes;
    if (fallback) {
      return { ...fallback, ...body };
    }
    return {
      id: Date.now(),
      ...body,
    };
  }

  private createPromotionWithBody(
    body: PromotionUpsertBody,
    pendingUploadTask: Promise<string> | null = null,
  ): void {
    this.api.createPromotion(body).subscribe({
      next: (res) => {
        const created = this.pickUpsertItem(res, null, body);
        this.promotions = [created, ...this.promotions];
        this.updateListCache(this.promotions, this.nextCursor);
        this.applyPromotionFilters();
        const createdId = Number(created.id);
        if (
          pendingUploadTask &&
          Number.isFinite(createdId) &&
          createdId > 0 &&
          !created.imageUrl
        ) {
          this.toast.show('Đã tạo tin. Ảnh đang được đồng bộ nền...', 'info');
          pendingUploadTask
            .then((secureUrl) => {
              if (!secureUrl) return;
              const updateBody: PromotionUpsertBody = {
                ...body,
                imageUrl: secureUrl,
              };
              this.api.updatePromotion(createdId, updateBody).subscribe({
                next: (uRes) => {
                  const updated = this.pickUpsertItem(
                    uRes,
                    { ...created, imageUrl: secureUrl },
                    updateBody,
                  );
                  this.promotions = this.promotions.map((x) => (x.id === createdId ? updated : x));
                  this.updateListCache(this.promotions, this.nextCursor);
                  this.applyPromotionFilters();
                },
              });
            })
            .catch(() => {
              this.toast.show('Tải ảnh lên thất bại sau khi tạo. Bạn có thể sửa lại để tải lại.', 'warning');
            });
        } else {
          this.toast.show('Tạo khuyến mãi thành công.', 'success');
        }
        this.closeModal();
      },
      error: () => {
        this.submitting = false;
        this.toast.show('Tạo khuyến mãi thất bại.', 'error');
      },
    });
  }

  private startPendingCreateImageUpload(file: File): void {
    this.uploading = true;
    this.uploadProgress = 0;
    this.pendingCreateUploadedUrl = '';
    const uploadTask = this.uploadPromotionImage(Date.now(), file);
    this.pendingCreateUploadTask = uploadTask;
    uploadTask
      .then((secureUrl) => {
        this.pendingCreateUploadedUrl = secureUrl;
        this.form.patchValue({ imageUrl: secureUrl });
      })
      .catch(() => {
        this.pendingCreateUploadTask = null;
        this.pendingCreateUploadedUrl = '';
        this.form.patchValue({ imageUrl: '' });
        this.toast.show('Tải ảnh lên thất bại. Bạn vẫn có thể tạo tin và tải lại sau.', 'warning');
      })
      .finally(() => {
        this.uploading = false;
        this.uploadProgress = 0;
      });
  }

  private updateListCache(items: PromotionItem[], nextCursor: number | null): void {
    PromotionComponent.listCache = {
      items: [...items],
      nextCursor,
      expiredAt: Date.now() + PromotionComponent.CACHE_TTL_MS,
    };
  }
}
