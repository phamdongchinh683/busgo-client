import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { PageLimit } from '../../../../data/constants/index';
import { Company } from '../../../../data/interfaces/company';

@Component({
  selector: 'app-company-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './company-toolbar.component.html',
  styleUrls: ['../../../user/styles/user-shared.css', './company-toolbar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyToolbarComponent {
  @Input() limit!: PageLimit;
  @Input() pageLimits: readonly PageLimit[] = [];
  @Input() companies: Company[] = [];
  @Input() companiesLoading = false;
  @Input() companiesLoadingMore = false;
  @Input() dropdownOpen = false;
  @Input() selectedCompany: Company | null = null;

  @Output() limitChange = new EventEmitter<PageLimit>();
  @Output() addClick = new EventEmitter<void>();
  @Output() selectCompany = new EventEmitter<Company | null>();
  @Output() dropdownOpenChange = new EventEmitter<boolean>();
  @Output() companyDropdownScroll = new EventEmitter<Event>();

  onCompanyFocus(): void {
    this.dropdownOpenChange.emit(true);
  }

  onScroll(event: Event): void {
    this.companyDropdownScroll.emit(event);
  }
}
