import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { CONTROL_DT, JOINT_NAMES, OBSERVATIONS, ACTIONS, TRACK_GOAL, Walker } from './walker';
import { act, EVALUATION_STARTS, POLICY_SIZE, type Checkpoint } from './training';
import type { TrainingMessage, TrainingUpdate } from './biped.worker';

@Component({
  imports: [DecimalPipe],
  templateUrl: './biped-page.html',
  styleUrl: './biped-page.scss',
})
export class BipedPage {
  private readonly destroy = inject(DestroyRef);
  private worker?: Worker;
  private walker = new Walker(EVALUATION_STARTS[0]);
  private weights: ArrayLike<number> = new Float64Array(POLICY_SIZE);
  private readonly observation = new Float64Array(OBSERVATIONS);
  private readonly action = new Float64Array(ACTIONS);
  private animation?: number;
  private lastFrame?: number;
  private accumulator = 0;
  private epoch = 0;

  readonly ready = signal(false);
  readonly playing = signal(false);
  readonly running = signal(false);
  readonly latest = signal<Checkpoint | null>(null);
  readonly best = signal<Checkpoint | null>(null);
  readonly baseline = signal<Checkpoint | null>(null);
  readonly replayIteration = signal(0);
  readonly trialIndex = signal(0);
  readonly frame = signal(this.walker.frame());
  readonly distance = signal(0);
  readonly steps = signal(0);
  readonly finish = signal('');
  readonly showSensors = signal(false);
  readonly trainingError = signal('');
  readonly jointNames = JOINT_NAMES;
  readonly trackGoal = TRACK_GOAL;
  readonly trials = EVALUATION_STARTS;
  camera(frame = this.frame()) {
    return 0.95 - frame.torso.x;
  }

  constructor() {
    afterNextRender(() => {
      try {
        this.worker = new Worker(new URL('./biped.worker', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }: MessageEvent<TrainingUpdate>) => {
          if (data.epoch !== this.epoch) return;
          const current = data.checkpoint;
          this.ready.set(true);
          this.latest.set(current);
          if (current.iteration === 0) this.baseline.set(current);
          else {
            const best = this.best();
            if (
              !best ||
              current.evaluation.passes > best.evaluation.passes ||
              (current.evaluation.passes === best.evaluation.passes &&
                current.evaluation.medianDistance > best.evaluation.medianDistance)
            ) {
              this.best.set(current);
            }
          }
        };
        this.worker.onerror = () => this.failTraining();
        this.send({ type: 'reset', epoch: this.epoch });
      } catch {
        this.failTraining();
      }
    });
    this.destroy.onDestroy(() => {
      this.worker?.terminate();
      if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    });
  }

  private failTraining() {
    this.trainingError.set(
      'Background training is unavailable in this browser. You can still watch the baseline.',
    );
    this.running.set(false);
    this.ready.set(false);
    this.worker?.terminate();
    this.worker = undefined;
  }

  private send(message: TrainingMessage) {
    this.worker?.postMessage(message);
  }

  toggleTraining() {
    const start = !this.running();
    this.running.set(start);
    this.send({ type: start ? 'start' : 'pause' });
  }

  resetTraining() {
    this.running.set(false);
    this.latest.set(null);
    this.baseline.set(null);
    this.best.set(null);
    this.initReplay(new Float64Array(POLICY_SIZE), 0);
    this.ready.set(false);
    this.epoch++;
    this.send({ type: 'reset', epoch: this.epoch });
  }

  setTrial(event: Event) {
    const index = Number((event.target as HTMLSelectElement).value);
    if (!EVALUATION_STARTS[index]) return;
    this.trialIndex.set(index);
    this.initReplay(this.weights, this.replayIteration());
  }

  replay(which: 'baseline' | 'best') {
    const checkpoint = which === 'best' ? this.best() : null;
    this.initReplay(
      checkpoint?.policy ?? new Float64Array(POLICY_SIZE),
      checkpoint?.iteration ?? 0,
    );
    this.resume();
  }

  private initReplay(weights: ArrayLike<number>, iteration: number) {
    this.pause();
    this.weights = weights;
    this.walker = new Walker(EVALUATION_STARTS[this.trialIndex()]);
    this.replayIteration.set(iteration);
    this.frame.set(this.walker.frame());
    this.distance.set(0);
    this.steps.set(0);
    this.finish.set('');
  }

  togglePlayback() {
    if (this.playing()) this.pause();
    else this.resume();
  }

  private pause() {
    this.playing.set(false);
    if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    this.animation = undefined;
    this.lastFrame = undefined;
    this.accumulator = 0;
  }

  private resume() {
    if (this.walker.done || this.playing()) return;
    this.playing.set(true);
    this.animation = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.accumulator += Math.min(0.15, (now - (this.lastFrame ?? now)) / 1000);
    this.lastFrame = now;
    let advanced = false;
    while (!this.walker.done && this.accumulator >= CONTROL_DT) {
      this.accumulator -= CONTROL_DT;
      this.walker.step(act(this.walker.observe(this.observation), this.weights, this.action));
      advanced = true;
    }
    if (advanced) {
      this.frame.set(this.walker.frame());
      this.distance.set(this.walker.distance);
      this.steps.set(this.walker.steps);
    }
    if (this.walker.done) {
      this.finish.set(this.walker.fell ? 'Fell' : 'Run complete');
      this.pause();
      return;
    }
    this.animation = requestAnimationFrame(this.tick);
  };
}
