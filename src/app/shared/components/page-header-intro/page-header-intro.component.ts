import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-page-header-intro',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './page-header-intro.component.html',
  styleUrl: './page-header-intro.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeaderIntroComponent {
  @Input({ required: true }) title!: string;
  @Input() subtitle = '';
  @Input() badge = '';
}
