import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import type { DashboardTrendChartKind } from '../../../../data/interfaces/dashboard/stats';

Chart.register(...registerables);

const PALETTE = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#4f46e5', '#65a30d'];
const GRID_COLOR = '#e7eef5';
const AXIS_TEXT_COLOR = '#64748b';
const TOOLTIP_BG = '#243244';

@Component({
  selector: 'app-dashboard-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-chart.component.html',
  styleUrl: './dashboard-chart.component.css',
})
export class DashboardChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('cv') canvasRef?: ElementRef<HTMLCanvasElement>;

  @Input() title = '';
  @Input() labels: string[] = [];
  @Input() datasets: { label: string; data: number[]; backgroundColor?: string }[] = [];
  @Input() chartKind: DashboardTrendChartKind = 'bar';
  @Input() stacked = true;
  @Input() yFormat: 'number' | 'currency' = 'number';
  @Input() loading = false;

  private chart?: Chart;
  private viewReady = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) return;
    if (changes['labels'] || changes['datasets'] || changes['chartKind'] || changes['stacked'] || changes['yFormat']) {
      this.render();
    }
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = undefined;
  }

  private formatTooltipValue(n: number, datasetLabel: string): string {
    if (this.yFormat === 'currency') {
      const formatted = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0,
      }).format(n);
      return datasetLabel ? `${datasetLabel}: ${formatted}` : formatted;
    }
    return datasetLabel ? `${datasetLabel}: ${n.toLocaleString()}` : n.toLocaleString();
  }

  private buildArcChartData(): ChartConfiguration<'doughnut' | 'pie'>['data'] {
    if (this.datasets.length === 1) {
      const d0 = this.datasets[0];
      return {
        labels: this.labels.length ? this.labels : d0.data.map((_, i) => `Mục ${i + 1}`),
        datasets: [
          {
            label: d0.label || 'Tổng',
            data: d0.data.map((v) => Number(v ?? 0)),
            backgroundColor: d0.data.map((_, i) => d0.backgroundColor ?? PALETTE[i % PALETTE.length]),
            borderWidth: 1,
            borderColor: '#ffffff',
            hoverBorderColor: '#ffffff',
          },
        ],
      };
    }

    const sums = this.datasets.map((d) => d.data.reduce((a, x) => a + Number(x ?? 0), 0));
    const arcLabels = this.datasets.map((d) => d.label);
    return {
      labels: arcLabels,
      datasets: [
        {
          label: 'Tỷ trọng',
          data: sums,
          backgroundColor: arcLabels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 1,
          borderColor: '#ffffff',
          hoverBorderColor: '#ffffff',
        },
      ],
    };
  }

  private renderArc(type: 'doughnut' | 'pie'): void {
    const el = this.canvasRef?.nativeElement;
    if (!el) return;
    this.chart?.destroy();
    this.chart = undefined;
    if (!this.datasets.length) return;
    if (this.datasets.length === 1 && !this.datasets[0].data.length) return;

    const data = this.buildArcChartData();
    const cfg: ChartConfiguration<'doughnut' | 'pie'> = {
      type,
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...(type === 'doughnut' ? { cutout: '64%' } : {}),
        layout: { padding: { top: 8, right: 8, bottom: 0, left: 8 } },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              color: AXIS_TEXT_COLOR,
              padding: 14,
              usePointStyle: true,
              pointStyle: 'rectRounded',
            },
          },
          tooltip: {
            backgroundColor: TOOLTIP_BG,
            borderColor: 'rgba(255, 255, 255, 0.12)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const raw = ctx.raw;
                const n = typeof raw === 'number' ? raw : Number(raw);
                const lbl = String(ctx.label ?? '');
                return this.formatTooltipValue(n, lbl);
              },
            },
          },
        },
      },
    };

    this.chart = new Chart(el, cfg);
  }

  private renderCartesian(): void {
    const el = this.canvasRef?.nativeElement;
    if (!el) return;

    this.chart?.destroy();
    this.chart = undefined;

    if (!this.labels.length || !this.datasets.length) {
      return;
    }

    const kind = this.chartKind === 'line' ? 'line' : 'bar';
    const ds = this.datasets.map((d, i) => ({
      label: d.label,
      data: d.data,
      backgroundColor: d.backgroundColor ?? PALETTE[i % PALETTE.length],
      borderColor: d.backgroundColor ?? PALETTE[i % PALETTE.length],
      borderWidth: kind === 'line' ? 2 : 0,
      tension: kind === 'line' ? 0.25 : undefined,
      fill: kind === 'line' ? false : undefined,
      pointRadius: kind === 'line' ? 2 : undefined,
      pointHoverRadius: kind === 'line' ? 4 : undefined,
      borderRadius: kind === 'bar' ? 4 : undefined,
      borderSkipped: kind === 'bar' ? false : undefined,
      maxBarThickness: kind === 'bar' ? 34 : undefined,
    }));

    const stackedBar = kind === 'bar' && this.stacked;
    const cfg: ChartConfiguration = {
      type: kind,
      data: { labels: this.labels, datasets: ds },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 8, right: 8, bottom: 0, left: 4 } },
        plugins: {
          legend: {
            position: 'bottom',
            align: 'start',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              color: AXIS_TEXT_COLOR,
              padding: 14,
              usePointStyle: true,
              pointStyle: 'rectRounded',
            },
          },
          tooltip: {
            backgroundColor: TOOLTIP_BG,
            borderColor: 'rgba(255, 255, 255, 0.12)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const raw = ctx.parsed;
                const n =
                  typeof raw === 'object' && raw !== null && 'y' in raw
                    ? Number((raw as { y: number }).y)
                    : Number(raw);
                const label = ctx.dataset.label ?? '';
                return this.formatTooltipValue(n, label);
              },
            },
          },
        },
        scales: {
          x: {
            stacked: stackedBar,
            border: { display: false },
            grid: { display: false },
            ticks: {
              color: AXIS_TEXT_COLOR,
              maxRotation: 0,
              autoSkipPadding: 18,
            },
          },
          y: {
            stacked: stackedBar,
            border: { display: false },
            grid: {
              color: GRID_COLOR,
              drawTicks: false,
            },
            ticks: {
              color: AXIS_TEXT_COLOR,
              padding: 8,
              callback: (val) => {
                const n = Number(val);
                if (this.yFormat === 'currency') {
                  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
                }
                return n.toLocaleString();
              },
            },
          },
        },
      },
    };

    this.chart = new Chart(el, cfg);
  }

  private render(): void {
    if (this.chartKind === 'doughnut' || this.chartKind === 'pie') {
      this.renderArc(this.chartKind);
      return;
    }
    this.renderCartesian();
  }
}
