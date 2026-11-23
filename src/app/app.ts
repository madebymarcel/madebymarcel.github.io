import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { RouteFocus } from './core/navigation/route-focus.directive';
import { SiteHeader } from './layout/site-header/site-header';
import { SiteFooter } from './layout/site-footer/site-footer';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouteFocus, SiteHeader, SiteFooter],
  templateUrl: './app.html',
})
export class App {
  private readonly router = inject(Router);
  private readonly mainContent = viewChild<ElementRef<HTMLElement>>('mainContent');

  protected get skipHref(): string {
    return this.router.url.split('#')[0] + '#main-content';
  }

  protected skipToContent(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    this.mainContent()?.nativeElement.focus();
  }
}
