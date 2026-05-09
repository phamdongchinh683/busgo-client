import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { Company } from '../../../../data/interfaces/company';
import { upload, vnLocation } from '../../../../data/services';

@Component({
  selector: 'app-company-form-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './company-form-modal.component.html',
  styleUrls: ['../../styles/company-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyFormModalComponent implements OnChanges {
  @Input() open = false;
  @Input({ required: true }) form!: FormGroup;
  @Input() editingCompany: Company | null = null;
  @Input() submitting = false;

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<void>();
  @Output() logoUploadError = new EventEmitter<string>();

  uploadingLogo = false;
  uploadLogoProgress = 0;
  resolvingFromAddress = false;

  constructor(
    private readonly uploadApi: upload.ApiService,
    private readonly vnLocationApi: vnLocation.ApiService,
    private readonly sanitizer: DomSanitizer,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']?.currentValue === true) {
      this.syncCoordinateControls();
    }
  }

  get canUploadLogo(): boolean {
    return this.editingCompany !== null;
  }

  get logoPreviewUrl(): string {
    const v = this.form?.get('logoUrl')?.value;
    return typeof v === 'string' ? v.trim() : '';
  }

  close(): void {
    this.closed.emit();
  }

  stopPropagation(ev: Event): void {
    ev.stopPropagation();
  }

  triggerLogoFileInput(input: HTMLInputElement): void {
    input.click();
  }

  get hasCoordinates(): boolean {
    return this.toNullableNumber(this.form?.get('latitude')?.value) !== null && this.toNullableNumber(this.form?.get('longitude')?.value) !== null;
  }

  get mapEmbedUrl(): SafeResourceUrl | null {
    const lat = this.toNullableNumber(this.form?.get('latitude')?.value);
    const lon = this.toNullableNumber(this.form?.get('longitude')?.value);
    if (lat === null || lon === null) return null;
    const delta = 0.006;
    const left = (lon - delta).toFixed(6);
    const right = (lon + delta).toFixed(6);
    const top = (lat + delta).toFixed(6);
    const bottom = (lat - delta).toFixed(6);
    const url = `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  async findCoordinatesFromAddress(): Promise<void> {
    const raw = this.form?.get('address')?.value;
    const address = typeof raw === 'string' ? raw.trim() : '';
    if (address.length < 6) {
      this.form.patchValue({ latitude: null, longitude: null }, { emitEvent: false });
      return;
    }

    this.resolvingFromAddress = true;
    this.cdr.markForCheck();

    try {
      const result = await firstValueFrom(this.vnLocationApi.geocodeAddress(address));
      if (!result) {
        this.form.patchValue({ latitude: null, longitude: null }, { emitEvent: false });
        this.logoUploadError.emit('Không tìm thấy địa điểm phù hợp trên bản đồ.');
        return;
      }
      // Never overwrite address text from user input; only store resolved coordinates.
      this.form.patchValue({
        latitude: result.latitude,
        longitude: result.longitude,
      });
    } catch {
      this.logoUploadError.emit('Không thể tìm tọa độ từ địa chỉ.');
    } finally {
      this.resolvingFromAddress = false;
      this.cdr.markForCheck();
    }
  }

  onAddressInput(): void {
    this.form.patchValue({ latitude: null, longitude: null }, { emitEvent: false });
  }

  async onLogoFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.editingCompany) return;

    this.uploadingLogo = true;
    this.uploadLogoProgress = 0;
    this.cdr.markForCheck();

    try {
      const presigned = await firstValueFrom(this.uploadApi.getPresigned('company', this.editingCompany.id));
      const prefersWebp = presigned.acceptedMimeTypes?.includes('image/webp');
      const uploadFile = await this.uploadApi.prepareImageForUpload(file, presigned, {
        maxBytes: 8 * 1024 * 1024,
        minResizeBytes: 300 * 1024,
        maxDimension: 420,
        preferredOutputType: prefersWebp ? 'image/webp' : 'image/jpeg',
        quality: prefersWebp ? 0.76 : 0.8,
      });
      const secureUrl = await this.uploadApi.uploadImageToCloudinaryWithProgress(uploadFile, presigned, (percent) => {
        this.uploadLogoProgress = percent;
        this.cdr.markForCheck();
      });
      this.form.patchValue({ logoUrl: secureUrl });
    } catch (e: unknown) {
      let message = 'Logo upload failed.';
      if (e instanceof HttpErrorResponse) {
        message = (e.error as { message?: string })?.message ?? e.message ?? message;
      } else if (e instanceof Error) {
        message = e.message;
      }
      this.logoUploadError.emit(message);
    } finally {
      this.uploadingLogo = false;
      this.uploadLogoProgress = 0;
      this.cdr.markForCheck();
    }
  }

  private syncCoordinateControls(): void {
    const latitude = this.toNullableNumber(this.form?.get('latitude')?.value);
    const longitude = this.toNullableNumber(this.form?.get('longitude')?.value);
    this.form.patchValue({ latitude, longitude }, { emitEvent: false });
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }
}
