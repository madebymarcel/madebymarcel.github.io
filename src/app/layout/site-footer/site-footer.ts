import { Component } from '@angular/core';

@Component({
  selector: 'app-site-footer',
  template: `
    <footer class="site-footer">
      <p>Made by Marcel. Designed and engineered with care.</p>
    </footer>
  `,
  styles: [
    `
      .site-footer {
        border-top: 1px solid var(--border);
        color: var(--muted);
        font-size: 0.9rem;
        margin-top: 5rem;
        padding: 2rem 1.5rem;
        text-align: center;
      }
    `,
  ],
})
export class SiteFooter {}
