import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { PageToastHostComponent } from '@app/shared/components/page-toast-host/page-toast-host.component';
import { PageToastService } from '@app/shared/services/page-toast.service';
import { auth } from '../../data/services';
import { getApiErrorMessage } from '@app/shared/utils/api-error.util';
import { PageHeaderIntroComponent } from '@app/shared/components/page-header-intro/page-header-intro.component';
import { isValidPassword, PASSWORD_MESSAGE } from '@app/shared/utils/validators';

@Component({
  selector: 'app-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, PageToastHostComponent, PageHeaderIntroComponent],
  templateUrl: './password.component.html',
  styleUrl: './password.component.css',
})
export class PasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authApi = inject(auth.ApiService);
  private readonly toast = inject(PageToastService);

  form = this.fb.nonNullable.group({
    oldPassword: [''],
    newPassword: [''],
  });

  showOldPassword = false;
  showNewPassword = false;
  submitting = false;
  readonly passwordHint = PASSWORD_MESSAGE;

  toggleOldPassword(): void {
    this.showOldPassword = !this.showOldPassword;
  }

  toggleNewPassword(): void {
    this.showNewPassword = !this.showNewPassword;
  }

  submit(): void {
    this.toast.hide();

    const { oldPassword, newPassword } = this.form.getRawValue();
    const oldPwd = oldPassword.trim();
    const newPwd = newPassword.trim();

    if (!oldPwd && !newPwd) {
      this.toast.show('Vui lòng nhập mật khẩu cũ và mật khẩu mới.', 'warning');
      return;
    }

    if (!oldPwd) {
      this.toast.show('Vui lòng nhập mật khẩu cũ.', 'warning');
      return;
    }

    if (!newPwd) {
      this.toast.show('Vui lòng nhập mật khẩu mới.', 'warning');
      return;
    }

    if (!isValidPassword(oldPwd)) {
      this.toast.show(`Mật khẩu cũ không đúng định dạng. ${PASSWORD_MESSAGE}`, 'warning');
      return;
    }

    if (!isValidPassword(newPwd)) {
      this.toast.show(PASSWORD_MESSAGE, 'warning');
      return;
    }

    if (oldPwd === newPwd) {
      this.toast.show('Mật khẩu mới phải khác mật khẩu cũ.', 'warning');
      return;
    }

    this.submitting = true;
    this.authApi.updatePassword({ oldPassword: oldPwd, newPassword: newPwd }).subscribe({
      next: (res) => {
        this.toast.show(res.message || 'Cập nhật mật khẩu thành công.', 'success');
        this.form.reset();
      },
      error: (err: unknown) => {
        this.toast.show(getApiErrorMessage(err, 'Cập nhật mật khẩu thất bại.'), 'error');
        this.submitting = false;
      },
      complete: () => {
        this.submitting = false;
      },
    });
  }
}
