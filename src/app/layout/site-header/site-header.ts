import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeService } from '../../core/theme/theme.service';

@Component({
  selector: 'app-site-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './site-header.html',
  styleUrl: './site-header.scss',
  host: {
    '(document:keydown.escape)': 'onEscape()',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
})
export class SiteHeader {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');

  readonly theme = inject(ThemeService);
  readonly menuOpen = signal(false);
  readonly navigation = [
    { label: 'Home', path: '/' },
    { label: 'About', path: '/about' },
    { label: 'Experience', path: '/experience' },
    { label: 'Projects', path: '/projects' },
    { label: 'Lab', path: '/lab' },
    { label: 'Contact', path: '/contact' },
  ] as const;

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  onNavigate(path: string): void {
    const wasOpen = this.menuOpen();
    this.closeMenu();

    // Re-selecting a route does not trigger NavigationEnd; avoid leaving
    // keyboard focus inside the now-hidden mobile menu.
    const currentPath = this.router.url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    if (wasOpen && currentPath === path) {
      this.menuButton()?.nativeElement.focus();
    }
  }

  onEscape(): void {
    if (!this.menuOpen()) return;

    this.closeMenu();
    this.menuButton()?.nativeElement.focus();
  }

  onDocumentPointerDown(event: Event): void {
    if (this.menuOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.closeMenu();
    }
  }
}
