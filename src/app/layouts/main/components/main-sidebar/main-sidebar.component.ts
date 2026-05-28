import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export interface MainNavItem {
  label: string;
  route: string;
  icon: string;
}

@Component({
  selector: 'app-main-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './main-sidebar.component.html',
  styleUrl: './main-sidebar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainSidebarComponent {
  @Input({ required: true }) items: MainNavItem[] = [];
  @Input()
  set currentUrl(value: string) {
    this._currentUrl = value || '';
    this.activeRoute = this._currentUrl;
  }

  get currentUrl(): string {
    return this._currentUrl;
  }

  @Input() userInitial = 'U';
  @Input() userName = 'Người dùng';
  @Input() userRole = '';
  @Input() userEmail = '';
  @Input() mobileOpen = false;
  @Output() signOut = new EventEmitter<void>();
  @Output() closeMobile = new EventEmitter<void>();

  activeRoute = '';
  private _currentUrl = '';

  constructor(private readonly sanitizer: DomSanitizer) {}

  asSafeIcon(icon: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(icon);
  }

  activateImmediately(route: string): void {
    this.activeRoute = route;
  }

  onNavItemClick(route: string): void {
    this.activateImmediately(route);
    // Close mobile drawer when user taps a nav item
    if (this.mobileOpen) {
      this.closeMobile.emit();
    }
  }

  onLogoutClick(): void {
    if (this.mobileOpen) {
      this.closeMobile.emit();
    }
    this.signOut.emit();
  }

  isActive(route: string): boolean {
    const activePath = this.pathOnly(this.activeRoute || this.currentUrl);
    return activePath === route || activePath.startsWith(`${route}/`);
  }

  private pathOnly(url: string): string {
    return url.split(/[?#]/)[0] || '';
  }
}
