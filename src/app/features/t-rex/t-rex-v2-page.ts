import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { DT, trial, type Mode } from './v2-learning.mjs';
import {
  TEST_STARTS,
  advanceWeights,
  emptyCheckpoint,
  parseCheckpoint,
  propose,
  recordEvaluation,
  storageKey,
} from './v2-search.mjs';
import { project } from './rex-render';
import type { Request, Response } from './t-rex-v2.worker';

@Component({
  templateUrl: './t-rex-v2-page.html',
  styleUrl: './t-rex-page.scss',
})
export class TRexV2Page {
  private readonly state = signal(emptyCheckpoint('planar'));
  readonly mode = computed(() => this.state().mode);
  readonly iterations = computed(() => this.state().iteration);
  readonly rollouts = computed(() => this.state().rollouts + this.state().evaluationRollouts);
  readonly ready = signal(false);
  readonly training = signal(false);
  readonly error = signal('');
  readonly notice = computed(() => {
    const best = this.state().best;
    if (!best) return 'Untrained policy';
    const { evaluation } = best;
    return (
      'Best: ' +
      evaluation.medianDistance.toFixed(2) +
      ' m median · ' +
      evaluation.passes +
      '/' +
      TEST_STARTS.length +
      ' qualified trials'
    );
  });
  readonly distance = signal(0);
  readonly cycle = signal(0);
  private readonly initialFrame = trial(this.state().weights, this.mode()).rig.frame();
  readonly overhead = signal(project(this.initialFrame, false));
  readonly side = signal(project(this.initialFrame, true));
  private workers: Worker[] = [];
  private pending = new Map<number, (response: Response) => void>();
  private requestId = 0;
  private animation?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor() {
    afterNextRender(() => {
      this.restore('planar');
      this.ready.set(true);
      window.addEventListener('pagehide', this.flush);
      document.addEventListener('visibilitychange', this.flush);
      this.replay();
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      this.stopTraining();
      if (this.ready()) {
        this.flush();
        window.removeEventListener('pagehide', this.flush);
        document.removeEventListener('visibilitychange', this.flush);
      }
      if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    });
  }

  private restore(mode: Mode) {
    this.state.set(emptyCheckpoint(mode));
    try {
      const saved = localStorage.getItem(storageKey(mode));
      if (saved) this.state.set(parseCheckpoint(saved, mode));
    } catch {
      this.error.set('Saved V2 learning could not be restored.');
    }
  }

  private readonly flush = () => {
    try {
      localStorage.setItem(storageKey(this.mode()), JSON.stringify(this.state()));
    } catch {
      this.error.set('V2 learning could not be saved locally.');
    }
  };

  selectMode(mode: Mode) {
    if (!this.ready() || mode === this.mode()) return;
    this.stopTraining();
    this.flush();
    this.error.set('');
    this.restore(mode);
    if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    this.replay();
  }

  private stopTraining() {
    this.training.set(false);
    clearTimeout(this.timer);
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.pending.clear();
  }

  private fail(message: string) {
    this.stopTraining();
    this.error.set(message);
    this.flush();
  }

  private send(worker: Worker, message: Request, callback: (response: Response) => void) {
    this.pending.set(message.id, callback);
    worker.postMessage(message);
  }

  toggleTraining() {
    if (this.training()) {
      this.stopTraining();
      this.flush();
      return;
    }
    if (!this.ready() || this.disposed) return;
    this.error.set('');
    try {
      const count = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./t-rex-v2.worker', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }: MessageEvent<Response>) => {
          const callback = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (!callback || !this.training()) return;
          if ('error' in data) this.fail(data.error);
          else callback(data);
        };
        worker.onerror = () => this.fail('Training stopped. The last completed update is saved.');
        this.workers.push(worker);
      }
      this.training.set(true);
      if (this.state().best) this.runWave();
      else this.evaluateCentre(this.state());
    } catch {
      this.fail('Background training is unavailable in this browser.');
    }
  }

  private evaluateCentre(next: ReturnType<typeof emptyCheckpoint>) {
    this.send(
      this.workers[0],
      { id: ++this.requestId, mode: next.mode, policy: next.weights },
      (response) => {
        if (!('evaluation' in response)) return this.fail('Invalid evaluation response.');
        this.state.set(recordEvaluation(next, response.evaluation));
        this.flush();
        if (this.training()) this.timer = setTimeout(() => this.runWave(), 0);
      },
    );
  }

  private runWave() {
    if (!this.training() || this.disposed) return;
    const before = this.state();
    const wave = propose(before);
    const rewards: number[] = [];
    const size = Math.ceil(wave.policies.length / this.workers.length);
    let remaining = Math.ceil(wave.policies.length / size);
    for (let offset = 0, index = 0; offset < wave.policies.length; offset += size, index++) {
      const startIndex = offset;
      this.send(
        this.workers[index],
        {
          id: ++this.requestId,
          mode: before.mode,
          policies: wave.policies.slice(offset, offset + size),
          start: wave.start,
        },
        (response) => {
          if (!('rewards' in response)) return this.fail('Invalid training response.');
          response.rewards.forEach((reward, i) => (rewards[startIndex + i] = reward));
          if (--remaining) return;
          try {
            this.evaluateCentre(advanceWeights(before, wave, rewards));
          } catch {
            this.fail('The learning update could not be completed.');
          }
        },
      );
    }
  }

  exportTraining() {
    const state = this.state();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'trex-v2-' + state.mode + '-' + state.iteration + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private replay() {
    if (this.disposed) return;
    const state = this.state();
    const run = trial(state.best?.policy ?? state.weights, state.mode, TEST_STARTS[0]);
    this.cycle.update((value) => value + 1);
    let last = 0;
    let accumulator = 0;
    let completed = 0;
    const draw = () => {
      const frame = run.rig.frame();
      this.overhead.set(project(frame, false));
      this.side.set(project(frame, true));
      this.distance.set(run.metrics().distance);
    };
    draw();
    const tick = (now: number) => {
      if (this.disposed) return;
      if (run.done) {
        if (!completed) completed = now;
        if (now - completed >= 350) {
          this.replay();
          return;
        }
      } else {
        accumulator += Math.min(0.1, (now - (last || now)) / 1000);
        while (!run.done && accumulator >= DT) {
          run.advance();
          accumulator -= DT;
        }
        draw();
      }
      last = now;
      this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }
}
