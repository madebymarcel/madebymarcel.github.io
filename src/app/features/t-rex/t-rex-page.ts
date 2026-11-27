import { Component, DestroyRef, inject, signal } from '@angular/core';
import { trial, type Segment } from './spatial-learning.mjs';
import checkpoint from './spatial-checkpoint.json';

function project(bones: Segment[], side: boolean) {
  const origin = bones[0].start;
  const position = (p: Segment['start']) =>
    side
      ? [220 + (p.x - origin.x) * 90, 171 - p.y * 99]
      : [210 + p.z * 145, 285 - (p.x - origin.x) * 145];
  const layer = (name: string) =>
    name.startsWith('thigh') ? 1 : /shin|metatarsus|toes/.test(name) ? 0 : 2;
  return [...bones]
    .sort((a, b) => layer(a.name) - layer(b.name))
    .map((b) => ({
      name: b.name,
      outline: 'M ' + b.outline.map((p) => position(p).join(' ')).join(' L ') + ' Z',
      d: 'M ' + position(b.start).join(' ') + ' L ' + position(b.end).join(' '),
      width: side ? b.depth * 99 : b.width * 145,
      fill: ['#596d54', '#839a68', '#617e53'][layer(b.name)],
    }));
}

@Component({ templateUrl: './t-rex-page.html', styleUrl: './t-rex-page.scss' })
export class TRexPage {
  readonly best = signal<number[] | null>(null);
  readonly iteration = signal(0);
  readonly training = signal(false);
  readonly playing = signal(false);
  readonly status = signal('');
  readonly overhead = signal<ReturnType<typeof project>>([]);
  readonly side = signal<ReturnType<typeof project>>([]);
  private worker?: Worker;
  private timer?: ReturnType<typeof setInterval>;
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopReplay();
      this.worker?.terminate();
    });
  }
  toggleTraining() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./t-rex.worker', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        this.best.set(data.policy);
        this.iteration.set(data.iteration);
      };
      this.worker.onerror = () => {
        this.training.set(false);
        this.status.set('Training worker stopped.');
      };
    }
    this.training.update((v) => !v);
    this.worker.postMessage(this.training() ? 'start' : 'pause');
  }
  play(policy = checkpoint.policy) {
    this.stopReplay();
    const run = trial(policy);
    const draw = () => {
      const frame = run.rig.frame();
      this.overhead.set(project(frame, false));
      this.side.set(project(frame, true));
      const m = run.metrics();
      this.status.set(
        m.distance.toFixed(2) +
          ' m · ' +
          m.steps +
          ' alternating steps · ' +
          (m.ticks / 120).toFixed(2) +
          ' s' +
          (m.fell ? ' · Fell' : ''),
      );
    };
    draw();
    this.playing.set(true);
    this.timer = setInterval(() => {
      for (let i = 0; i < 4 && !run.done; i++) run.advance();
      draw();
      if (run.done) this.stopReplay();
    }, 1000 / 30);
  }
  stopReplay() {
    clearInterval(this.timer);
    this.playing.set(false);
  }
}
