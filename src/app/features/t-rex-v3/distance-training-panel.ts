import { Component, computed, signal } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { ACTIONS, OBSERVATIONS } from './balance-environment';
import type { Checkpoint, TrainingFrame } from './distance-training';
import type { TrainingRequest, TrainingResponse } from './distance-training.worker';
import { projectRig, viewBox } from './rig';
import type { RolloutJob, RolloutResult } from './rollout-collection';
import type { RolloutResponse } from './rollout.worker';

interface Collection {
  readonly round: number;
  readonly results: (RolloutResult | undefined)[];
  readonly attempts: number[];
}

@Component({
  selector: 'app-t-rex-training',
  templateUrl: './distance-training-panel.html',
  styleUrl: './t-rex-v3-page.css',
})
export class DistanceTrainingPanel implements OnDestroy {
  private worker: Worker | null = null;
  private pool: Worker[] = [];
  private collection: Collection | null = null;
  private destroyed = false;
  private timer: number | null = null;
  protected readonly frame = signal<TrainingFrame | null>(null);
  protected readonly running = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly seed = signal(37);
  protected readonly horizon = signal(30);
  protected readonly lanes = signal(4);
  protected readonly collectingActions = signal(0);
  protected readonly actionCount = ACTIONS.length;
  protected readonly observationCount = OBSERVATIONS.length;
  protected readonly projection = computed(() => {
    const frame = this.frame();
    if (!frame?.snapshot.valid) return null;
    const shapes = projectRig(frame.snapshot.pose, 'side');
    return { shapes, box: viewBox(shapes, 'side') };
  });

  protected setSeed(value: string): void {
    this.seed.set(Number(value));
  }

  protected setHorizon(value: string): void {
    this.horizon.set(Number(value));
  }

  protected setLanes(value: string): void {
    this.lanes.set(Math.max(1, Math.min(4, Math.round(Number(value) || 1))));
  }

  protected distance(value: number | null): string {
    return value === null ? 'Not measured' : value.toFixed(3) + ' m';
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') throw new Error('Web Workers are required for training');
    const worker = new Worker(new URL('./distance-training.worker', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<TrainingResponse>) => {
      if (this.worker !== worker || this.destroyed) return;
      if (data.type === 'collect') {
        if (this.running()) {
          this.startCollection(data.jobs);
        } else {
          this.send({ type: 'cancel-round', round: data.jobs[0].round });
        }
        return;
      }
      this.busy.set(false);
      if (data.type === 'error') {
        this.fail(data.message);
      } else if (data.type === 'checkpoint') {
        this.download(data.checkpoint);
      } else {
        this.frame.set(data.frame);
        if (
          data.frame.phase === 'blocked' ||
          (data.frame.phase === 'replay' && data.frame.reason !== 'running')
        ) {
          this.pause();
        }
        this.schedule();
      }
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      worker.terminate();
      this.worker = null;
      this.collection = null;
      this.stopPool();
      this.fail(event.message || 'Training worker failed');
    };
    return worker;
  }

  private stopPool(): void {
    for (const worker of this.pool) worker.terminate();
    this.pool = [];
    this.collectingActions.set(0);
  }

  private startCollection(jobs: readonly RolloutJob[]): void {
    const collection: Collection = {
      round: jobs[0].round,
      results: jobs.map(() => undefined),
      attempts: jobs.map(() => 0),
    };
    this.collection = collection;
    this.collectingActions.set(0);
    try {
      if (this.pool.length !== jobs.length) {
        this.stopPool();
        for (let i = 0; i < jobs.length; i++) {
          this.pool.push(new Worker(new URL('./rollout.worker', import.meta.url), { type: 'module' }));
        }
      }
      jobs.forEach((job, lane) => {
        const worker = this.pool[lane];
        worker.onmessage = ({ data }: MessageEvent<RolloutResponse>) => {
          if (this.collection !== collection || this.destroyed) return;
          if (data.type === 'error') {
            this.fail(data.message);
            return;
          }
          const event = data.type === 'progress' ? data.progress : data.result;
          if (event.round !== collection.round || event.lane !== lane) return;
          collection.attempts[lane] = event.attempts;
          this.collectingActions.set(collection.attempts.reduce((sum, count) => sum + count, 0));
          if (lane === 0) {
            const frame = this.frame();
            if (frame) this.frame.set({ ...frame, ...event.view });
          }
          if (data.type === 'result') {
            collection.results[lane] = data.result;
            const results = collection.results.filter(
              (result): result is RolloutResult => result !== undefined,
            );
            if (results.length === jobs.length) {
              this.collection = null;
              this.collectingActions.set(0);
              this.send({ type: 'finish-round', results });
            }
          }
        };
        worker.onerror = (event) => {
          if (this.collection === collection) this.fail(event.message || 'Rollout worker failed');
        };
        worker.postMessage(job);
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private send(message: TrainingRequest): void {
    this.busy.set(true);
    try {
      this.ensureWorker().postMessage(message);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private schedule(): void {
    if (!this.running() || this.busy() || this.timer !== null) return;
    const replay = this.frame()?.phase === 'replay';
    this.timer = window.setTimeout(
      () => {
        this.timer = null;
        if (this.running() && !this.busy()) {
          this.send({ type: 'advance', count: replay ? 1 : 8, lanes: this.lanes() });
        }
      },
      replay ? 1000 / 30 : 0,
    );
  }

  private fail(message: string): void {
    const canceling = this.collection !== null && this.worker !== null;
    this.pause();
    if (!canceling) this.busy.set(false);
    this.error.set(message);
  }

  protected start(): void {
    if (this.busy() || this.running()) return;
    this.error.set('');
    this.running.set(true);
    this.send({ type: 'start', seed: this.seed(), horizon: this.horizon() });
  }

  protected pause(): void {
    this.running.set(false);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const collection = this.collection;
    if (collection) {
      this.collection = null;
      this.stopPool();
      if (this.worker && !this.destroyed) {
        this.send({ type: 'cancel-round', round: collection.round });
      }
    }
  }

  protected resume(): void {
    if (this.busy() || this.running() || !this.frame() || !this.worker) return;
    this.error.set('');
    this.running.set(true);
    this.send({ type: 'train' });
  }

  protected replayBest(): void {
    if (this.busy() || this.running() || !this.worker) return;
    this.error.set('');
    this.running.set(true);
    this.send({ type: 'replay' });
  }

  protected continueReplay(): void {
    if (
      this.busy() ||
      this.running() ||
      this.frame()?.phase !== 'replay' ||
      this.frame()?.reason !== 'running' ||
      !this.worker
    )
      return;
    this.running.set(true);
    this.schedule();
  }

  protected save(): void {
    if (!this.running() && !this.busy() && this.worker) this.send({ type: 'export' });
  }

  protected async load(file: File | null): Promise<void> {
    if (!file || this.running() || this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    try {
      if (file.size > 20_000_000) throw new Error('Checkpoint is too large');
      const checkpoint: unknown = JSON.parse(await file.text());
      this.send({ type: 'import', checkpoint });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private download(checkpoint: Checkpoint): void {
    const blob = new Blob([JSON.stringify(checkpoint)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'trex-v3-distance-' + checkpoint.stats.updates + '.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.pause();
    this.stopPool();
    this.worker?.terminate();
    this.worker = null;
  }
}
