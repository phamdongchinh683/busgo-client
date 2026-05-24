import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CompanyAdmin } from '../../../../data/interfaces/company-admin';
import { userStatusLabel } from '@app/shared/utils/domain-labels';

@Component({
  selector: 'app-company-admin-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './company-admin-table.component.html',
  styleUrl: './company-admin-table.component.css',
})
export class CompanyAdminTableComponent {
  @Input() admins: CompanyAdmin[] = [];
  @Input() loading = false;
  @Output() updateClick = new EventEmitter<CompanyAdmin>();
  @Output() notifyClick = new EventEmitter<CompanyAdmin>();

  readonly skeletonRows = Array.from({ length: 6 });
  displayStatus = userStatusLabel;
}
