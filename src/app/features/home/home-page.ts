import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { startWaterShader } from './water-shader';

@Component({
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('waterCanvas');
  private readonly destroyRef = inject(DestroyRef);
  private disposeWater?: () => void;

  constructor() {
    // afterNextRender runs only in the browser, so static prerendering stays safe.
    afterNextRender(() => {
      const canvas = this.canvas()?.nativeElement;
      if (canvas) this.disposeWater = startWaterShader(canvas);
    });
    this.destroyRef.onDestroy(() => this.disposeWater?.());
  }
}
