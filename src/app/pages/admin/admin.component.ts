import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { PageToastHostComponent } from '@app/shared/components/page-toast-host/page-toast-host.component';
import { PageHeaderIntroComponent } from '@app/shared/components/page-header-intro/page-header-intro.component';
import { PageToastService } from '@app/shared/services/page-toast.service';
import { auth, companyAdmin, publicApi } from '../../data/services';
import { Company, CompanyListResponse } from '../../data/interfaces/company';
import { CompanyAdmin, CreateCompanyAdminBody, UpdateCompanyAdminBody } from '../../data/interfaces/company-admin';
import { normalizeCompanyAdminList, mapCompanyAdminRow } from './utils/company-admin.mapper';
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
    PageToastHostComponent,
    PageHeaderIntroComponent,
    CompanyAdminToolbarComponent,
    CompanyAdminTableComponent,
    CompanyAdminCreateModalComponent,
    CompanyAdminEditModalComponent,
    UserNotificationModalComponent,
  ],
  templateUrl: './admin.component.html',
})
export class AdminComponent implements OnInit {
  limit: PageLimit = DEFAULT_PAGE_LIMIT;
  pageLimits = PAGE_LIMITS;

  admins: CompanyAdmin[] = [];
  createCompanies: Company[] = [];
  filterCompanies: Company[] = [];
  companiesLoading = false;
  companiesLoadingMore = false;
  companyDropdownOpen = false;
  selectedCompany: Company | null = null;
  companySearch = new FormControl('');
  private companyNextCursor: number | null = null;
  private companySearchTerm = '';
  private readonly COMPANY_PAGE_LIMIT = 10;
  private readonly destroyRef = inject(DestroyRef);
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

  readonly toast = inject(PageToastService);
  private readonly cdr = inject(ChangeDetectorRef);

  constructor(
    private readonly api: companyAdmin.ApiService,
    private readonly publicCompanies: publicApi.ApiService,
    private readonly authApi: auth.ApiService,
  ) { }

  ngOnInit(): void {
    this.loadCreateCompanies();
    this.fetchFilterCompanies('');

    this.companySearch.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((name) => {
        const term = (name ?? '').toString().trim();
        this.companySearchTerm = term;
        this.fetchFilterCompanies(term);
        this.companyDropdownOpen = true;
      });

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.dropdown') || target.closest('.field--company .input')) return;
      this.companyDropdownOpen = false;
    };
    window.addEventListener('click', onClick);
    this.destroyRef.onDestroy(() => window.removeEventListener('click', onClick));

    this.fetch();
  }

  onCompanySearchValueChange(value: string) {
    this.companySearch.setValue(value);
  }

  selectFilterCompany(company: Company | null) {
    this.selectedCompany = company;
    this.companySearch.setValue(company?.name ?? '', { emitEvent: false });
    this.companyDropdownOpen = false;
    this.fetch();
  }

  onCompanyDropdownScroll(event: Event) {
    const el = event.target as HTMLElement;
    const reachedBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
    if (!reachedBottom) return;
    this.fetchMoreFilterCompanies();
  }

  onLimitChange(value: PageLimit) {
    this.limit = value;
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
    this.toast.show(msg, 'warning');
  }

  onCreateSubmit(body: CreateCompanyAdminBody) {
    this.createSubmitting = true;
    this.api.createCompanyAdmin(body).subscribe({
      next: (res) => {
        const created = this.resolveCreatedAdmin(res, body);
        if (created) {
          this.admins = [created, ...this.admins];
        }
        this.toast.show('Thành công.', 'success');
        this.onCreateOpenChange(false);
        this.cdr.markForCheck();
      },
      error: (err: unknown) => {
        this.toast.show(getApiErrorMessage(err, 'Thất bại.'), 'error');
        this.createSubmitting = false;
        this.cdr.markForCheck();
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
        this.toast.show('Thành công.', 'success');
        this.admins = this.admins.map((a) =>
          a.id === id
            ? { ...a, fullName: body.fullName, email: body.email, phone: body.phone, status: body.status }
            : a,
        );
        this.onEditOpenChange(false);
      },
      error: (err: unknown) => {
        this.toast.show(getApiErrorMessage(err, 'Thất bại.'), 'error');
        this.editSubmitting = false;
      },
    });
  }

  loadMore() {
    if (this.nextCursor === null || this.loadingMore) return;
    this.loadingMore = true;
    this.fetchAdmins(this.nextCursor, false);
  }

  private resolveCreatedAdmin(
    res: { message?: string } | Record<string, unknown>,
    body: CreateCompanyAdminBody,
  ): CompanyAdmin | null {
    if (this.selectedCompany && this.selectedCompany.id !== body.companyId) return null;

    const raw = res as Record<string, unknown>;
    const entity = raw['companyAdmin'] ?? raw['admin'] ?? raw['user'];
    if (entity && typeof entity === 'object') {
      return mapCompanyAdminRow(entity as Record<string, unknown>);
    }

    const companyName =
      this.createCompanies.find((company) => company.id === body.companyId)?.name ??
      this.filterCompanies.find((company) => company.id === body.companyId)?.name ??
      this.selectedCompany?.name ??
      '';

    return {
      id: -Date.now(),
      username: body.username,
      fullName: body.fullName,
      email: body.contactInfo.email,
      phone: body.contactInfo.phone,
      status: 'active',
      companyId: body.companyId,
      companyName,
    };
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
        companyId: this.selectedCompany?.id,
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
          this.toast.show(getApiErrorMessage(err, fallback), 'error');
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
          this.toast.show('Gửi thông báo thành công.', 'success');
          this.closeNotificationModal();
        },
        error: (err: unknown) => {
          this.toast.show(getApiErrorMessage(err, 'Gửi thông báo thất bại.'), 'error');
          this.notificationSubmitting = false;
        },
      });
  }

  private loadCreateCompanies() {
    this.publicCompanies.getCompanies(50).subscribe({
      next: (r) => {
        this.createCompanies = r.companies ?? [];
      },
      error: () => {
        this.createCompanies = [];
      },
    });
  }

  private fetchMoreFilterCompanies() {
    if (this.companyNextCursor === null) return;
    if (this.companiesLoading || this.companiesLoadingMore) return;

    this.companiesLoadingMore = true;
    this.publicCompanies
      .getCompanies(this.COMPANY_PAGE_LIMIT, this.companyNextCursor, this.companySearchTerm || undefined)
      .subscribe({
        next: (res: CompanyListResponse) => {
          const incoming = res.companies ?? [];
          const existingIds = new Set(this.filterCompanies.map((company) => company.id));
          const merged = incoming.filter((company) => !existingIds.has(company.id));
          this.filterCompanies = [...this.filterCompanies, ...merged];
          this.companyNextCursor = res.next ?? null;
          this.companiesLoadingMore = false;
        },
        error: () => {
          this.companiesLoadingMore = false;
        },
      });
  }

  private fetchFilterCompanies(name: string) {
    this.companiesLoading = true;
    this.filterCompanies = [];
    this.companyNextCursor = null;

    this.publicCompanies.getCompanies(this.COMPANY_PAGE_LIMIT, undefined, name || undefined).subscribe({
      next: (res: CompanyListResponse) => {
        this.filterCompanies = res.companies ?? [];
        this.companyNextCursor = res.next ?? null;
        this.companiesLoading = false;
        this.companiesLoadingMore = false;
      },
      error: () => {
        this.filterCompanies = [];
        this.companyNextCursor = null;
        this.companiesLoading = false;
        this.companiesLoadingMore = false;
      },
    });
  }

}
