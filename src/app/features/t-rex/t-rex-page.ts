import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { trial, type TrialOptions } from './spatial-learning.mjs';
import {
  completeWave,
  emptyCheckpoint,
  LABELS,
  nextStage,
  parseCheckpoint,
  propose,
  qualifies,
  scenarios,
  STAGES,
  STORAGE_KEY,
  type Checkpoint,
  type Entry,
  type Evaluation,
  type RecordKey,
  type Stage,
} from './curriculum.mjs';
import { project } from './rex-render';
import type { EvaluationRequest, EvaluationResponse } from './t-rex.worker';
import checkpoint from './spatial-checkpoint.json';
import standing from './spatial-standing.json';

const RECORDS: { key: RecordKey; name: string; unit: string }[] = [
  { key: 'distance', name: 'Farthest forward', unit: 'm' },
  { key: 'path', name: 'Longest path', unit: 'm' },
  { key: 'upright', name: 'Longest without falling', unit: 's' },
  { key: 'steps', name: 'Alternating steps', unit: '' },
  { key: 'speed', name: 'Best completed trial speed', unit: 'm/s' },
  { key: 'flights', name: 'Alternating airborne strides', unit: '' },
];

@Component({
  imports: [DecimalPipe],
  templateUrl: './t-rex-page.html',
  styleUrl: './t-rex-page.scss',
})
export class TRexPage {
  readonly state = signal<Checkpoint>(emptyCheckpoint());
  readonly ready = signal(false);
  readonly training = signal(false);
  readonly busy = signal(false);
  readonly playing = signal(false);
  readonly debug = signal(false);
  readonly status = signal('Ready');
  readonly storageStatus = signal('Not loaded');
  readonly error = signal('');
  readonly distance = signal(0);
  readonly candidatesPerSecond = signal(0);
  readonly stepsPerSecond = signal(0);
  readonly cores = signal(0);
  readonly stages = STAGES;
  readonly labels = LABELS;
  readonly records = RECORDS;
  readonly currentBest = computed(() => this.state().best[this.state().stage]);
  readonly bestEntry = computed(() => {
    const state = this.state();
    return (
      this.currentBest() ??
      [...STAGES]
        .reverse()
        .map((stage) => state.best[stage])
        .find(Boolean)
    );
  });
  readonly best = computed(() => this.bestEntry()?.policy ?? null);
  readonly history = computed(() => this.state().history);
  readonly selected = signal(0);
  readonly selectedEntry = computed(() =>
    this.history().find((entry) => entry.iteration === this.selected()),
  );
  readonly standingPolicy = standing.policy;
  private readonly initialFrame = trial(standing.policy).rig.frame();
  readonly overhead = signal(project(this.initialFrame, false));
  readonly side = signal(project(this.initialFrame, true));
  private workers: Worker[] = [];
  private animation?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Map<number, (data: EvaluationResponse) => void>();
  private requestId = 0;
  private disposed = false;
  private dirty = false;
  private lastSave = 0;
  private rateStart = 0;
  private rateCount = 0;
  private rateSteps = 0;

