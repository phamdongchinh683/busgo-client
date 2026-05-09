import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { auth, publicApi, user } from '../../data/services';
import { Company } from '../../data/interfaces/company';
import {
  CreateUserResponse,
  DeleteUserResponse,
  UpdateUserPasswordResponse,
  UpdateUserResponse,
  User,
  UserListResponse,
  USER_ROLES,
  USER_STATUSES,
} from '../../data/interfaces/user';
import { CompanyListResponse } from '../../data/interfaces/company';
import { DEFAULT_PAGE_LIMIT, PAGE_LIMITS } from '../../data/constants';
import {
  emailValidator,
  PASSWORD_MESSAGE,
  passwordValidator,
  phone10DigitsValidator,
} from '@app/shared/utils/validators';
import { SharedModule } from '@app/shared/shared.module';
import { getApiErrorMessage } from '@app/shared/utils/api-error.util';
import { UserFiltersPanelComponent } from './components/user-filters-panel/user-filters-panel.component';
import { UserListPanelComponent } from './components/user-list-panel/user-list-panel.component';
import { UserCreateModalComponent } from './components/user-create-modal/user-create-modal.component';
import { UserEditModalComponent } from './components/user-edit-modal/user-edit-modal.component';
import { UserPasswordModalComponent } from './components/user-password-modal/user-password-modal.component';
import { UserDeleteModalComponent } from './components/user-delete-modal/user-delete-modal.component';
import { UserNotificationModalComponent } from './components/user-notification-modal/user-notification-modal.component';

@Component({
  selector: 'app-user',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SharedModule,
    UserFiltersPanelComponent,
    UserListPanelComponent,
    UserCreateModalComponent,
    UserEditModalComponent,
    UserPasswordModalComponent,
    UserDeleteModalComponent,
    UserNotificationModalComponent,
  ],
  templateUrl: './user.component.html',
  styleUrl: './user.component.css',
})
export class UserComponent implements OnInit {
  statuses = USER_STATUSES;
  roles = USER_ROLES;
  createRoles = USER_ROLES.filter((role) => role === 'driver' || role === 'customer');
  pageLimits = PAGE_LIMITS;

  companies: Company[] = [];
  companiesLoading = false;
  companiesLoadingMore = false;
  companyDropdownOpen = false;
  selectedCompany: Company | null = null;
  private companyNextCursor: number | null = null;
  private companySearchTerm = '';
  private readonly COMPANY_PAGE_LIMIT = 10;

  users: User[] = [];
  nextCursor: number | null = null;

  loading = false;
  loadingMore = false;
  creatingUser = false;
  showCreateModal = false;
  showEditModal = false;
  showPasswordModal = false;
  showDeleteModal = false;
  editingUserLoading = false;
  updatingPasswordLoading = false;
  deletingUserLoading = false;
  selectedActionUser: User | null = null;

  showNotificationModal = false;
  notificationSubmitting = false;
  selectedNotificationUser: User | null = null;

  notification: { show: boolean; message: string; type: 'success' | 'error' | 'warning' | 'info' } = {
    show: false,
    message: '',
    type: 'info',
  };

  filters!: FormGroup<{
    email: FormControl<string | null>;
    phone: FormControl<string | null>;
    status: FormControl<null | (typeof USER_STATUSES)[number]>;
    role: FormControl<null | (typeof USER_ROLES)[number]>;
    companyName: FormControl<string | null>;
    limit: FormControl<number | null>;
  }>;

