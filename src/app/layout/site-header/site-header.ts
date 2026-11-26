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
  private drawerTransition = 0;

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
    if (!drawer || this.menuOpen()) return;

    this.drawerTransition++;
    this.updateHeaderBottom();
    drawer.inert = false;
    if (!drawer.open) {
      drawer.show();
      // Establish the closed visual state before starting the entry transition.
      drawer.getBoundingClientRect();
    }
    drawer.classList.add('is-open');
    this.menuOpen.set(true);
    this.menuButton()?.nativeElement.focus({ preventScroll: true });
  }

  toggleMenu(): void {
    if (this.menuOpen()) this.closeMenu();
    else this.openMenu();
  }

  closeMenu(): void {
    const drawer = this.drawer()?.nativeElement;
    if (!drawer?.open || !this.menuOpen()) return;

    const transition = ++this.drawerTransition;
    this.outsidePointerId = null;
    this.menuOpen.set(false);
    this.menuButton()?.nativeElement.focus({ preventScroll: true });
    drawer.inert = true;
    drawer.classList.remove('is-open');

    // Keep the native dialog rendered until its exit transitions finish.
    // A new opening invalidates this completion, including a reversed transition.
    drawer.getBoundingClientRect();
    const animations = drawer.getAnimations();
    if (animations.length === 0) {
      drawer.close();
      return;
    }

    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (transition === this.drawerTransition && drawer.open) drawer.close();
    });
  }

  onNavigate(): void {
    // Closing before routing allows the route focus directive to focus the new heading.
    // Re-selecting the current route also restores focus to the menu button.
    this.closeMenu();
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.menuOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMenu();
    } else if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      this.moveMenuFocus(event);
    }
  }

  private moveMenuFocus(event: KeyboardEvent): void {
    const button = this.menuButton()?.nativeElement;
    const drawer = this.drawer()?.nativeElement;
    if (!button || !drawer) return;

    // Include links even in browsers that skip them during native tab navigation.
    // Leave the ends of this sequence to the browser; the dialog is not modal.
    const items = [
      button,
      ...drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    ];
    const index = items.findIndex((item) => item === drawer.ownerDocument.activeElement);
    const next = index < 0 ? undefined : items[index + (event.shiftKey ? -1 : 1)];
    if (!next) return;

    event.preventDefault();
    next.focus();
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
