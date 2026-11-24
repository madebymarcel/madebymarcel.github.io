import { Component, computed, signal } from '@angular/core';
import { FIBONACCI_SPACING, FLUID_SPACING } from '../../../design-system/scales.generated';
import { LAYOUT_CATEGORIES } from './layout-patterns';
import { LayoutPreview } from './layout-preview';

@Component({
  imports: [LayoutPreview],
  templateUrl: './lab-page.html',
  styleUrl: './lab-page.scss',
})
export class LabPage {
  readonly layoutCategories = LAYOUT_CATEGORIES;
  readonly selected = signal('foundations');
  readonly previewWidth = signal('fit');
  readonly widths = [
    { id: 'fit', label: 'Fit' },
    { id: 'medium', label: '480px' },
    { id: 'narrow', label: '320px' },
  ] as const;
  readonly selectedPattern = computed(() => {
    const patterns = this.layoutCategories.flatMap((category) => category.patterns);
    return patterns.find((pattern) => pattern.id === this.selected());
  });

  selectFromMenu(event: Event): void {
    this.selected.set((event.target as HTMLSelectElement).value);
  }

  readonly spacing = FIBONACCI_SPACING;
  readonly fluidSpacing = FLUID_SPACING;
  readonly colors = [
    { label: 'Background', token: '--background' },
    { label: 'Surface', token: '--surface' },
    { label: 'Text', token: '--text' },
    { label: 'Muted text', token: '--muted' },
    { label: 'Accent', token: '--accent' },
    { label: 'Control border', token: '--border-strong' },
    { label: 'Success', token: '--success' },
    { label: 'Warning', token: '--warning' },
    { label: 'Error', token: '--danger' },
  ] as const;
  readonly pressed = signal(false);
  readonly submitted = signal(false);

  onSubmit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
  }
}
