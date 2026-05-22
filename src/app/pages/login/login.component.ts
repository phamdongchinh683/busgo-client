import { Component, ElementRef, OnDestroy, QueryList, ViewChildren, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { auth } from '../../data/services/index';
import { AppButtonComponent } from '@app/shared/components/app-button/app-button.component';
import { AppInputComponent } from '@app/shared/components/app-input/app-input.component';
import { PageToastHostComponent } from '@app/shared/components/page-toast-host/page-toast-host.component';
import { PageToastService } from '@app/shared/services/page-toast.service';
import { getApiErrorMessage } from '@app/shared/utils/api-error.util';
import {
  isDigitsOnly,
  isEmail,
  isPhone10Digits,
  isValidPassword,
  PASSWORD_MESSAGE,
} from '@app/shared/utils/validators';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, PageToastHostComponent, AppInputComponent, AppButtonComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnDestroy {
  private static readonly OTP_COOLDOWN_SECONDS = 120;
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(PageToastService);
  private resendOtpTimerId: ReturnType<typeof setInterval> | null = null;

  @ViewChildren('otpBox') otpBoxRefs!: QueryList<ElementRef<HTMLInputElement>>;

  loginForm = this.fb.nonNullable.group({
    text: [''],
    password: [''],
  });

  forgotForm = this.fb.nonNullable.group({
    account: [''],
    otpDigits: this.fb.array(
      Array.from({ length: 6 }, () => this.fb.nonNullable.control('')),
    ),
    newPassword: [''],
  });

  loading = false;
  sendingOtp = false;
  resettingPassword = false;
  forgotPasswordOpen = false;
  otpSent = false;
  otpTarget: { field: 'email' | 'phone'; value: string } | null = null;
  resendOtpCooldownSeconds = 0;

  constructor(
    private readonly api: auth.ApiService,
    private readonly router: Router,
  ) { }

  ngOnDestroy(): void {
    this.clearResendOtpTimer();
  }

  private validateText(text: string): string | null {
    if (isEmail(text)) {
      return null;
    }
    if (/^\+?\d+$/.test(text)) {
      if (text.length < 10) return 'Số điện thoại phải có ít nhất 10 chữ số.';
      return null;
    }
    return 'Vui lòng nhập email hợp lệ hoặc số điện thoại từ 10 chữ số.';
  }

  private parseForgotAccount(raw: string): { field: 'email' | 'phone'; value: string } | null {
    const value = raw.trim();
    if (!value) return null;

    if (value.includes('@')) {
      if (!isEmail(value)) return null;
      return { field: 'email', value };
    }

    if (isDigitsOnly(value)) {
      if (!isPhone10Digits(value)) return null;
      return { field: 'phone', value };
    }

    return null;
  }

  openForgotPassword(): void {
    this.toast.hide();
    this.forgotPasswordOpen = true;
  }

  closeForgotPassword(): void {
    this.forgotPasswordOpen = false;
    this.otpSent = false;
    this.otpTarget = null;
    this.clearResendOtpTimer();
    this.resendOtpCooldownSeconds = 0;
    this.forgotForm.reset();
  }

  get otpDigits(): FormArray {
    return this.forgotForm.controls.otpDigits as FormArray;
  }

  private resetOtpDigits(): void {
    this.otpDigits.controls.forEach((c) => c.setValue(''));
  }

  private focusOtpBox(index: number): void {
    const el = this.otpBoxRefs?.get(index)?.nativeElement;
    if (el) {
      el.focus();
      el.select();
    }
  }

  onOtpDigitInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const digit = input.value.replace(/\D/g, '').slice(-1) ?? '';
    this.otpDigits.at(index).setValue(digit);
    input.value = digit;
    if (digit && index < 5) {
      queueMicrotask(() => this.focusOtpBox(index + 1));
    }
  }

  onOtpDigitKeydown(index: number, event: KeyboardEvent): void {
    const current = (this.otpDigits.at(index).value ?? '').toString();
    if (event.key === 'Backspace' && !current && index > 0) {
      this.focusOtpBox(index - 1);
    }
  }

  onOtpPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') ?? '';
    const digits = text.replace(/\D/g, '').slice(0, 6);
    for (let i = 0; i < 6; i++) {
      this.otpDigits.at(i).setValue(digits[i] ?? '');
    }
    const next = Math.min(Math.max(digits.length - 1, 0), 5);
    queueMicrotask(() => this.focusOtpBox(next));
  }

  stopForgotModalPropagation(ev: Event): void {
    ev.stopPropagation();
  }

  onForgotFormSubmit(): void {
    if (!this.otpSent) {
      this.sendOtp();
      return;
    }
    this.submitForgotPassword();
  }

  backToSendOtpStep(): void {
    this.otpSent = false;
    this.otpTarget = null;
    this.forgotForm.patchValue({ newPassword: '' });
    this.resetOtpDigits();
  }

  get canSendOtp(): boolean {
    return !this.sendingOtp && this.resendOtpCooldownSeconds === 0;
  }

  get resendOtpCooldownLabel(): string {
    const minutes = Math.floor(this.resendOtpCooldownSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (this.resendOtpCooldownSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  get isOtpExpired(): boolean {
    return this.otpSent && this.resendOtpCooldownSeconds === 0;
  }

  sendOtp(): void {
    this.toast.hide();
    if (!this.canSendOtp) {
      this.toast.show(`Vui lòng chờ ${this.resendOtpCooldownLabel} để gửi lại OTP.`, 'info');
      return;
    }
    const account = this.forgotForm.controls.account.value;
    const target = this.parseForgotAccount(account);

    if (!target) {
      this.toast.show('Vui lòng nhập email hợp lệ hoặc số điện thoại từ 10 chữ số.', 'warning');
      return;
    }

    this.sendingOtp = true;
    this.api.sendOtp(target).subscribe({
      next: (res) => {
        this.resetOtpDigits();
        this.otpSent = true;
        this.otpTarget = target;
        this.startResendOtpCooldown();
        this.toast.show('Đã gửi OTP thành công vui lòng kiểm tra email hoặc số điện thoại nếu không nhận được vui lòng kiểm tra thư rác.', 'info');
        setTimeout(() => this.focusOtpBox(0), 50);
      },
      error: (err: { error?: { message?: string } }) => {
        this.toast.show(getApiErrorMessage(err, 'Gửi OTP thất bại.'), 'error');
        this.sendingOtp = false;
      },
      complete: () => {
        this.sendingOtp = false;
      },
    });
  }

  private startResendOtpCooldown(): void {
    this.clearResendOtpTimer();
    this.resendOtpCooldownSeconds = LoginComponent.OTP_COOLDOWN_SECONDS;
    this.resendOtpTimerId = setInterval(() => {
      if (this.resendOtpCooldownSeconds <= 1) {
        this.clearResendOtpTimer();
        this.resendOtpCooldownSeconds = 0;
        return;
      }
      this.resendOtpCooldownSeconds -= 1;
    }, 1000);
  }

  private clearResendOtpTimer(): void {
    if (this.resendOtpTimerId) {
      clearInterval(this.resendOtpTimerId);
      this.resendOtpTimerId = null;
    }
  }

  submitForgotPassword(): void {
    if (!this.otpSent) {
      return;
    }

    this.toast.hide();

    const target = this.otpTarget ?? this.parseForgotAccount(this.forgotForm.controls.account.value);
    if (!target) {
      this.toast.show('Vui lòng nhập email hợp lệ hoặc số điện thoại hợp lệ trước khi xác nhận OTP.', 'warning');
      return;
    }

    if (this.isOtpExpired) {
      this.toast.show('Mã OTP đã hết hạn. Vui lòng gửi lại OTP mới.', 'warning');
      return;
    }

    const otp = this.otpDigits.controls.map((c) => (c.value ?? '').toString()).join('').trim();
    const newPassword = this.forgotForm.controls.newPassword.value.trim();

    if (otp.length !== 6 || !newPassword) {
      this.toast.show('Vui lòng nhập đủ 6 số OTP và mật khẩu mới.', 'warning');
      return;
    }

    if (!isValidPassword(newPassword)) {
      this.toast.show(PASSWORD_MESSAGE, 'warning');
      return;
    }

    const payload: auth.ResetPasswordWithOtpRequest = {
      otp,
      password: newPassword,
      [target.field]: target.value,
    };

    this.resettingPassword = true;
    this.api.resetPasswordWithOtp(payload).subscribe({
      next: (res) => {
        this.toast.show(res.message || 'Đặt lại mật khẩu thành công.', 'success');
        this.closeForgotPassword();
      },
      error: (err) => {
        this.toast.show('OTP không hợp lệ.', 'error');
        this.resettingPassword = false;
      },
      complete: () => {
        this.resettingPassword = false;
      },
    });
  }

  onSubmit() {
    this.toast.hide();

    const { text: rawText, password } = this.loginForm.getRawValue();
    const text = rawText.trim();

    if (!text || !password) {
      this.toast.show('Vui lòng điền đầy đủ thông tin.', 'warning');
      return;
    }

    const textError = this.validateText(text);
    if (textError) {
      this.toast.show(textError, 'warning');
      return;
    }

    if (!isValidPassword(password)) {
      this.toast.show(PASSWORD_MESSAGE, 'warning');
      return;
    }

    this.loading = true;
    this.api.signIn(text, password).subscribe({
      next: (res: { token: string; user: unknown }) => {
        localStorage.setItem('token', res.token);
        localStorage.setItem('user', JSON.stringify(res.user));
        this.router.navigate(['/dashboard']);
        this.loading = false;
      },
      error: (err: { error?: { message?: string } }) => {
        this.toast.show(getApiErrorMessage(err, 'Đăng nhập thất bại.'), 'error');
        this.loading = false;
      },
    });
  }
}
