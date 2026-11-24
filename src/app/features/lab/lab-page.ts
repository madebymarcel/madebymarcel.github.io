import { Component, signal } from '@angular/core';

@Component({
  templateUrl: './lab-page.html',
  styleUrl: './lab-page.scss',
})
export class LabPage {
  readonly spacing = [3, 5, 8, 13, 21, 34, 55, 89];
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
