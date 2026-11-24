import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NavigationStart, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ThemeService } from '../../core/theme/theme.service';

@Component({
  selector: 'app-site-header',
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive],
  templateUrl: './site-header.html',
  styleUrl: './site-header.scss',
  host: {
    '(window:resize)': 'onResize()',
  },
})
export class SiteHeader {
  private readonly router = inject(Router);
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly drawer = viewChild<ElementRef<HTMLDialogElement>>('drawer');

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

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) this.closeMenu();
    });
  }

  openMenu(): void {
    const drawer = this.drawer()?.nativeElement;
    if (!drawer || drawer.open) return;

    drawer.showModal();
    this.menuOpen.set(true);
  }

  closeMenu(): void {
    const drawer = this.drawer()?.nativeElement;
    if (!drawer?.open) return;

    drawer.close();
    this.menuOpen.set(false);
    this.menuButton()?.nativeElement.focus();
  }

  onNavigate(): void {
    // Closing before routing allows the route focus directive to focus the new heading.
    // Re-selecting the current route also restores focus to the menu button.
    this.closeMenu();
  }

  onCancel(event: Event): void {
    event.preventDefault();
    this.closeMenu();
  }

  onDrawerClick(event: MouseEvent): void {
    const drawer = this.drawer()?.nativeElement;
    if (!drawer || event.target !== drawer) return;

    const bounds = drawer.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      this.closeMenu();
    }
  }

  onResize(): void {
    if (!this.menuOpen()) return;
    const drawer = this.drawer()?.nativeElement;
    if (drawer?.ownerDocument.defaultView?.matchMedia('(min-width: 901px)').matches) {
      this.closeMenu();
      const activeLink = drawer.ownerDocument.querySelector<HTMLElement>(
        '.header-actions nav a.active',
      );
      activeLink?.focus();
    }
  }
}
