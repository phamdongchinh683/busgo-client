import { Component, EventEmitter, inject, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Company } from '../../../../data/interfaces/company';
import { CreateCompanyAdminBody } from '../../../../data/interfaces/company-admin';
import { emailValidator, PASSWORD_MESSAGE, passwordValidator } from '@app/shared/utils/validators';
import { digitsOnlyPhone } from '../../utils/company-admin.mapper';
import { companyAdminEditPhoneValidator } from '../../utils/company-admin-edit.validators';

@Component({
  selector: 'app-company-admin-create-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './company-admin-create-modal.component.html',
  styleUrl: './company-admin-create-modal.component.css',
})
export class CompanyAdminCreateModalComponent implements OnChanges {
  private readonly fb = inject(FormBuilder);

  @Input() open = false;
  @Input() companies: Company[] = [];
  @Input() submitting = false;
  @Output() openChange = new EventEmitter<boolean>();
  @Output() submitted = new EventEmitter<CreateCompanyAdminBody>();
  @Output() validateFailed = new EventEmitter<string>();

  showPassword = false;

  form = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(7)]],
    email: ['', [Validators.required, emailValidator()]],
    phone: ['', [Validators.required, companyAdminEditPhoneValidator()]],
    password: ['', [Validators.required, passwordValidator()]],
    companyId: [null as number | null, [Validators.required]],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && !this.open) {
      this.reset();
    }
  }

  close() {
    this.openChange.emit(false);
  }

  reset() {
    this.showPassword = false;
    this.form.reset({
      fullName: '',
      email: '',
      phone: '',
      password: '',
      companyId: null,
    });
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.validateFailed.emit(this.firstFormErrorMessage());
      return;
    }
    const v = this.form.getRawValue();
    const companyId = v.companyId;
    if (companyId === null || companyId === undefined) return;

    this.submitted.emit({
      fullName: (v.fullName ?? '').trim(),
      contactInfo: {
        email: (v.email ?? '').trim(),
        phone: digitsOnlyPhone(v.phone ?? ''),
      },
      password: (v.password ?? '').trim(),
      companyId: Number(companyId),
    });
  }

  private firstFormErrorMessage(): string {
    const c = this.form.controls;
    if (c.fullName.errors?.['required']) return 'Họ tên là bắt buộc.';
    if (c.fullName.errors?.['minlength']) return 'Họ tên phải có ít nhất 7 ký tự.';
    if (c.email.errors?.['required']) return 'Địa chỉ email là bắt buộc.';
    if (c.email.errors?.['email']) return 'Định dạng địa chỉ email không hợp lệ.';
    if (c.phone.errors?.['required']) return 'Số điện thoại là bắt buộc.';
    if (c.phone.errors?.['phone']) return 'Số điện thoại phải lớn hơn hoặc bằng 10 số.';
    if (c.password.errors?.['required']) return 'Mật khẩu là bắt buộc.';
    if (c.password.errors?.['password']) return PASSWORD_MESSAGE;
    if (c.companyId.errors?.['required']) return 'Vui lòng chọn công ty.';
    return 'Vui lòng kiểm tra lại biểu mẫu.';
  }

  private showFieldError(control: AbstractControl): boolean {
    return control.touched || control.dirty;
  }

  get fullNameError(): string | null {
    const c = this.form.controls.fullName;
    if (!this.showFieldError(c)) return null;
    if (c.errors?.['required']) return 'Họ tên là bắt buộc.';
    if (c.errors?.['minlength']) return 'Tối thiểu 7 ký tự.';
    return null;
  }

  get emailError(): string | null {
    const c = this.form.controls.email;
    if (!this.showFieldError(c)) return null;
    if (c.errors?.['required']) return 'Địa chỉ email là bắt buộc.';
    if (c.errors?.['email']) return 'Địa chỉ email không đúng định dạng.';
    return null;
  }

  get phoneError(): string | null {
    const c = this.form.controls.phone;
    if (!this.showFieldError(c)) return null;
    if (c.errors?.['required']) return 'Số điện thoại là bắt buộc.';
    if (c.errors?.['phone']) return 'Số điện thoại phải lớn hơn hoặc bằng 10 số.';
    return null;
  }

  get passwordError(): string | null {
    const c = this.form.controls.password;
    if (!this.showFieldError(c)) return null;
    if (c.errors?.['required']) return 'Mật khẩu là bắt buộc.';
    if (c.errors?.['password']) return PASSWORD_MESSAGE;
    return null;
  }

  get companyError(): string | null {
    const c = this.form.controls.companyId;
    if (!this.showFieldError(c)) return null;
    if (c.errors?.['required']) return 'Công ty là bắt buộc.';
    return null;
  }
}
