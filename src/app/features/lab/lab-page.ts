import { Component, signal } from '@angular/core';
import { FIBONACCI_SPACING, FLUID_SPACING } from '../../../design-system/scales.generated';

@Component({
  templateUrl: './lab-page.html',
  styleUrl: './lab-page.scss',
})
export class LabPage {
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
