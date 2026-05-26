import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { User } from '../../../../data/interfaces/user';
import { staffProfileRoleLabel, userRoleLabel, userStatusLabel } from '@app/shared/utils/domain-labels';

@Component({
  selector: 'app-user-list-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-list-panel.component.html',
  styleUrls: ['../../styles/user-table.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserListPanelComponent {
  @Input() users: User[] = [];
  @Input() loading = false;
  @Input() loadingMore = false;
  @Input() nextCursor: number | null = null;

  @Output() loadMore = new EventEmitter<void>();
  @Output() editUser = new EventEmitter<User>();
  @Output() passwordUser = new EventEmitter<User>();
  @Output() deleteUser = new EventEmitter<User>();
  @Output() notifyUser = new EventEmitter<User>();

  readonly skeletonRows = Array.from({ length: 6 });
  displayStatus = userStatusLabel;
  displayRole = userRoleLabel;
  displayStaffProfileRole = staffProfileRoleLabel;
}
