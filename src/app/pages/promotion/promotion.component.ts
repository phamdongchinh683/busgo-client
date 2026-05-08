import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { promotion, upload } from '@app/data/services';
import {
  PromotionItem,
  PromotionUpsertResponse,
  PromotionUpsertBody,
} from '@app/data/interfaces/promotion';
import { UploadPresignedResponse } from '@app/data/interfaces/upload';
import { SharedModule } from '@app/shared/shared.module';

@Component({
  selector: 'app-promotion',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SharedModule],
  templateUrl: './promotion.component.html',
  styleUrl: './promotion.component.css',
})
export class PromotionComponent implements OnInit {
  private static readonly CACHE_TTL_MS = 2 * 60 * 1000;
  private static listCache: {
    items: PromotionItem[];
    nextCursor: number | null;
    expiredAt: number;
  } | null = null;
  private readonly fb = inject(FormBuilder);

  promotions: PromotionItem[] = [];
  nextCursor: number | null = null;
  loading = true;
  loadingMore = false;

  showModal = false;
  submitting = false;
  uploading = false;
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

  notification: { show: boolean; message: string; type: 'success' | 'error' | 'warning' | 'info' } = {
    show: false,
    message: '',
    type: 'info',
  };

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

  get minEndDateLocal(): string {
    return this.toDateTimeLocal(new Date().toISOString());
  }

  showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info'): void {
    this.notification = { show: true, message, type };
  }

  fetch(force = false): void {
    const cached = PromotionComponent.listCache;
    if (!force && cached && cached.expiredAt > Date.now()) {
      this.promotions = [...cached.items];
      this.nextCursor = cached.nextCursor;
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
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.showNotification('Không tải được danh sách khuyến mãi.', 'error');
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
        this.loadingMore = false;
      },
      error: () => {
        this.loadingMore = false;
        this.showNotification('Không tải thêm được khuyến mãi.', 'error');
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
      startDate: this.toDateTimeLocal(item.startDate),
      endDate: this.toDateTimeLocal(item.endDate),
    });
    this.showModal = true;
  }

  closeModal(): void {
    this.showModal = false;
    this.submitting = false;
    this.uploading = false;
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
    try {
      const secureUrl = await this.uploadPromotionImage(this.editingPromotion.id, file);
      this.form.patchValue({ imageUrl: secureUrl });
      this.revokePendingPreview();
      this.showNotification('Upload ảnh thành công.', 'success');
    } catch (err: unknown) {
      let message = 'Upload ảnh thất bại.';
      if (err instanceof HttpErrorResponse) {
        message = (err.error as { message?: string })?.message ?? err.message ?? message;
      } else if (err instanceof Error) {
        message = err.message;
      }
      this.showNotification(message, 'error');
    } finally {
      this.uploading = false;
    }
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.showNotification('Vui lòng điền đầy đủ thông tin.', 'warning');
      return;
    }

    const raw = this.form.getRawValue();
    const body: PromotionUpsertBody = {
      title: (raw.title ?? '').trim(),
      content: (raw.content ?? '').trim(),
      imageUrl: (raw.imageUrl ?? '').trim(),
      isActive: !!raw.isActive,
      startDate: this.toIsoDate(raw.startDate ?? ''),
      endDate: this.toIsoDate(raw.endDate ?? ''),
    };

    if (!body.title || !body.content || !body.startDate || !body.endDate) {
      this.showNotification('Thiếu dữ liệu bắt buộc.', 'warning');
      return;
    }

    const endTime = Date.parse(body.endDate);
    if (!Number.isFinite(endTime) || endTime < Date.now()) {
      this.showNotification('Ngày kết thúc chỉ được chọn từ thời điểm hiện tại trở đi.', 'warning');
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
          this.showNotification('Cập nhật khuyến mãi thành công.', 'success');
          this.closeModal();
        },
        error: () => {
          this.submitting = false;
          this.showNotification('Cập nhật khuyến mãi thất bại.', 'error');
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
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return '-';
    return new Date(time).toLocaleString('vi-VN');
  }

  private toDateTimeLocal(value: string): string {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return '';
    const d = new Date(time);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  private toIsoDate(value: string): string {
    if (!value) return '';
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return '';
    return new Date(time).toISOString();
  }

  private async getPresignedForPromotion(id: number): Promise<UploadPresignedResponse> {
    try {
      return await firstValueFrom(this.uploadApi.getPresigned('promtion-new', id));
    } catch {
      return await firstValueFrom(this.uploadApi.getPresigned('promotion-new', id));
    }
  }

  private async uploadPromotionImage(id: number, file: File): Promise<string> {
    const presigned = await this.getPresignedForPromotion(id);
    let uploadFile = file;
    if (file.size >= 300 * 1024 && file.type.startsWith('image/')) {
      const prefersWebp = presigned.acceptedMimeTypes?.includes('image/webp');
      const outputType = prefersWebp ? 'image/webp' : 'image/jpeg';
      const quality = prefersWebp ? 0.76 : 0.82;
      uploadFile = await this.uploadApi.resizeImageFile(file, {
        maxDimension: 720,
        outputType,
        quality,
        minFileSize: 300 * 1024,
      });
    }

    if (
      presigned.acceptedMimeTypes?.length &&
      !presigned.acceptedMimeTypes.includes(uploadFile.type)
    ) {
      throw new Error('Định dạng ảnh không được hỗ trợ.');
    }

    return await this.uploadApi.uploadImageToCloudinary(uploadFile, presigned);
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
        const createdId = Number(created.id);
        if (
          pendingUploadTask &&
          Number.isFinite(createdId) &&
          createdId > 0 &&
          !created.imageUrl
        ) {
          this.showNotification('Đã tạo tin. Ảnh đang được đồng bộ nền...', 'info');
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
                },
              });
            })
            .catch(() => {
              this.showNotification('Upload ảnh thất bại sau khi tạo. Bạn có thể sửa lại để upload.', 'warning');
            });
        } else {
          this.showNotification('Tạo khuyến mãi thành công.', 'success');
        }
        this.closeModal();
      },
      error: () => {
        this.submitting = false;
        this.showNotification('Tạo khuyến mãi thất bại.', 'error');
      },
    });
  }

  private startPendingCreateImageUpload(file: File): void {
    this.uploading = true;
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
        this.showNotification('Upload ảnh thất bại. Bạn vẫn có thể tạo tin và upload lại sau.', 'warning');
      })
      .finally(() => {
        this.uploading = false;
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
