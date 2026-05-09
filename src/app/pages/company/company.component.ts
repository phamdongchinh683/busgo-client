import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { company } from '../../data/services/index';
import { Company } from '../../data/interfaces/company';
import { SharedModule } from '@app/shared/shared.module';
import { getApiErrorMessage } from '@app/shared/utils/api-error.util';
import { PAGE_LIMITS, DEFAULT_PAGE_LIMIT, type PageLimit } from '../../data/constants/index';
import { CompanyToolbarComponent } from './components/company-toolbar/company-toolbar.component';
import { CompanyFormModalComponent } from './components/company-form-modal/company-form-modal.component';
import { CompanyDeleteModalComponent } from './components/company-delete-modal/company-delete-modal.component';

@Component({
  selector: 'app-company',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SharedModule,
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

  showDeleteConfirm = false;
  deletingCompany: Company | null = null;

  notification: { show: boolean; message: string; type: 'success' | 'error' | 'warning' | 'info' } = {
    show: false,
    message: '',
    type: 'info',
  };

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly api: company.ApiService,
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

  showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info') {
    this.notification = { show: true, message, type };
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
    this.companyForm.reset({ name: '', hotline: '', logoUrl: '', address: '', latitude: null, longitude: null });
    this.showModal = true;
  }

  onEdit(c: Company) {
    this.editingCompany = c;
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
  }

  private readonly NAME_REGEX = /^[a-zA-ZÀ-ỹ\s]{5,}$/;

  onSubmit() {
    const { name: rawName, hotline: rawHotline, logoUrl: rawLogo, address: rawAddress, latitude: rawLatitude, longitude: rawLongitude } =
      this.companyForm.getRawValue();
    const name = (rawName ?? '').trim();
    const hotline = (rawHotline ?? '').trim();
    const logoUrl = (rawLogo ?? '').trim();
    const address = (rawAddress ?? '').trim();
    const latitude = this.toNullableNumber(rawLatitude);
    const longitude = this.toNullableNumber(rawLongitude);

    if (!name) {
      this.showNotification('Tên là bắt buộc.', 'warning');
      return;
    }
    if (!this.NAME_REGEX.test(name)) {
      this.showNotification('Tên phải có ít nhất 5 ký tự và chỉ chứa chữ cái.', 'warning');
      return;
    }
    if (hotline && (hotline.length <= 9 || !/^\d+$/.test(hotline))) {
      this.showNotification('Hotline phải có ít nhất 10 chữ số.', 'warning');
      return;
    }
    const originalAddress = (this.editingCompany?.address ?? '').trim();
    const isAddressChanged = !this.editingCompany || address !== originalAddress;
    if (isAddressChanged) {
      if (!address) {
        this.showNotification('Địa chỉ là bắt buộc.', 'warning');
        return;
      }
      if (address.length < 6) {
        this.showNotification('Địa chỉ quá ngắn.', 'warning');
        return;
      }
      if (latitude === null || longitude === null) {
        this.showNotification('Vui lòng kiểm tra địa chỉ trên bản đồ để lấy tọa độ.', 'warning');
        return;
      }
    }
    if ((latitude === null) !== (longitude === null)) {
      this.showNotification('Vui lòng nhập đầy đủ cả latitude và longitude.', 'warning');
      return;
    }
    if (latitude !== null && (latitude < -90 || latitude > 90)) {
      this.showNotification('Latitude phải trong khoảng -90 đến 90.', 'warning');
      return;
    }
    if (longitude !== null && (longitude < -180 || longitude > 180)) {
      this.showNotification('Longitude phải trong khoảng -180 đến 180.', 'warning');
      return;
    }

    this.submitting = true;

    if (this.editingCompany) {
      const data: Partial<{ name: string; hotline: string; logoUrl: string; address: string; latitude: number | null; longitude: number | null }> =
        {};
      if (name !== this.editingCompany.name) data['name'] = name;
      if (hotline !== this.editingCompany.hotline) data['hotline'] = hotline;
      if (logoUrl !== this.editingCompany.logoUrl) data['logoUrl'] = logoUrl;
      if (address !== originalAddress) data['address'] = address;
      const originalLatitude = this.toNullableNumber(this.editingCompany.latitude);
      const originalLongitude = this.toNullableNumber(this.editingCompany.longitude);
      if (latitude !== originalLatitude) data['latitude'] = latitude;
      if (longitude !== originalLongitude) data['longitude'] = longitude;
      if (Object.keys(data).length === 0) {
        this.showNotification('Không có thay đổi để cập nhật.', 'info');
        this.submitting = false;
        return;
      }

      this.api.updateCompany(this.editingCompany.id, data).subscribe({
        next: (res) => {
          this.companies = this.companies.map((c) => (c.id === res.company.id ? res.company : c));
          this.showNotification('Cập nhật nhà xe thành công!', 'success');
          this.closeModal();
          this.submitting = false;
        },
        error: (err: unknown) => {
          this.showNotification(getApiErrorMessage(err, 'Cập nhật thất bại.'), 'error');
          this.submitting = false;
        },
      });
    } else {
      this.api.createCompany(name, hotline, logoUrl, address, latitude ?? undefined, longitude ?? undefined).subscribe({
        next: (res) => {
          this.companies = [res.company, ...this.companies];
          this.showNotification('Tạo nhà xe thành công!', 'success');
          this.closeModal();
          this.submitting = false;
        },
        error: (err: unknown) => {
          this.showNotification(getApiErrorMessage(err, 'Tạo mới thất bại.'), 'error');
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
    this.submitting = true;

    this.api.deleteCompany(this.deletingCompany.id).subscribe({
      next: () => {
        const deleteId = this.deletingCompany?.id;
        if (deleteId !== undefined) {
          this.companies = this.companies.filter((c) => c.id !== deleteId);
        }
        this.showNotification('Xóa nhà xe thành công!', 'success');
        this.cancelDelete();
        this.submitting = false;
      },
      error: (err: unknown) => {
        this.showNotification(getApiErrorMessage(err, 'Xóa thất bại.'), 'error');
        this.submitting = false;
      },
    });
  }

}
