import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Company } from '../../../../data/interfaces/company';
import { PageLimit } from '../../../../data/constants';
import { userRoleLabel, userStatusLabel } from '@app/shared/utils/domain-labels';

@Component({
  selector: 'app-user-filters-panel',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-filters-panel.component.html',
  styleUrls: ['../../styles/user-shared.css', './user-filters-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserFiltersPanelComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() companies: Company[] = [];
  @Input() companiesLoading = false;
  @Input() companiesLoadingMore = false;
  @Input() dropdownOpen = false;
  @Input() selectedCompany: Company | null = null;
  @Input() statuses: readonly string[] = [];
  @Input() roles: readonly string[] = [];
  @Input() pageLimits: readonly PageLimit[] = [];
  @Input() listLoading = false;

  @Output() applyFilters = new EventEmitter<void>();
  @Output() resetFilters = new EventEmitter<void>();
  @Output() selectCompany = new EventEmitter<Company | null>();
  @Output() dropdownOpenChange = new EventEmitter<boolean>();
  @Output() companyDropdownScroll = new EventEmitter<Event>();

  onCompanyFocus(): void {
    this.dropdownOpenChange.emit(true);
  }

  onScroll(ev: Event): void {
    this.companyDropdownScroll.emit(ev);
  }

  displayStatus = userStatusLabel;
  displayRole = userRoleLabel;
}
