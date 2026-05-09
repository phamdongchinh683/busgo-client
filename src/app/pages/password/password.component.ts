import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { SharedModule } from '@app/shared/shared.module';
import { auth } from '../../data/services';
import { getApiErrorMessage } from '@app/shared/utils/api-error.util';
import { isValidPassword, PASSWORD_MESSAGE } from '@app/shared/utils/validators';

@Component({
  selector: 'app-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SharedModule],
  templateUrl: './password.component.html',
  styleUrl: './password.component.css',
})
export class PasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authApi = inject(auth.ApiService);

  form = this.fb.nonNullable.group({
    oldPassword: [''],
    newPassword: [''],
  });

  showOldPassword = false;
  showNewPassword = false;
  submitting = false;

  notification: { show: boolean; message: string; type: 'success' | 'error' | 'warning' | 'info' } = {
    show: false,
    message: '',
    type: 'info',
  };

  toggleOldPassword(): void {
    this.showOldPassword = !this.showOldPassword;
  }

  toggleNewPassword(): void {
    this.showNewPassword = !this.showNewPassword;
  }

  private showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info'): void {
    this.notification = { show: true, message, type };
  }

  submit(): void {
    this.notification.show = false;

    const { oldPassword, newPassword } = this.form.getRawValue();
    const oldPwd = oldPassword.trim();
    const newPwd = newPassword.trim();

    if (!oldPwd && !newPwd) {
      this.showNotification('Vui lòng nhập mật khẩu cũ và mật khẩu mới.', 'warning');
      return;
    }

    if (!oldPwd) {
      this.showNotification('Vui lòng nhập mật khẩu cũ.', 'warning');
      return;
    }

    if (!newPwd) {
      this.showNotification('Vui lòng nhập mật khẩu mới.', 'warning');
      return;
    }

    if (!isValidPassword(oldPwd)) {
      this.showNotification(`Mật khẩu cũ không đúng định dạng. ${PASSWORD_MESSAGE}`, 'warning');
      return;
    }

    if (!isValidPassword(newPwd)) {
      this.showNotification(PASSWORD_MESSAGE, 'warning');
      return;
    }

    if (oldPwd === newPwd) {
      this.showNotification('Mật khẩu mới phải khác mật khẩu cũ.', 'warning');
      return;
    }

    this.submitting = true;
    this.authApi.updatePassword({ oldPassword: oldPwd, newPassword: newPwd }).subscribe({
      next: (res) => {
        this.showNotification(res.message || 'Cập nhật mật khẩu thành công.', 'success');
        this.form.reset();
      },
      error: (err: unknown) => {
        this.showNotification(getApiErrorMessage(err, 'Cập nhật mật khẩu thất bại.'), 'error');
        this.submitting = false;
      },
      complete: () => {
        this.submitting = false;
      },
    });
  }
}
