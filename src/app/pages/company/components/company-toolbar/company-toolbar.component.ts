import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { PageLimit } from '../../../../data/constants/index';

@Component({
  selector: 'app-company-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './company-toolbar.component.html',
  styleUrls: ['../../../user/styles/user-shared.css', './company-toolbar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyToolbarComponent {
  @Input() searchName = '';
  @Input() limit!: PageLimit;
  @Input() pageLimits: readonly PageLimit[] = [];

  @Output() searchNameChange = new EventEmitter<string>();
  @Output() limitChange = new EventEmitter<PageLimit>();
  @Output() addClick = new EventEmitter<void>();
}
