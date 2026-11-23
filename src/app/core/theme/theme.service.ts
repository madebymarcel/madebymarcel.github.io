import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { effect, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly selectedMode = signal<ThemeMode>('light');

  readonly mode = this.selectedMode.asReadonly();

  constructor() {
    // A signal effect is appropriate for synchronizing with an imperative browser API.
    effect(() => {
      const mode = this.mode();
      if (isPlatformBrowser(this.platformId)) {
        this.document.documentElement.setAttribute('data-theme', mode);
      }
    });
  }

  toggle(): void {
    this.selectedMode.update((mode) => (mode === 'light' ? 'dark' : 'light'));
  }
}