  constructor() {
    afterNextRender(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) this.state.set(parseCheckpoint(saved));
        this.storageStatus.set(saved ? 'Restored local checkpoint' : 'Ready to save locally');
      } catch {
        this.storageStatus.set('Local checkpoint could not be restored');
        this.error.set('Storage is unavailable or the saved checkpoint is incompatible.');
      }
      this.ready.set(true);
      window.addEventListener('pagehide', this.flush);
      document.addEventListener('visibilitychange', this.onVisibility);
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      if (this.ready()) {
        this.flush();
        window.removeEventListener('pagehide', this.flush);
        document.removeEventListener('visibilitychange', this.onVisibility);
      }
      this.stopReplay();
      clearTimeout(this.timer);
      this.stopWorkers();
    });
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') this.flush();
  };

  private readonly flush = () => {
    if (!this.dirty) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state()));
      this.storageStatus.set('Saved locally');
      this.lastSave = performance.now();
      this.dirty = false;
    } catch {
      this.storageStatus.set('Local save failed; export a checkpoint instead');
    }
  };

  private makeWorkers() {
    const count = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));
    try {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./t-rex.worker', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }: MessageEvent<EvaluationResponse>) => {
          this.pending.get(data.id)?.(data);
          this.pending.delete(data.id);
        };
        worker.onerror = () =>
          this.fail('Training worker failed. Your last completed wave is safe.');
        this.workers.push(worker);
      }
      this.cores.set(this.workers.length);
    } catch {
      this.fail('Background training is unavailable in this browser.');
    }
  }

  private stopWorkers() {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.pending.clear();
    this.cores.set(0);
  }

  private fail(message: string) {
    this.error.set(message);
    this.training.set(false);
    this.busy.set(false);
    clearTimeout(this.timer);
    this.stopWorkers();
    this.flush();
  }

  toggleTraining() {
    if (this.training()) {
      this.training.set(false);
      clearTimeout(this.timer);
      if (!this.busy()) this.flush();
      return;
    }
    if (!this.ready() || this.busy()) return;
    this.error.set('');
    if (!this.workers.length) this.makeWorkers();
    if (!this.workers.length) return;
    this.training.set(true);
    this.rateStart = performance.now();
    this.rateCount = 0;
    this.rateSteps = 0;
    this.runWave();
  }

  private runWave() {
    if (!this.training() || this.disposed) return;
    const before = this.state();
    const wave = propose(before, standing.policy);
    const evaluations: Evaluation[] = [];
    const size = Math.ceil(wave.candidates.length / this.workers.length);
    const chunks = [];
    for (let offset = 0; offset < wave.candidates.length; offset += size) {
      chunks.push({ offset, candidates: wave.candidates.slice(offset, offset + size) });
    }
    this.busy.set(true);
    let remaining = chunks.length;
    chunks.forEach(({ offset, candidates }, index) => {
      const id = ++this.requestId;
      this.pending.set(id, (response) => {
        if (this.disposed) return;
        response.evaluations.forEach((evaluation, i) => {
          evaluations[offset + i] = evaluation;
        });
        if (--remaining) return;
        const result = completeWave(before, wave, evaluations);
        this.state.set(nextStage(result));
        this.dirty = true;
        this.rateCount += result.iteration - before.iteration;
        this.rateSteps += result.physicsSteps - before.physicsSteps;
        const elapsed = (performance.now() - this.rateStart) / 1000;
        if (elapsed >= 0.5 || !this.training()) {
          this.candidatesPerSecond.set(this.rateCount / Math.max(0.001, elapsed));
          this.stepsPerSecond.set(this.rateSteps / Math.max(0.001, elapsed));
          this.rateStart = performance.now();
          this.rateCount = 0;
          this.rateSteps = 0;
        }
        if (!this.training() || performance.now() - this.lastSave >= 2000) this.flush();
        this.busy.set(false);
        if (this.training()) this.timer = setTimeout(() => this.runWave(), 0);
      });
      const message: EvaluationRequest = { id, stage: before.stage, candidates };
      this.workers[index].postMessage(message);
    });
  }

  exportTraining() {
    this.flush();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(this.state(), null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'trex-training-' + this.state().iteration + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async importTraining(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.training() || this.busy()) return;
    try {
      if (file.size > 4_000_000) throw new Error('Checkpoint exceeds 4 MB.');
      const restored = parseCheckpoint(await file.text());
      if (this.disposed || this.training() || this.busy()) return;
      this.state.set(restored);
      this.dirty = true;
      this.selected.set(0);
      this.error.set('');
      this.flush();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not import checkpoint.');
    }
  }

  resetTraining() {
    if (this.training() || this.busy() || !window.confirm('Delete local dinosaur training?'))
      return;
    this.state.set(emptyCheckpoint());
    this.dirty = true;
    this.selected.set(0);
    this.candidatesPerSecond.set(0);
    this.stepsPerSecond.set(0);
    this.error.set('');
    try {
      localStorage.removeItem(STORAGE_KEY);
      this.dirty = false;
      this.storageStatus.set('Training reset');
    } catch {
      this.storageStatus.set('Could not delete local checkpoint');
    }
  }

  selectHistory(event: Event) {
    this.selected.set(Number((event.target as HTMLSelectElement).value));
  }

  resumeFrom(entry: Entry) {
    if (this.training() || this.busy()) return;
    const best = { ...this.state().best };
    if (
      STAGES.slice(0, STAGES.indexOf(entry.stage)).some(
        (stage) => best[stage]?.evaluation.passes !== 3,
      )
    ) {
      this.error.set('Complete the preceding skills before resuming this policy.');
      return;
    }
    for (const stage of STAGES.slice(STAGES.indexOf(entry.stage) + 1)) delete best[stage];
    best[entry.stage] = entry;
    this.state.update((old) => ({ ...old, stage: entry.stage, best }));
    this.dirty = true;
    this.error.set('');
    this.flush();
  }

  replayEntry(entry: Entry, trialIndex = 0) {
    this.play(entry.policy, entry.stage, scenarios(entry.stage)[trialIndex], true);
  }

  replayBest() {
    const entry = this.bestEntry();
    if (entry) this.replayEntry(entry);
  }

  watchRecord(key: RecordKey) {
    const record = this.state().records[key];
    if (record) this.replayEntry(record.entry, record.trialIndex);
  }

  play(
    policy = checkpoint.policy,
    stage: Stage = 'walk',
    options: TrialOptions = { stage, seconds: 5 },
    learned = false,
  ) {
    this.stopReplay();
    const run = trial(policy, options);
    const draw = () => {
      const frame = run.rig.frame();
      this.overhead.set(project(frame, false));
      this.side.set(project(frame, true));
      const m = run.metrics();
      this.distance.set(m.distance);
      this.status.set(
        m.distance.toFixed(2) +
          ' m · ' +
          m.steps +
          ' alternating steps · ' +
          m.flights +
          ' airborne strides · ' +
          (m.ticks / 120).toFixed(2) +
          ' s' +
          (m.fell
            ? ' · Fell'
            : run.done
              ? learned && qualifies(stage, m)
                ? ' · Trial passed'
                : ' · Trial complete'
              : ''),
      );
    };
    draw();
    this.playing.set(true);
    let last = 0;
    let accumulator = 0;
    const tick = (now: number) => {
      accumulator += Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      while (!run.done && accumulator >= 1 / 120) {
        run.advance();
        accumulator -= 1 / 120;
      }
      draw();
      if (run.done) this.stopReplay();
      else this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }

  stopReplay() {
    if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    this.animation = undefined;
    this.playing.set(false);
  }
}
