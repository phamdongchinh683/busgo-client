import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardOverview } from '../../../../data/interfaces/dashboard';

@Component({
  selector: 'app-dashboard-stats-grid',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-stats-grid.component.html',
  styleUrl: './dashboard-stats-grid.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardStatsGridComponent {
  @Input({ required: true }) overview!: DashboardOverview;
}
