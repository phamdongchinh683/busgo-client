import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DashboardOverview } from '../../../../data/interfaces/dashboard';

@Component({
  selector: 'app-dashboard-stats-grid',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-stats-grid.component.html',
  styleUrl: './dashboard-stats-grid.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardStatsGridComponent {
  @Input({ required: true }) overview!: DashboardOverview;
}
