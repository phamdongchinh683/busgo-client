import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { PageLimit } from '../../../../data/constants';
import { Company } from '../../../../data/interfaces/company';

@Component({
  selector: 'app-company-admin-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './company-admin-toolbar.component.html',
  styleUrls: ['../../../user/styles/user-shared.css', './company-admin-toolbar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyAdminToolbarComponent {
  @Input({ required: true }) limit!: PageLimit;
  @Input({ required: true }) pageLimits: readonly PageLimit[] = [];
  @Input() companies: Company[] = [];
  @Input() companiesLoading = false;
  @Input() companiesLoadingMore = false;
  @Input() dropdownOpen = false;
  @Input() selectedCompany: Company | null = null;
  @Input() companySearchValue = '';

  @Output() limitChange = new EventEmitter<PageLimit>();
  @Output() createClick = new EventEmitter<void>();
  @Output() selectCompany = new EventEmitter<Company | null>();
  @Output() dropdownOpenChange = new EventEmitter<boolean>();
  @Output() companySearchValueChange = new EventEmitter<string>();
  @Output() companyDropdownScroll = new EventEmitter<Event>();

  onCompanyFocus(): void {
    this.dropdownOpenChange.emit(true);
  }

  onScroll(event: Event): void {
    this.companyDropdownScroll.emit(event);
  }
}
