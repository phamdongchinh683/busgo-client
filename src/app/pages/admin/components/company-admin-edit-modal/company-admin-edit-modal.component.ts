import { Component, EventEmitter, inject, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  CompanyAdmin,
  COMPANY_ADMIN_STATUSES,
  UpdateCompanyAdminBody,
} from '../../../../data/interfaces/company-admin';
import { emailValidator } from '@app/shared/utils/validators';
import { userStatusLabel } from '@app/shared/utils/domain-labels';
import { digitsOnlyPhone } from '../../utils/company-admin.mapper';
import { companyAdminEditPhoneValidator } from '../../utils/company-admin-edit.validators';

@Component({
  selector: 'app-company-admin-edit-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './company-admin-edit-modal.component.html',
  styleUrls: ['../../../user/styles/user-shared.css', './company-admin-edit-modal.component.css'],
})
export class CompanyAdminEditModalComponent implements OnChanges {
  private readonly fb = inject(FormBuilder);

  @Input() open = false;
  @Input() admin: CompanyAdmin | null = null;
  @Input() submitting = false;
  @Output() openChange = new EventEmitter<boolean>();
  @Output() submitted = new EventEmitter<UpdateCompanyAdminBody>();
  @Output() validateFailed = new EventEmitter<string>();

  statuses = COMPANY_ADMIN_STATUSES;
  readonly displayStatus = userStatusLabel;

  form = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(7)]],
    email: ['', [Validators.required, emailValidator()]],
    phone: ['', [Validators.required, companyAdminEditPhoneValidator()]],
    status: [null as CompanyAdmin['status'] | null, [Validators.required]],
  });

  ngOnChanges(changes: SimpleChanges): void {
    const openBecameTrue = changes['open']?.currentValue === true;
    const adminChanged = !!changes['admin'];

    if (this.open && this.admin && (openBecameTrue || adminChanged)) {
      this.form.patchValue(
        {
          fullName: this.admin.fullName,
          email: this.admin.email,
          phone: this.admin.phone,
          status: this.admin.status,
        },
        { emitEvent: false },
      );
      this.form.markAsUntouched();
    }

    if (changes['open'] && !this.open) {
      this.form.markAsUntouched();
    }
  }

  close() {
    this.openChange.emit(false);
  }

  onSubmit() {
    if (!this.admin) {
      this.validateFailed.emit('Chưa chọn tài khoản.');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.validateFailed.emit(this.firstFormErrorMessage());
      return;
    }
    const v = this.form.getRawValue();
    const phone = digitsOnlyPhone(v.phone ?? '');
    this.submitted.emit({
      fullName: (v.fullName ?? '').trim(),
      email: (v.email ?? '').trim(),
      phone,
      status: v.status as CompanyAdmin['status'],
    });
  }

  private firstFormErrorMessage(): string {
    const c = this.form.controls;
    if (c.fullName.errors?.['required']) return 'Họ tên là bắt buộc.';
    if (c.fullName.errors?.['minlength']) return 'Họ tên phải có ít nhất 7 ký tự.';
    if (c.email.errors?.['required']) return 'Địa chỉ email là bắt buộc.';
    if (c.email.errors?.['email']) return 'Địa chỉ email không hợp lệ.';
    if (c.phone.errors?.['required']) return 'Số điện thoại là bắt buộc.';
    if (c.phone.errors?.['phone']) return 'Số điện thoại phải lớn hơn hoặc bằng 10 số.';
    if (c.status.errors?.['required']) return 'Trạng thái là bắt buộc.';
    return 'Vui lòng kiểm tra lại biểu mẫu.';
  }
}
