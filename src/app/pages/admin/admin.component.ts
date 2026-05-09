import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@app/shared/shared.module';
import { auth, companyAdmin, publicApi } from '../../data/services';
import { Company } from '../../data/interfaces/company';
import { CompanyAdmin, CreateCompanyAdminBody, UpdateCompanyAdminBody } from '../../data/interfaces/company-admin';
import { normalizeCompanyAdminList } from './utils/company-admin.mapper';
import { getApiErrorMessage } from '@app/shared/utils/api-error.util';
import { DEFAULT_PAGE_LIMIT, PAGE_LIMITS, type PageLimit } from '../../data/constants';
import { CompanyAdminToolbarComponent } from './components/company-admin-toolbar/company-admin-toolbar.component';
import { CompanyAdminTableComponent } from './components/company-admin-table/company-admin-table.component';
import { CompanyAdminCreateModalComponent } from './components/company-admin-create-modal/company-admin-create-modal.component';
import { CompanyAdminEditModalComponent } from './components/company-admin-edit-modal/company-admin-edit-modal.component';
import { UserNotificationModalComponent } from '../user/components/user-notification-modal/user-notification-modal.component';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    CompanyAdminToolbarComponent,
    CompanyAdminTableComponent,
    CompanyAdminCreateModalComponent,
    CompanyAdminEditModalComponent,
    UserNotificationModalComponent,
  ],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css'],
})
export class AdminComponent implements OnInit {
  limit: PageLimit = DEFAULT_PAGE_LIMIT;
  pageLimits = PAGE_LIMITS;

  admins: CompanyAdmin[] = [];
  companies: Company[] = [];
  selectedCompanyId: number | null = null;
  nextCursor: number | null = null;
  loading = false;
  loadingMore = false;

  showCreate = false;
  createSubmitting = false;

  showEdit = false;
  editingAdmin: CompanyAdmin | null = null;
  editSubmitting = false;

  showNotificationModal = false;
  notificationSubmitting = false;
  notificationAdmin: CompanyAdmin | null = null;

  notification: { show: boolean; message: string; type: 'success' | 'error' | 'warning' | 'info' } = {
    show: false,
    message: '',
    type: 'info',
  };

  constructor(
    private readonly api: companyAdmin.ApiService,
    private readonly publicCompanies: publicApi.ApiService,
    private readonly authApi: auth.ApiService,
  ) { }

  ngOnInit(): void {
    this.loadCompaniesForSelect();
    this.fetch();
  }

  showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info') {
    this.notification = { show: true, message, type };
  }

  onLimitChange(value: PageLimit) {
    this.limit = value;
    this.fetch();
  }

  onCompanyFilterChange(companyId: number | null) {
    this.selectedCompanyId = companyId;
    this.fetch();
  }

  openCreate() {
    this.showCreate = true;
  }

  onCreateOpenChange(open: boolean) {
    this.showCreate = open;
    if (!open) this.createSubmitting = false;
  }

  onCreateValidateFailed(msg: string) {
    this.showNotification(msg, 'warning');
  }

  onCreateSubmit(body: CreateCompanyAdminBody) {
    this.createSubmitting = true;
    this.api.createCompanyAdmin(body).subscribe({
      next: () => {
        this.showNotification('Thành công.', 'success');
        this.onCreateOpenChange(false);
        this.fetch();
      },
      error: (err: unknown) => {
        this.showNotification(getApiErrorMessage(err, 'Thất bại.'), 'error');
        this.createSubmitting = false;
      },
    });
  }

  onUpdateClick(admin: CompanyAdmin) {
    this.editingAdmin = admin;
    this.showEdit = true;
  }

  openNotificationModal(admin: CompanyAdmin) {
    this.notificationAdmin = admin;
    this.showNotificationModal = true;
  }

  closeNotificationModal() {
    this.showNotificationModal = false;
    this.notificationSubmitting = false;
    this.notificationAdmin = null;
  }

  onEditOpenChange(open: boolean) {
    this.showEdit = open;
    if (!open) {
      this.editSubmitting = false;
      this.editingAdmin = null;
    }
  }

  onEditSubmit(body: UpdateCompanyAdminBody) {
    const target = this.editingAdmin;
    if (!target) return;
    const id = target.id;
    this.editSubmitting = true;
    this.api.updateCompanyAdmin(id, body).subscribe({
      next: (res) => {
        this.showNotification('Thành công.', 'success');
        this.admins = this.admins.map((a) =>
          a.id === id
            ? { ...a, fullName: body.fullName, email: body.email, phone: body.phone, status: body.status }
            : a,
        );
        this.onEditOpenChange(false);
      },
      error: (err: unknown) => {
        this.showNotification(getApiErrorMessage(err, 'Thất bại.'), 'error');
        this.editSubmitting = false;
      },
    });
  }

  loadMore() {
    if (this.nextCursor === null || this.loadingMore) return;
    this.loadingMore = true;
    this.fetchAdmins(this.nextCursor, false);
  }

  private fetch() {
    this.loading = true;
    this.admins = [];
    this.nextCursor = null;
    this.fetchAdmins(undefined, true);
  }

  private fetchAdmins(next: number | undefined, replace: boolean): void {
    this.api
      .getCompanyAdmins({
        limit: this.limit,
        next,
        companyId: this.selectedCompanyId ?? undefined,
      })
      .subscribe({
        next: (res) => {
          const normalized = normalizeCompanyAdminList(res);
          this.admins = replace ? normalized : [...this.admins, ...normalized];
          this.nextCursor = res.next ?? null;
          this.loading = false;
          this.loadingMore = false;
        },
        error: (err: unknown) => {
          const fallback = replace ? 'Tải danh sách tài khoản Nhà Xe thất bại.' : 'Tải thêm thất bại.';
          this.showNotification(getApiErrorMessage(err, fallback), 'error');
          this.loading = false;
          this.loadingMore = false;
        },
      });
  }

  submitNotification(payload: { title: string; body: string }) {
    if (!this.notificationAdmin) return;

    this.notificationSubmitting = true;
    this.authApi
      .sendNotification({
        userId: this.notificationAdmin.id,
        title: payload.title,
        body: payload.body,
        data: '',
      })
      .subscribe({
        next: () => {
          this.showNotification('Gửi thông báo thành công.', 'success');
          this.closeNotificationModal();
        },
        error: (err: unknown) => {
          this.showNotification(getApiErrorMessage(err, 'Gửi thông báo thất bại.'), 'error');
          this.notificationSubmitting = false;
        },
      });
  }

  private loadCompaniesForSelect() {
    this.publicCompanies.getCompanies(50).subscribe({
      next: (r) => {
        this.companies = r.companies ?? [];
      },
      error: () => {
        this.companies = [];
      },
    });
  }

}
