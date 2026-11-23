import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, effect, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'madebymarcel-theme';
const THEME_COLORS: Record<ThemeMode, string> = {
  light: '#f8f7f4',
  dark: '#15141b',
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly window = this.browser ? this.document.defaultView : null;
  private readonly media = this.window?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  private manualMode: ThemeMode | null = this.getSavedMode();
  private readonly selectedMode = signal<ThemeMode>(
    this.manualMode ?? (this.media?.matches ? 'dark' : 'light'),
  );

  readonly mode = this.selectedMode.asReadonly();

  private readonly onSystemChange = (event: MediaQueryListEvent): void => {
    if (this.manualMode === null) {
      this.selectedMode.set(event.matches ? 'dark' : 'light');
    }
  };

  constructor() {
    this.media?.addEventListener('change', this.onSystemChange);
    inject(DestroyRef).onDestroy(() => {
      this.media?.removeEventListener('change', this.onSystemChange);
    });

    // The head bootstrap prevents first-paint flashing; this synchronizes later changes.
    effect(() => {
      if (!this.browser) return;
      const mode = this.mode();
      this.document.documentElement.setAttribute('data-theme', mode);
      this.document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', THEME_COLORS[mode]);
    });
  }

  toggle(): void {
    const mode: ThemeMode = this.mode() === 'light' ? 'dark' : 'light';
    this.manualMode = mode;
    this.selectedMode.set(mode);

    try {
      this.window?.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // The current session still works when persistent storage is unavailable.
    }
  }

  private getSavedMode(): ThemeMode | null {
    try {
      const saved = this.window?.localStorage.getItem(STORAGE_KEY);
      return saved === 'light' || saved === 'dark' ? saved : null;
    } catch {
      return null;
    }
  }
}
