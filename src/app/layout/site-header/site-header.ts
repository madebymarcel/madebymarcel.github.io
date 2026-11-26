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
    '(document:keydown)': 'onKeydown($event)',
    '(document:pointerdown)': 'onOutsidePointerDown($event)',
    '(document:pointerup)': 'onOutsidePointerUp($event)',
    '(document:pointercancel)': 'onOutsidePointerCancel()',
    '[style.--header-bottom.px]': 'headerBottom()',
  },
})
export class SiteHeader {
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly header = viewChild<ElementRef<HTMLElement>>('header');
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly drawer = viewChild<ElementRef<HTMLDialogElement>>('drawer');

  private outsidePointerId: number | null = null;

  protected readonly headerBottom = signal(0);
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

    this.updateHeaderBottom();
    drawer.show();
    this.menuOpen.set(true);
    this.menuButton()?.nativeElement.focus();
  }

  toggleMenu(): void {
    if (this.menuOpen()) this.closeMenu();
    else this.openMenu();
  }

  closeMenu(): void {
    const drawer = this.drawer()?.nativeElement;
    if (!drawer?.open) return;

    this.outsidePointerId = null;
    drawer.close();
    this.menuOpen.set(false);
    this.menuButton()?.nativeElement.focus();
  }

  onNavigate(): void {
    // Closing before routing allows the route focus directive to focus the new heading.
    // Re-selecting the current route also restores focus to the menu button.
    this.closeMenu();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.menuOpen()) return;
    event.preventDefault();
    this.closeMenu();
  }

  onOutsidePointerDown(event: PointerEvent): void {
    this.outsidePointerId =
      this.menuOpen() && event.isPrimary && event.button === 0 && this.isOutsideMenu(event)
        ? event.pointerId
        : null;
  }

  onOutsidePointerUp(event: PointerEvent): void {
    const startedOutside = this.outsidePointerId === event.pointerId;
    this.outsidePointerId = null;
    if (startedOutside && this.isOutsideMenu(event)) this.closeMenu();
  }

  onOutsidePointerCancel(): void {
    this.outsidePointerId = null;
  }

  private isOutsideMenu(event: PointerEvent): boolean {
    return !this.host.nativeElement.contains(event.target as Node | null);
  }

  private updateHeaderBottom(): void {
    this.headerBottom.set(
      Math.max(0, this.header()?.nativeElement.getBoundingClientRect().bottom ?? 0),
    );
  }

  onResize(): void {
    if (!this.menuOpen()) return;
    this.updateHeaderBottom();
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
