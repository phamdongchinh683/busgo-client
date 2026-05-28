import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import * as L from 'leaflet';
import { Company } from '../../../../data/interfaces/company';
import { vnLocation } from '../../../../data/services';

@Component({
  selector: 'app-company-form-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './company-form-modal.component.html',
  styleUrls: ['../../styles/company-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyFormModalComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() open = false;
  @Input({ required: true }) form!: FormGroup;
  @Input() editingCompany: Company | null = null;
  @Input() submitting = false;
  @Input() uploadingLogo = false;
  @Input() uploadLogoProgress = 0;

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<void>();
  @Output() logoUploadError = new EventEmitter<string>();
  @Output() logoSelected = new EventEmitter<File | null>();

  resolvingFromAddress = false;
  private pendingLogoPreviewUrl = '';

  private _mapEl?: ElementRef<HTMLDivElement>;
  @ViewChild('mapEl') set mapEl(el: ElementRef<HTMLDivElement> | undefined) {
    this._mapEl = el;
    if (el && this.hasCoordinates && !this.map) {
      // Element just appeared in DOM (thanks to *ngIf) — initialize now
      setTimeout(() => this.initMapIfNeeded(), 0);
    }
  }
  get mapEl(): ElementRef<HTMLDivElement> | undefined {
    return this._mapEl;
  }

  private map: L.Map | null = null;
  private marker: L.Marker | null = null;
  private mapInitialized = false;

  // Beautiful free tile layer (CartoDB Voyager) - pure tile API calls, no key required
  private readonly TILE_LAYER = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  private readonly TILE_ATTRIBUTION = '&copy; OpenStreetMap &copy; CARTO';

  constructor(
    private readonly vnLocationApi: vnLocation.ApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly zone: NgZone,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']?.currentValue === true) {
      this.revokePendingLogoPreview();
      this.syncCoordinateControls();

      // Edit mode with pre-filled coordinates: give the map a chance to appear
      if (this.hasCoordinates) {
        this.triggerMapAfterCoordinatesReady();
      }
    }
    if (changes['open']?.previousValue === true && changes['open']?.currentValue === false) {
      this.revokePendingLogoPreview();
      this.destroyMap();
    }
    if (changes['editingCompany'] && !changes['editingCompany'].firstChange) {
      this.revokePendingLogoPreview();
    }

    // While map is already visible, react to any further coordinate changes
    if (this.map && this.hasCoordinates) {
      this.zone.runOutsideAngular(() => this.updateMapFromForm());
    }
  }

  get canUploadLogo(): boolean {
    return this.editingCompany !== null;
  }

  get logoPreviewUrl(): string {
    if (this.pendingLogoPreviewUrl) return this.pendingLogoPreviewUrl;
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

  async findCoordinatesFromAddress(): Promise<void> {
    const raw = this.form?.get('address')?.value;
    const address = typeof raw === 'string' ? raw.trim() : '';
    if (address.length < 6) {
      this.form.patchValue({ latitude: null, longitude: null }, { emitEvent: false });
      this.destroyMap();
      this.cdr.markForCheck();
      return;
    }

    this.resolvingFromAddress = true;
    this.cdr.markForCheck();

    try {
      const result = await firstValueFrom(this.vnLocationApi.geocodeAddress(address));
      if (!result) {
        this.form.patchValue({ latitude: null, longitude: null }, { emitEvent: false });
        this.destroyMap();
        this.logoUploadError.emit('Không tìm thấy địa điểm phù hợp trên bản đồ.');
        return;
      }
      // Never overwrite address text from user input; only store resolved coordinates.
      this.form.patchValue({
        latitude: result.latitude,
        longitude: result.longitude,
      });

      // Explicitly trigger map creation (ngOnChanges does not fire on internal form.patchValue)
      this.triggerMapAfterCoordinatesReady();
    } catch {
      this.logoUploadError.emit('Không thể tìm tọa độ từ địa chỉ.');
      this.destroyMap();
    } finally {
      this.resolvingFromAddress = false;
      this.cdr.markForCheck();
    }
  }

  onAddressInput(): void {
    this.form.patchValue({ latitude: null, longitude: null }, { emitEvent: false });
    this.destroyMap();
    this.cdr.markForCheck();
  }

  async onLogoFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.editingCompany) return;

    if (!file.type.startsWith('image/')) {
      this.logoUploadError.emit('Chỉ hỗ trợ tệp ảnh.');
      return;
    }

    this.setPendingLogoPreview(file);
    this.logoSelected.emit(file);
    this.cdr.markForCheck();
  }

  private setPendingLogoPreview(file: File): void {
    this.revokePendingLogoPreview();
    this.pendingLogoPreviewUrl = URL.createObjectURL(file);
  }

  private revokePendingLogoPreview(): void {
    if (!this.pendingLogoPreviewUrl) return;
    URL.revokeObjectURL(this.pendingLogoPreviewUrl);
    this.pendingLogoPreviewUrl = '';
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

  // ==================== LEAFLET MAP (free tile API calls) ====================

  private triggerMapAfterCoordinatesReady(): void {
    // Small delay so *ngIf can render the .map-leaflet div before Leaflet tries to attach
    setTimeout(() => {
      if (!this.map) {
        this.initMapIfNeeded();
      } else {
        this.zone.runOutsideAngular(() => this.updateMapFromForm());
      }
    }, 30);
  }

  ngAfterViewInit(): void {
    // Fallback for edit mode when coordinates already exist on open
    if (this.open && this.hasCoordinates) {
      setTimeout(() => this.initMapIfNeeded(), 0);
    }
  }

  ngOnDestroy(): void {
    this.destroyMap();
  }

  private initMapIfNeeded(): void {
    const container = this.mapEl?.nativeElement;
    if (!container || this.map) return;

    const lat = this.toNullableNumber(this.form?.get('latitude')?.value)!;
    const lon = this.toNullableNumber(this.form?.get('longitude')?.value)!;

    this.zone.runOutsideAngular(() => {
      // Create map
      this.map = L.map(container, {
        zoomControl: true,
        attributionControl: true,
      }).setView([lat, lon], 16);

      // Beautiful free Carto Voyager tiles (clean, modern, professional look)
      L.tileLayer(this.TILE_LAYER, {
        attribution: this.TILE_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(this.map);

      // Custom nice marker (no asset headaches, theme-friendly)
      const markerIcon = this.createCustomMarkerIcon();
      this.marker = L.marker([lat, lon], {
        icon: markerIcon,
        draggable: true,
      }).addTo(this.map);

      // Click on map → update coordinates (great UX improvement)
      this.map.on('click', (e: L.LeafletMouseEvent) => {
        const { lat: clickLat, lng: clickLon } = e.latlng;
        this.zone.run(() => {
          this.form.patchValue({
            latitude: Number(clickLat.toFixed(6)),
            longitude: Number(clickLon.toFixed(6)),
          });
          this.updateMarkerPosition(clickLat, clickLon);
          this.cdr.markForCheck();
        });
      });

      // Drag marker → update form
      this.marker.on('dragend', () => {
        if (!this.marker) return;
        const pos = this.marker.getLatLng();
        this.zone.run(() => {
          this.form.patchValue({
            latitude: Number(pos.lat.toFixed(6)),
            longitude: Number(pos.lng.toFixed(6)),
          });
          this.cdr.markForCheck();
        });
      });

      this.mapInitialized = true;

      // Ensure Leaflet calculates correct size (important when container just appeared)
      setTimeout(() => {
        if (this.map) this.map.invalidateSize();
      }, 80);
    });
  }

  private updateMapFromForm(): void {
    if (!this.map) return;

    const lat = this.toNullableNumber(this.form?.get('latitude')?.value);
    const lon = this.toNullableNumber(this.form?.get('longitude')?.value);
    if (lat === null || lon === null) return;

    // If map not yet created, create it now
    if (!this.mapInitialized) {
      this.initMapIfNeeded();
      return;
    }

    this.updateMarkerPosition(lat, lon);

    // Smooth fly to new location (only if far enough)
    const currentCenter = this.map.getCenter();
    const dist = this.map.distance(currentCenter, L.latLng(lat, lon));
    if (dist > 300) {
      this.map.flyTo([lat, lon], 16, { duration: 0.6 });
    }
  }

  private updateMarkerPosition(lat: number, lon: number): void {
    if (!this.marker || !this.map) return;

    const newPos = L.latLng(lat, lon);
    this.marker.setLatLng(newPos);
  }

  private createCustomMarkerIcon(): L.DivIcon {
    return L.divIcon({
      className: 'company-map-marker',
      html: `
        <div style="
          width: 28px;
          height: 28px;
          background: #0f766e;
          border: 3px solid white;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 2px 6px rgba(0,0,0,0.25);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="
            width: 8px;
            height: 8px;
            background: white;
            border-radius: 50%;
            transform: rotate(45deg);
          "></div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -28],
    });
  }

  private destroyMap(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.marker = null;
      this.mapInitialized = false;
    }
  }
}
