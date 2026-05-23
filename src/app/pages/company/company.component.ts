import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { company, upload } from '../../data/services/index';
import { Company } from '../../data/interfaces/company';
import { AppCompanyListComponent } from '@app/shared/components/app-company-list/app-company-list.component';
import { PageToastHostComponent } from '@app/shared/components/page-toast-host/page-toast-host.component';
import { PageHeaderIntroComponent } from '@app/shared/components/page-header-intro/page-header-intro.component';
import { PageToastService } from '@app/shared/services/page-toast.service';
import { getApiErrorMessage } from '@app/shared/utils/api-error.util';
import { PAGE_LIMITS, DEFAULT_PAGE_LIMIT, type PageLimit } from '../../data/constants/index';
import { CompanyToolbarComponent } from './components/company-toolbar/company-toolbar.component';
import { CompanyFormModalComponent } from './components/company-form-modal/company-form-modal.component';
import { CompanyDeleteModalComponent } from './components/company-delete-modal/company-delete-modal.component';
import { imageUploadPresets } from '../../data/services/upload/image-upload-presets';

@Component({
  selector: 'app-company',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    PageToastHostComponent,
    PageHeaderIntroComponent,
    AppCompanyListComponent,
    CompanyToolbarComponent,
    CompanyFormModalComponent,
    CompanyDeleteModalComponent,
  ],
  templateUrl: './company.component.html',
  styleUrl: './company.component.css',
})
export class CompanyComponent implements OnInit {
  companies: Company[] = [];
  nextCursor: number | null = null;
  loading = true;
  loadingMore = false;

  searchName = '';
  limit: PageLimit = DEFAULT_PAGE_LIMIT;
  pageLimits = PAGE_LIMITS;

  showModal = false;
  editingCompany: Company | null = null;
  companyForm: FormGroup;
  submitting = false;
  uploadingLogo = false;
  uploadLogoProgress = 0;
  selectedLogoFile: File | null = null;
  selectedLogoPreviewUrl = '';

  showDeleteConfirm = false;
  deletingCompany: Company | null = null;

