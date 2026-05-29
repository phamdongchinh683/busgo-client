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
import { SHORT_READ_CACHE_TTL_MS } from '@app/data/services/cache-utils';

@Component({
  selector: 'app-promotion',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, PageToastHostComponent, PageHeaderIntroComponent],
  templateUrl: './promotion.component.html',
  styleUrl: './promotion.component.css',
})
export class PromotionComponent implements OnInit {
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
  selectedImageFile: File | null = null;
  selectedImagePreviewUrl = '';

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
    return this.selectedImagePreviewUrl || (this.form.controls.imageUrl.value ?? '').trim();
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
    this.selectedImageFile = null;
    this.uploadProgress = 0;
    this.revokeSelectedPreview();
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
    this.selectedImageFile = null;
    this.revokeSelectedPreview();
    this.showModal = true;
  }

  closeModal(): void {
    this.showModal = false;
    this.submitting = false;
    this.uploading = false;
    this.uploadProgress = 0;
    this.editingPromotion = null;
    this.selectedImageFile = null;
    this.revokeSelectedPreview();
  }

  async onPickImage(input: HTMLInputElement): Promise<void> {
    input.click();
  }

  async onImageChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.toast.show('Chỉ hỗ trợ tệp ảnh.', 'warning');
      return;
    }

    this.selectedImageFile = file;
    this.setSelectedPreview(file);
    this.uploadProgress = 0;
  }

  async submit(): Promise<void> {
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

    if (!this.currentImagePreview) {
      this.toast.show('Vui lòng chọn ảnh khuyến mãi.', 'warning');
      return;
    }

    this.submitting = true;
    try {
      if (this.editingPromotion) {
        await this.updatePromotionWithBody(body);
        return;
      }
      await this.createPromotionWithBody(body);
    } catch (err: unknown) {
      this.submitting = false;
      this.uploading = false;
      this.uploadProgress = 0;
      this.toast.show(this.getUploadErrorMessage(err, 'Lưu khuyến mãi thất bại.'), 'error');
    }
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

  private setSelectedPreview(file: File): void {
    this.revokeSelectedPreview();
    this.selectedImagePreviewUrl = URL.createObjectURL(file);
  }

  private revokeSelectedPreview(): void {
    if (!this.selectedImagePreviewUrl) return;
    URL.revokeObjectURL(this.selectedImagePreviewUrl);
    this.selectedImagePreviewUrl = '';
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

  private async updatePromotionWithBody(body: PromotionUpsertBody): Promise<void> {
    const editing = this.editingPromotion;
    if (!editing) return;

    let imageUrl = body.imageUrl?.trim() || '';
    let selectedUpload: { file: File; previewUrl: string } | null = null;

    const hasSelected = !!this.selectedImageFile && !!this.selectedImagePreviewUrl;

    if (hasSelected) {
      selectedUpload = this.takeSelectedImageUpload();
      if (selectedUpload) {
        this.uploading = true;
        this.uploadProgress = 0;
        try {
          const secureUrl = await this.uploadPromotionImage(editing.id, selectedUpload.file);
          imageUrl = secureUrl;
        } catch (err) {
          // Put selection back so user can retry Save with the same file
          this.selectedImageFile = selectedUpload.file;
          this.selectedImagePreviewUrl = selectedUpload.previewUrl;
          this.uploading = false;
          this.uploadProgress = 0;
          throw err;
        } finally {
          this.uploading = false;
          this.uploadProgress = 0;
        }
      }
    } else {
      // No new image selected → preserve the original value from the item being edited.
      // This prevents sending "" when the promotion already has a valid imageUrl.
      imageUrl = editing.imageUrl?.trim() || body.imageUrl?.trim() || '';
    }

    const finalBody: PromotionUpsertBody = { ...body, imageUrl };

    // Last safety: if we still have no valid image, block the call (backend requires proper URL)
    if (!imageUrl) {
      this.submitting = false;
      this.uploading = false;
      this.toast.show('Khuyến mãi cần có ảnh. Vui lòng chọn ảnh.', 'warning');
      return;
    }

    const res = await firstValueFrom(this.api.updatePromotion(editing.id, finalBody));
    const updated = this.pickUpsertItem(res, editing, finalBody);
    this.replacePromotionInList(updated);
    this.toast.show('Cập nhật khuyến mãi thành công.', 'success');
    this.closeModal();

    if (selectedUpload) {
      URL.revokeObjectURL(selectedUpload.previewUrl);
    }
  }

  private async createPromotionWithBody(body: PromotionUpsertBody): Promise<void> {
    const hasSelectedUpload = !!this.selectedImageFile && !!this.selectedImagePreviewUrl;

    // Backend requires imageUrl to be a valid URL. For create we don't have the ID yet
    // to request presigned upload, so we send a tiny valid placeholder and replace it
    // immediately after getting the real ID (the UI shows local preview blob anyway).
    const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/1x1/ffffff/ffffff';
    const createBody: PromotionUpsertBody = hasSelectedUpload
      ? { ...body, imageUrl: PLACEHOLDER_IMAGE }
      : body;

    const res = await firstValueFrom(this.api.createPromotion(createBody));
    const selectedUpload = hasSelectedUpload ? this.takeSelectedImageUpload() : null;
    let created = this.pickUpsertItem(res, null, createBody);
    const createdId = Number(created.id);

    if (selectedUpload && Number.isFinite(createdId) && createdId > 0) {
      created = { ...created, imageUrl: selectedUpload.previewUrl };
    }

    this.promotions = [created, ...this.promotions];
    this.updateListCache(this.promotions, this.nextCursor);
    this.applyPromotionFilters();
    this.toast.show(
      selectedUpload ? 'Tạo khuyến mãi thành công. Ảnh đang được tải nền...' : 'Tạo khuyến mãi thành công.',
      'success',
    );
    this.closeModal();

    if (selectedUpload && Number.isFinite(createdId) && createdId > 0) {
      this.uploadPromotionImageInBackground({
        id: createdId,
        body,
        file: selectedUpload.file,
        previewUrl: selectedUpload.previewUrl,
        fallbackImageUrl: '',
        successMessage: 'Ảnh khuyến mãi đã được tải lên.',
        failureMessage: 'Đã tạo tin nhưng tải ảnh lên thất bại.',
      });
    } else if (selectedUpload) {
      URL.revokeObjectURL(selectedUpload.previewUrl);
      this.toast.show('Đã tạo tin nhưng không nhận được ID để tải ảnh.', 'warning');
    }
  }

  private takeSelectedImageUpload(): { file: File; previewUrl: string } | null {
    const file = this.selectedImageFile;
    const previewUrl = this.selectedImagePreviewUrl;
    if (!file || !previewUrl) return null;
    this.selectedImageFile = null;
    this.selectedImagePreviewUrl = '';
    return { file, previewUrl };
  }

  private replacePromotionInList(item: PromotionItem): void {
    this.promotions = this.promotions.map((x) => (x.id === item.id ? item : x));
    this.updateListCache(this.promotions, this.nextCursor);
    this.applyPromotionFilters();
  }

  private uploadPromotionImageInBackground(options: {
    id: number;
    body: PromotionUpsertBody;
    file: File;
    previewUrl: string;
    fallbackImageUrl: string;
    successMessage: string;
    failureMessage: string;
  }): void {
    this.uploading = true;
    this.uploadProgress = 0;
    this.uploadPromotionImage(options.id, options.file)
      .then((secureUrl) => {
        const updateBody: PromotionUpsertBody = { ...options.body, imageUrl: secureUrl };
        return firstValueFrom(this.api.updatePromotion(options.id, updateBody)).then((res) => {
          const fallback = this.promotions.find((item) => item.id === options.id) ?? null;
          const updated = this.pickUpsertItem(res, fallback, updateBody);
          this.replacePromotionInList(updated);
          this.toast.show(options.successMessage, 'success');
        });
      })
      .catch((err: unknown) => {
        const current = this.promotions.find((item) => item.id === options.id);
        if (current) {
          this.replacePromotionInList({ ...current, imageUrl: options.fallbackImageUrl });
        }
        this.toast.show(this.getUploadErrorMessage(err, options.failureMessage), 'warning');
      })
      .finally(() => {
        URL.revokeObjectURL(options.previewUrl);
        this.uploading = false;
        this.uploadProgress = 0;
      });
  }

  private getUploadErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      return (err.error as { message?: string })?.message ?? err.message ?? fallback;
    }
    if (err instanceof Error) return err.message || fallback;
    return fallback;
  }

  private updateListCache(items: PromotionItem[], nextCursor: number | null): void {
    PromotionComponent.listCache = {
      items: [...items],
      nextCursor,
      expiredAt: Date.now() + SHORT_READ_CACHE_TTL_MS,
    };
  }
}
