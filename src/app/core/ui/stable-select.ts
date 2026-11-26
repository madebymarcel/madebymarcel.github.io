import { Component, computed, input, output, signal } from '@angular/core';

interface SelectOption {
  id: string;
  label: string;
}

@Component({
  selector: 'app-stable-select',
  templateUrl: './stable-select.html',
  styleUrl: './stable-select.scss',
})
export class StableSelect {
  readonly controlId = input.required<string>();
  readonly label = input.required<string>();
  readonly options = input.required<readonly SelectOption[]>();
  readonly value = input.required<string>();
  readonly disabled = input(false);
  readonly valueChange = output<string>();

  readonly selectedLabel = computed(
    () => this.options().find((option) => option.id === this.value())?.label ?? '',
  );
  readonly snapshot = signal<readonly SelectOption[]>([]);
  readonly isOpen = signal(false);

  openPicker(dialog: HTMLDialogElement, list: HTMLUListElement): void {
    if (this.disabled() || dialog.open) return;
    // A native select can jump to its selected row when its options change on iOS.
    // Keep the displayed options independent of live updates until the picker closes.
    this.snapshot.set([...this.options()]);
    dialog.showModal();
    list.scrollTop = 0;
    this.isOpen.set(true);
  }

  choose(id: string, dialog: HTMLDialogElement): void {
    if (!this.disabled() && this.options().some((option) => option.id === id)) {
      this.valueChange.emit(id);
    }
    dialog.close();
  }

  closePicker(trigger: HTMLButtonElement): void {
    this.isOpen.set(false);
    this.snapshot.set([]);
    if (!trigger.disabled) trigger.focus({ preventScroll: true });
  }
}