  readonly toast = inject(PageToastService);
  private readonly cdr = inject(ChangeDetectorRef);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly api: company.ApiService,
    private readonly uploadApi: upload.ApiService,
    private readonly fb: FormBuilder,
  ) {
    this.companyForm = this.fb.group({
      name: [''],
      hotline: [''],
      logoUrl: [''],
      address: [''],
      latitude: [null as number | null],
      longitude: [null as number | null],
    });
  }

  ngOnInit() {
    this.fetch();
  }

  onSearchInput(value: string) {
    this.searchName = value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.fetch(), 300);
  }

  onLimitChange(value: PageLimit) {
    this.limit = value;
    this.fetch();
  }

  private fetch() {
    this.loading = true;
    this.companies = [];
    this.nextCursor = null;

    this.api.getCompanies(this.limit, undefined, this.searchName || undefined).subscribe({
      next: (res) => {
        this.companies = res.companies;
        this.nextCursor = res.next;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  loadMore() {
    if (this.nextCursor === null || this.loadingMore) return;
    this.loadingMore = true;

    this.api.getCompanies(this.limit, this.nextCursor, this.searchName || undefined).subscribe({
      next: (res) => {
        this.companies = [...this.companies, ...res.companies];
        this.nextCursor = res.next;
        this.loadingMore = false;
      },
      error: () => {
        this.loadingMore = false;
      },
    });
  }

  openCreateModal() {
    this.editingCompany = null;
    this.selectedLogoFile = null;
    this.revokeSelectedLogoPreview();
    this.companyForm.reset({ name: '', hotline: '', logoUrl: '', address: '', latitude: null, longitude: null });
    this.showModal = true;
  }

  onEdit(c: Company) {
    this.editingCompany = c;
    this.selectedLogoFile = null;
    this.revokeSelectedLogoPreview();
    this.companyForm.patchValue({
      name: c.name,
      hotline: c.hotline,
      logoUrl: c.logoUrl,
      address: c.address ?? '',
      latitude: c.latitude ?? null,
      longitude: c.longitude ?? null,
    });
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
    this.editingCompany = null;
    this.selectedLogoFile = null;
    this.revokeSelectedLogoPreview();
    this.uploadingLogo = false;
    this.uploadLogoProgress = 0;
  }

  private readonly NAME_REGEX = /^[a-zA-ZÀ-ỹ\s]{5,}$/;

  async onSubmit(): Promise<void> {
    const { name: rawName, hotline: rawHotline, logoUrl: rawLogo, address: rawAddress, latitude: rawLatitude, longitude: rawLongitude } =
      this.companyForm.getRawValue();
    const name = (rawName ?? '').trim();
    const hotline = (rawHotline ?? '').trim();
    const logoUrl = (rawLogo ?? '').trim();
    const address = (rawAddress ?? '').trim();
    const latitude = this.toNullableNumber(rawLatitude);
    const longitude = this.toNullableNumber(rawLongitude);

    if (!name) {
      this.toast.show('Tên là bắt buộc.', 'warning');
      return;
    }
    if (!this.NAME_REGEX.test(name)) {
      this.toast.show('Tên phải có ít nhất 5 ký tự và chỉ chứa chữ cái.', 'warning');
      return;
    }
    if (hotline && (hotline.length <= 9 || !/^\d+$/.test(hotline))) {
      this.toast.show('Hotline phải có ít nhất 10 chữ số.', 'warning');
      return;
    }
    const originalAddress = (this.editingCompany?.address ?? '').trim();
    const isAddressChanged = !this.editingCompany || address !== originalAddress;
    if (isAddressChanged) {
      if (!address) {
        this.toast.show('Địa chỉ là bắt buộc.', 'warning');
        return;
      }
      if (address.length < 6) {
        this.toast.show('Địa chỉ quá ngắn.', 'warning');
        return;
      }
      if (latitude === null || longitude === null) {
        this.toast.show('Vui lòng kiểm tra địa chỉ trên bản đồ để lấy tọa độ.', 'warning');
        return;
      }
    }
    if ((latitude === null) !== (longitude === null)) {
      this.toast.show('Vui lòng nhập đầy đủ cả latitude và longitude.', 'warning');
      return;
    }
    if (latitude !== null && (latitude < -90 || latitude > 90)) {
      this.toast.show('Latitude phải trong khoảng -90 đến 90.', 'warning');
      return;
    }
    if (longitude !== null && (longitude < -180 || longitude > 180)) {
      this.toast.show('Longitude phải trong khoảng -180 đến 180.', 'warning');
      return;
    }

    this.submitting = true;

    if (this.editingCompany) {
      const editing = this.editingCompany;
      const selectedLogoUpload = this.takeSelectedLogoUpload();
      const data: Partial<{ name: string; hotline: string; logoUrl: string; address: string; latitude: number | null; longitude: number | null }> =
        {};
      if (name !== editing.name) data['name'] = name;
      if (hotline !== editing.hotline) data['hotline'] = hotline;
      if (!selectedLogoUpload && logoUrl !== editing.logoUrl) {
        data['logoUrl'] = logoUrl;
      }
      if (address !== originalAddress) data['address'] = address;
      const originalLatitude = this.toNullableNumber(editing.latitude);
      const originalLongitude = this.toNullableNumber(editing.longitude);
      if (latitude !== originalLatitude) data['latitude'] = latitude;
      if (longitude !== originalLongitude) data['longitude'] = longitude;
      const hasProfileChanges = Object.keys(data).length > 0;
      if (!hasProfileChanges && !selectedLogoUpload) {
        this.toast.show('Không có thay đổi để cập nhật.', 'info');
        this.submitting = false;
        return;
      }

      const finishUpdate = (baseCompany: Company) => {
        const visibleCompany = selectedLogoUpload
          ? { ...baseCompany, logoUrl: selectedLogoUpload.previewUrl }
          : baseCompany;
        this.companies = this.companies.map((c) => (c.id === visibleCompany.id ? visibleCompany : c));
        this.toast.show(
          selectedLogoUpload ? 'Cập nhật nhà xe thành công. Logo đang được tải nền...' : 'Cập nhật nhà xe thành công!',
          'success',
        );
        this.closeModal();
        this.submitting = false;
        this.cdr.markForCheck();
        if (selectedLogoUpload) {
          this.uploadCompanyLogoInBackground({
            companyId: editing.id,
            file: selectedLogoUpload.file,
            previewUrl: selectedLogoUpload.previewUrl,
            fallbackLogoUrl: editing.logoUrl ?? '',
          });
        }
      };

      if (!hasProfileChanges) {
        finishUpdate(editing);
        return;
      }

      this.api.updateCompany(editing.id, data).subscribe({
        next: (res) => {
          finishUpdate(res.company);
        },
        error: (err: unknown) => {
          if (selectedLogoUpload) {
            this.selectedLogoFile = selectedLogoUpload.file;
            this.selectedLogoPreviewUrl = selectedLogoUpload.previewUrl;
          }
          this.toast.show(getApiErrorMessage(err, 'Cập nhật thất bại.'), 'error');
          this.submitting = false;
        },
      });
    } else {
      this.api.createCompany(name, hotline, logoUrl, address, latitude ?? undefined, longitude ?? undefined).subscribe({
        next: (res) => {
          this.companies = [res.company, ...this.companies];
          this.toast.show('Tạo nhà xe thành công!', 'success');
          this.closeModal();
          this.submitting = false;
          this.cdr.markForCheck();
        },
        error: (err: unknown) => {
          this.toast.show(getApiErrorMessage(err, 'Tạo mới thất bại.'), 'error');
          this.submitting = false;
        },
      });
    }
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  onLogoSelected(file: File | null) {
    this.revokeSelectedLogoPreview();
    this.selectedLogoFile = file;
    if (file) {
      this.selectedLogoPreviewUrl = URL.createObjectURL(file);
    }
  }

  private async uploadCompanyLogo(companyId: number, file: File): Promise<string> {
    this.uploadingLogo = true;
    this.uploadLogoProgress = 0;
    this.cdr.markForCheck();
    try {
      const presigned = await firstValueFrom(this.uploadApi.getPresigned('company', companyId));
      const prefersWebp = presigned.acceptedMimeTypes?.includes('image/webp');
      const p = imageUploadPresets.companyLogo;
      const uploadFile = await this.uploadApi.prepareImageForUpload(file, presigned, {
        maxBytes: p.maxBytes,
        minResizeBytes: p.minResizeBytes,
        maxDimension: p.maxDimension,
        preferredOutputType: prefersWebp ? 'image/webp' : 'image/jpeg',
        quality: prefersWebp ? p.qualityWebp : p.qualityJpeg,
      });
      return await this.uploadApi.uploadImageToCloudinaryWithProgress(uploadFile, presigned, (percent) => {
        this.uploadLogoProgress = percent;
        this.cdr.markForCheck();
      });
    } finally {
      this.uploadingLogo = false;
      this.uploadLogoProgress = 0;
      this.cdr.markForCheck();
    }
  }

  private getUploadErrorMessage(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message || fallback : fallback;
  }

  private takeSelectedLogoUpload(): { file: File; previewUrl: string } | null {
    const file = this.selectedLogoFile;
    const previewUrl = this.selectedLogoPreviewUrl;
    if (!file || !previewUrl) return null;
    this.selectedLogoFile = null;
    this.selectedLogoPreviewUrl = '';
    return { file, previewUrl };
  }

  private revokeSelectedLogoPreview(): void {
    if (!this.selectedLogoPreviewUrl) return;
    URL.revokeObjectURL(this.selectedLogoPreviewUrl);
    this.selectedLogoPreviewUrl = '';
  }

  private uploadCompanyLogoInBackground(options: {
    companyId: number;
    file: File;
    previewUrl: string;
    fallbackLogoUrl: string;
  }): void {
    this.uploadCompanyLogo(options.companyId, options.file)
      .then((secureUrl) => firstValueFrom(this.api.updateCompany(options.companyId, { logoUrl: secureUrl })))
      .then((res) => {
        this.companies = this.companies.map((c) => (c.id === res.company.id ? res.company : c));
        this.toast.show('Logo nhà xe đã được cập nhật.', 'success');
        this.cdr.markForCheck();
      })
      .catch((err: unknown) => {
        this.companies = this.companies.map((c) =>
          c.id === options.companyId ? { ...c, logoUrl: options.fallbackLogoUrl } : c,
        );
        this.toast.show(this.getUploadErrorMessage(err, 'Cập nhật thông tin thành công nhưng tải logo lên thất bại.'), 'warning');
        this.cdr.markForCheck();
      })
      .finally(() => {
        URL.revokeObjectURL(options.previewUrl);
      });
  }

  onDelete(c: Company) {
    this.deletingCompany = c;
    this.showDeleteConfirm = true;
  }

  cancelDelete() {
    this.showDeleteConfirm = false;
    this.deletingCompany = null;
  }

  onConfirmDelete() {
    if (!this.deletingCompany) return;
    const deletedCompanyId = this.deletingCompany.id;
    this.submitting = true;

    this.api.deleteCompany(deletedCompanyId).subscribe({
      next: () => {
        this.companies = this.companies.filter((company) => company.id !== deletedCompanyId);
        this.toast.show('Xóa nhà xe thành công!', 'success');
        this.cancelDelete();
        this.submitting = false;
        this.cdr.markForCheck();
      },
      error: (err: unknown) => {
        this.toast.show(getApiErrorMessage(err, 'Xóa thất bại.'), 'error');
        this.submitting = false;
        this.cdr.markForCheck();
      },
    });
  }

}
