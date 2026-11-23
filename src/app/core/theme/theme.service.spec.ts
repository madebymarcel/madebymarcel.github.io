import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  it('toggles from light to dark and back', () => {
    const theme = TestBed.inject(ThemeService);

    expect(theme.mode()).toBe('light');
    theme.toggle();
    expect(theme.mode()).toBe('dark');
    theme.toggle();
    expect(theme.mode()).toBe('light');
  });
});
