import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { trial, type Metrics } from './servo-learning.mjs';
import {
  completeWave,
  emptyCheckpoint,
  milestoneLabel,
  parseCheckpoint,
  propose,
  STORAGE_KEY,
  type Milestone,
} from './servo-search.mjs';
import { project } from './rex-render';
import type { EvaluationRequest, EvaluationResponse } from './t-rex.worker';

@Component({
  templateUrl: './t-rex-page.html',
  styleUrl: './t-rex-page.scss',
})
export class TRexPage {
  private readonly state = signal(emptyCheckpoint());
  readonly ready = signal(false);
  readonly training = signal(false);
  readonly notice = signal('');
  readonly error = signal('');
  readonly distance = signal(0);
  readonly cycle = signal(0);
  private readonly initialFrame = trial(this.state().best.policy).rig.frame();
  readonly overhead = signal(project(this.initialFrame, false));
  readonly side = signal(project(this.initialFrame, true));

  private workers: Worker[] = [];
  private pending = new Map<number, (response: EvaluationResponse) => void>();
  private requestId = 0;
  private animation?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor() {
    afterNextRender(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) this.state.set(parseCheckpoint(saved));
      } catch {
        this.error.set('Saved learning could not be restored.');
      }
      this.ready.set(true);
      window.addEventListener('pagehide', this.flush);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.replay();
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      if (this.ready()) {
        this.flush();
        window.removeEventListener('pagehide', this.flush);
        document.removeEventListener('visibilitychange', this.onVisibility);
      }
      this.stopTraining();
      clearTimeout(this.noticeTimer);
      if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    });
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') this.flush();
  };

  private readonly flush = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state()));
    } catch {
      this.error.set('Learning could not be saved locally.');
    }
  };

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
        const worker = new Worker(new URL('./t-rex.worker', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }: MessageEvent<EvaluationResponse>) => {
          const callback = this.pending.get(data.id);
          this.pending.delete(data.id);
          callback?.(data);
        };
        worker.onerror = () => this.fail('Training stopped. The last completed result is saved.');
        this.workers.push(worker);
      }
      this.training.set(true);
      this.runWave();
    } catch {
      this.fail('Background training is unavailable in this browser.');
    }
  }

  private runWave() {
    if (!this.training() || this.disposed) return;
    const before = this.state();
    const wave = propose(before);
    const evaluations: Metrics[] = [];
    const size = Math.ceil(wave.candidates.length / this.workers.length);
    const chunks = [];
    for (let offset = 0; offset < wave.candidates.length; offset += size) {
      chunks.push({ offset, candidates: wave.candidates.slice(offset, offset + size) });
    }
    let remaining = chunks.length;
    chunks.forEach(({ offset, candidates }, index) => {
      const id = ++this.requestId;
      this.pending.set(id, (response) => {
        if (this.disposed || !this.training()) return;
        response.evaluations.forEach((metrics, i) => {
          evaluations[offset + i] = metrics;
        });
        if (--remaining) return;
        try {
          const next = completeWave(before, wave, evaluations);
          this.state.set(next);
          this.flush();
          const gained = (Object.keys(next.records) as Milestone[]).filter(
            (key) => !before.records[key],
          );
          if (gained.length) this.announce(gained.map(milestoneLabel).join(' · '));
          if (this.training()) this.timer = setTimeout(() => this.runWave(), 0);
        } catch {
          this.fail('A training batch could not be completed.');
        }
      });
      const message: EvaluationRequest = { id, candidates };
      this.workers[index].postMessage(message);
    });
  }

  private announce(message: string) {
    this.notice.set(message);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.set(''), 3500);
  }

  // Each episode captures one policy. Training and pause never interrupt playback.
  // Only the next episode uses a newly retained best policy.
  private replay() {
    if (this.disposed) return;
    const run = trial(this.state().best.policy);
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
        while (!run.done && accumulator >= 1 / 120) {
          run.advance();
          accumulator -= 1 / 120;
        }
        draw();
      }
      last = now;
      this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }
}
