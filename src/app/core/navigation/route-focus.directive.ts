import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Directive, ElementRef, inject, PLATFORM_ID } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

@Directive({ selector: 'main[appRouteFocus]' })
export class RouteFocus {
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        // Do not steal focus from the browser on the initial page load.
        if (!isPlatformBrowser(this.platformId) || event.id === 1) return;

        this.document.defaultView?.requestAnimationFrame(() => {
          const heading = this.host.nativeElement.querySelector('h1');
          if (!heading) return;

          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        });
      });
  }
}
