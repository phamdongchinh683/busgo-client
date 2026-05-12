import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { userStatusLabel } from '@app/shared/utils/domain-labels';

@Component({
  selector: 'app-user-edit-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-edit-modal.component.html',
  styleUrls: ['../../styles/user-shared.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserEditModalComponent {
  @Input() open = false;
  @Input({ required: true }) form!: FormGroup;
  @Input() submitting = false;
  @Input() statuses: readonly string[] = [];

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<void>();

  close(): void {
    this.closed.emit();
  }

  stopPropagation(ev: Event): void {
    ev.stopPropagation();
  }

  displayStatus = userStatusLabel;
}
