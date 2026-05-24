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

  get activityRate(): number {
    return this.overview.totalCompanies > 0 ? 100 : 0;
  }

  get operatingScale(): number {
    return this.overview.totalUsers + this.overview.totalBookings + this.overview.totalCompanies;
  }

  get revenuePerCompany(): number {
    if (!this.overview.totalCompanies) return 0;
    return this.overview.totalRevenue / this.overview.totalCompanies;
  }
}
