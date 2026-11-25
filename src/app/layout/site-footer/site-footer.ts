import { Component } from '@angular/core';

@Component({
  selector: 'app-site-footer',
  template: `
    <footer class="site-footer">
      <p>Made by Marcel ({{ year }})</p>
    </footer>
  `,
  styles: [
    `
      .site-footer {
        border-top: var(--border-width) solid var(--border);
        color: var(--muted);
        font-size: var(--type-small);
        margin-top: var(--space-section);
        padding: var(--space-6) var(--space-page);
        text-align: center;
      }
    `,
  ],
})
export class SiteFooter {
  protected readonly year = new Date().getFullYear();
}