  createForm!: FormGroup<{
    username: FormControl<string | null>;
    fullName: FormControl<string | null>;
    email: FormControl<string | null>;
    phone: FormControl<string | null>;
    password: FormControl<string | null>;
    status: FormControl<(typeof USER_STATUSES)[number] | null>;
    role: FormControl<(typeof USER_ROLES)[number] | null>;
  }>;
  editForm!: FormGroup<{
    username: FormControl<string | null>;
    fullName: FormControl<string | null>;
    email: FormControl<string | null>;
    phone: FormControl<string | null>;
    status: FormControl<(typeof USER_STATUSES)[number] | null>;
    role: FormControl<(typeof USER_ROLES)[number] | null>;
  }>;
  passwordForm!: FormGroup<{ password: FormControl<string | null> }>;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly fb: FormBuilder,
    private readonly userApi: user.ApiService,
    private readonly companyApi: publicApi.ApiService,
    private readonly authApi: auth.ApiService,
  ) {
    this.filters = this.fb.group({
      email: ['', [emailValidator()]],
      phone: ['', [phone10DigitsValidator()]],
      status: [null as null | (typeof USER_STATUSES)[number]],
      role: [null as null | (typeof USER_ROLES)[number]],
      companyName: [''],
      limit: [DEFAULT_PAGE_LIMIT],
    });
    this.createForm = this.fb.group({
      username: ['', [Validators.required]],
      fullName: ['', [Validators.required, Validators.minLength(7)]],
      email: ['', [Validators.required, emailValidator()]],
      phone: ['', [Validators.required, phone10DigitsValidator()]],
      password: ['', [Validators.required, passwordValidator()]],
      status: ['active' as (typeof USER_STATUSES)[number]],
      role: ['driver' as (typeof USER_ROLES)[number]],
    });
    this.editForm = this.fb.group({
      username: ['', [Validators.required]],
      fullName: ['', [Validators.required, Validators.minLength(7)]],
      email: ['', [Validators.required, emailValidator()]],
      phone: ['', [Validators.required, phone10DigitsValidator()]],
      status: ['active' as (typeof USER_STATUSES)[number]],
      role: ['driver' as (typeof USER_ROLES)[number]],
    });
    this.passwordForm = this.fb.group({
      password: ['', [Validators.required, passwordValidator()]],
    });
  }

  ngOnInit(): void {
    this.fetchCompanies('');

    this.filters.controls.companyName.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((name) => {
        const term = (name ?? '').toString().trim();
        this.companySearchTerm = term;
        this.fetchCompanies(term);
        this.companyDropdownOpen = true;
      });

    this.applyFilters();

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.dropdown') || target.closest('input[formControlName="companyName"]')) return;
      this.companyDropdownOpen = false;
    };
    window.addEventListener('click', onClick);
    this.destroyRef.onDestroy(() => window.removeEventListener('click', onClick));
  }

  showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info') {
    this.notification = { show: true, message, type };
  }

  openCreateModal() {
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
    this.creatingUser = false;
    this.createForm.reset({
      username: '',
      fullName: '',
      email: '',
      phone: '',
      password: '',
      status: 'active',
      role: 'driver',
    });
  }

  openEditModal(u: User) {
    this.selectedActionUser = u;
    this.editForm.reset({
      username: u.username,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      status: u.status,
      role: u.role,
    });
    this.showEditModal = true;
  }

  closeEditModal() {
    this.showEditModal = false;
    this.editingUserLoading = false;
    this.selectedActionUser = null;
  }

  openPasswordModal(u: User) {
    this.selectedActionUser = u;
    this.showPasswordModal = true;
    this.passwordForm.reset({ password: '' });
  }

  closePasswordModal() {
    this.showPasswordModal = false;
    this.updatingPasswordLoading = false;
    this.selectedActionUser = null;
  }

  openDeleteModal(u: User) {
    this.selectedActionUser = u;
    this.showDeleteModal = true;
  }

  openNotificationModal(u: User) {
    this.selectedNotificationUser = u;
    this.showNotificationModal = true;
  }

  closeDeleteModal() {
    this.showDeleteModal = false;
    this.deletingUserLoading = false;
    this.selectedActionUser = null;
  }

  closeNotificationModal() {
    this.showNotificationModal = false;
    this.notificationSubmitting = false;
    this.selectedNotificationUser = null;
  }

  selectCompany(c: Company | null) {
    this.selectedCompany = c;
    this.filters.controls.companyName.setValue(c?.name ?? '', { emitEvent: false });
    this.companyDropdownOpen = false;
    this.applyFilters();
  }

  reset() {
    this.selectedCompany = null;
    this.filters.reset({
      email: '',
      phone: '',
      status: null,
      role: null,
      companyName: '',
      limit: DEFAULT_PAGE_LIMIT,
    });
    this.applyFilters();
  }

  submitCreateUser() {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      this.showNotification(this.getCreateFormErrorMessage(), 'warning');
      return;
    }

    const v = this.createForm.getRawValue();
    const password = (v.password ?? '').trim();

    this.creatingUser = true;
    this.userApi
      .createUser({
        username: (v.username ?? '').trim(),
        fullName: (v.fullName ?? '').trim(),
        email: (v.email ?? '').trim(),
        phone: (v.phone ?? '').trim(),
        password,
        status: (v.status ?? 'active') as (typeof USER_STATUSES)[number],
        role: (v.role ?? 'driver') as (typeof USER_ROLES)[number],
      })
      .subscribe({
        next: () => {
          this.showNotification('Tạo mới thành công.', 'success');
          this.closeCreateModal();
          this.applyFilters();
        },
        error: (err: unknown) => {
          this.showNotification(getApiErrorMessage(err, 'Tạo người dùng thất bại.'), 'error');
          this.creatingUser = false;
        },
      });
  }

  private getCreateFormErrorMessage(): string {
    const controls = this.createForm.controls;

    if (controls.username.errors?.['required']) return 'Tên đăng nhập là bắt buộc.';
    if (controls.fullName.errors?.['required']) return 'Họ tên là bắt buộc.';
    if (controls.fullName.errors?.['minlength']) return 'Họ tên phải có ít nhất 7 ký tự.';
    if (controls.email.errors?.['required']) return 'Địa chỉ email là bắt buộc.';
    if (controls.email.errors?.['email']) return 'Địa chỉ email không hợp lệ.';
    if (controls.phone.errors?.['required']) return 'Số điện thoại là bắt buộc.';
    if (controls.phone.errors?.['phone10Digits']) return 'Số điện thoại phải lớn hơn hoặc bằng 10 số.';
    if (controls.password.errors?.['required']) return 'Mật khẩu là bắt buộc.';
    if (controls.password.errors?.['password']) return PASSWORD_MESSAGE;
    if (controls.status.errors?.['required']) return 'Trạng thái là bắt buộc.';
    if (controls.role.errors?.['required']) return 'Vai trò là bắt buộc.';

    return 'Vui lòng điền đúng tất cả trường bắt buộc.';
  }

  submitEditUser() {
    if (!this.selectedActionUser) return;
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      this.showNotification(this.getEditFormErrorMessage(), 'warning');
      return;
    }
    const v = this.editForm.getRawValue();
    this.editingUserLoading = true;
    this.userApi
      .updateUser(this.selectedActionUser.id, {
        username: (v.username ?? '').trim(),
        fullName: (v.fullName ?? '').trim(),
        email: (v.email ?? '').trim(),
        phone: (v.phone ?? '').trim(),
        status: (v.status ?? 'active') as (typeof USER_STATUSES)[number],
      })
      .subscribe({
        next: (res: UpdateUserResponse) => {
          this.users = this.users.map((item) => (item.id === res.user.id ? { ...item, ...res.user } : item));
          this.showNotification('Cập nhật thành công.', 'success');
          this.closeEditModal();
        },
        error: (err: unknown) => {
          this.showNotification(getApiErrorMessage(err, 'Cập nhật người dùng thất bại.'), 'error');
          this.editingUserLoading = false;
        },
      });
  }

  private getEditFormErrorMessage(): string {
    const controls = this.editForm.controls;

    if (controls.username.errors?.['required']) return 'Tên đăng nhập là bắt buộc.';
    if (controls.fullName.errors?.['required']) return 'Họ tên là bắt buộc.';
    if (controls.fullName.errors?.['minlength']) return 'Họ tên phải có ít nhất 7 ký tự.';
    if (controls.email.errors?.['required']) return 'Địa chỉ email là bắt buộc.';
    if (controls.email.errors?.['email']) return 'Địa chỉ email không hợp lệ.';
    if (controls.phone.errors?.['required']) return 'Số điện thoại là bắt buộc.';
    if (controls.phone.errors?.['phone10Digits']) return 'Số điện thoại phải lớn hơn hoặc bằng 10 số.';
    if (controls.status.errors?.['required']) return 'Trạng thái là bắt buộc.';
    return 'Vui lòng nhập dữ liệu hợp lệ cho biểu mẫu chỉnh sửa.';
  }

  submitUpdatePassword() {
    if (!this.selectedActionUser) return;
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      this.showNotification(
        this.passwordForm.controls.password.errors?.['password'] ? PASSWORD_MESSAGE : 'Mật khẩu là bắt buộc.',
        'warning',
      );
      return;
    }
    const password = (this.passwordForm.controls.password.value ?? '').trim();
    this.updatingPasswordLoading = true;
    this.userApi.updatePassword(this.selectedActionUser.id, password).subscribe({
      next: (res: UpdateUserPasswordResponse) => {
        this.showNotification(`Đã cập nhật mật khẩu: ${res.password}`, 'success');
        this.closePasswordModal();
      },
      error: (err: unknown) => {
        this.showNotification(getApiErrorMessage(err, 'Cập nhật mật khẩu thất bại.'), 'error');
        this.updatingPasswordLoading = false;
      },
    });
  }

  submitDeleteUser() {
    if (!this.selectedActionUser) return;
    this.deletingUserLoading = true;
    this.userApi.deleteUser(this.selectedActionUser.id).subscribe({
      next: (res: DeleteUserResponse) => {
        this.users = this.users.filter((item) => item.id !== res.user.id);
        this.showNotification('Đã xóa.', 'success');
        this.closeDeleteModal();
      },
      error: () => {
        this.showNotification('Không thể xóa người dùng này.', 'error');
        this.deletingUserLoading = false;
      },
    });
  }

  submitNotification(payload: { title: string; body: string }) {
    if (!this.selectedNotificationUser) return;

    this.notificationSubmitting = true;
    this.authApi
      .sendNotification({
        userId: this.selectedNotificationUser.id,
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

  applyFilters() {
    if (this.filters.invalid) {
      this.filters.markAllAsTouched();
      this.showNotification('Vui lòng sửa các lỗi xác thực.', 'warning');
      return;
    }
    this.loading = true;
    this.users = [];
    this.nextCursor = null;

    const v = this.filters.getRawValue();

    this.userApi
      .getUsers({
        limit: Number(v.limit) || DEFAULT_PAGE_LIMIT,
        status: v.status ?? undefined,
        role: v.role ?? undefined,
        companyId: this.selectedCompany?.id,
        email: v.email?.trim() || undefined,
        phone: v.phone?.trim() || undefined,
      })
      .subscribe({
        next: (res: UserListResponse) => {
          this.users = res.users ?? [];
          this.nextCursor = res.next ?? null;
          this.loading = false;
        },
        error: (err: unknown) => {
          this.showNotification(getApiErrorMessage(err, 'Tải danh sách người dùng thất bại.'), 'error');
          this.loading = false;
        },
      });
  }

  loadMore() {
    if (this.nextCursor === null) return;
    if (this.filters.invalid) return;
    this.loadingMore = true;

    const v = this.filters.getRawValue();
    this.userApi
      .getUsers({
        limit: Number(v.limit) || DEFAULT_PAGE_LIMIT,
        next: this.nextCursor,
        status: v.status ?? undefined,
        role: v.role ?? undefined,
        companyId: this.selectedCompany?.id,
        email: v.email?.trim() || undefined,
        phone: v.phone?.trim() || undefined,
      })
      .subscribe({
        next: (res: UserListResponse) => {
          this.users = [...this.users, ...(res.users ?? [])];
          this.nextCursor = res.next ?? null;
          this.loadingMore = false;
        },
        error: (err: unknown) => {
          this.showNotification(getApiErrorMessage(err, 'Tải thêm người dùng thất bại.'), 'error');
          this.loadingMore = false;
        },
      });
  }

  onCompanyDropdownScroll(event: Event) {
    const el = event.target as HTMLElement;
    const reachedBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
    if (!reachedBottom) return;
    this.fetchMoreCompanies();
  }

  private fetchMoreCompanies() {
    if (this.companyNextCursor === null) return;
    if (this.companiesLoading || this.companiesLoadingMore) return;

    this.companiesLoadingMore = true;
    this.companyApi
      .getCompanies(this.COMPANY_PAGE_LIMIT, this.companyNextCursor, this.companySearchTerm || undefined)
      .subscribe({
        next: (res: CompanyListResponse) => {
          const incoming = res.companies ?? [];
          const existingIds = new Set(this.companies.map((c) => c.id));
          const merged = incoming.filter((c) => !existingIds.has(c.id));
          this.companies = [...this.companies, ...merged];
          this.companyNextCursor = res.next ?? null;
          this.companiesLoadingMore = false;
        },
        error: () => {
          this.companiesLoadingMore = false;
        },
      });
  }

  private fetchCompanies(name: string) {
    this.companiesLoading = true;
    this.companies = [];
    this.companyNextCursor = null;

    this.companyApi.getCompanies(this.COMPANY_PAGE_LIMIT, undefined, name || undefined).subscribe({
      next: (res: CompanyListResponse) => {
        this.companies = res.companies ?? [];
        this.companyNextCursor = res.next ?? null;
        this.companiesLoading = false;
        this.companiesLoadingMore = false;
      },
      error: () => {
        this.companies = [];
        this.companyNextCursor = null;
        this.companiesLoading = false;
        this.companiesLoadingMore = false;
      },
    });
  }

}
