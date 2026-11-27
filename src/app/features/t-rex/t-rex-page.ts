import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { StableSelect } from '../../core/ui/stable-select';
import { trial } from './servo-learning.mjs';
import { neutralPolicy } from './servo-rig.mjs';
import {
  completeWave, emptyCheckpoint, LABELS, LEGACY_KEY, optionsFor, parseCheckpoint, propose,
  seedFromEntry, selectSkill, skillState, STAGES, STORAGE_KEY, trialChecks,
  type Checkpoint, type Entry, type Evaluation, type Stage,
} from './servo-search.mjs';
import { project } from './rex-render';
import type { EvaluationRequest, EvaluationResponse } from './t-rex.worker';

@Component({
  imports: [DecimalPipe, StableSelect],
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
  readonly status = signal('Initial pose');
  readonly storageStatus = signal('Not loaded');
  readonly error = signal('');
  readonly distance = signal(0);
  readonly candidatesPerSecond = signal(0);
  readonly stepsPerSecond = signal(0);
  readonly cores = signal(0);
  readonly stages = STAGES;
  readonly labels = LABELS;
  readonly legacyAvailable = signal(false);
  readonly progress = computed(() => skillState(this.state()));
  readonly currentBest = computed(() => this.progress().best);
  readonly best = computed(() => this.currentBest()?.policy ?? null);
  readonly pendingSkill = signal<Stage | null>(null);
  readonly chosenSkill = computed(() => this.pendingSkill() ?? this.state().stage);
  readonly followBest = signal(true);
  readonly detailsOpen = signal(false);
  readonly history = computed(() => this.progress().history);
  readonly historyOptions = computed(() => [
    { id: '0', label: 'Select checkpoint' },
    ...this.history().map((entry) => ({
      id: String(entry.iteration),
      label: '#' + entry.iteration + ' · reward ' + entry.evaluation.metrics.score.toFixed(2),
    })),
  ]);
  readonly selected = signal('0');
  readonly selectedEntry = computed(() =>
    this.history().find((entry) => String(entry.iteration) === this.selected()),
  );
  readonly checks = computed(() => {
    const best = this.currentBest();
    return best ? trialChecks(best.stage, best.evaluation.metrics) : [];
  });
  readonly headline = computed(() => {
    const stage = this.state().stage;
    const m = this.currentBest()?.evaluation.metrics;
    const item = (label: string, value: number, unit = '', digits = '1.0-0') => ({ label, value, unit, digits });
    const upright = item('Upright', (m?.stableTicks ?? 0) / 120, 's', '1.1-1');
    if (stage === 'balance' || stage === 'recover') {
      return [upright, item('Settled', (m?.settledTicks ?? 0) / 120, 's', '1.1-1'),
        item('Drift', m?.pathDistance ?? 0, 'm', '1.2-2')];
    }
    if (stage === 'shift') {
      return [item('Weight transfer', (m?.shiftTicks ?? 0) / 120, 's', '1.1-1'),
        item('Foot lifts', m?.lifts ?? 0), upright];
    }
    if (stage === 'run') {
      return [item('Speed', m?.averageSpeed ?? 0, 'm/s', '1.2-2'),
        item('Steps', m?.steps ?? 0), upright];
    }
    return [item('Steps', m?.steps ?? 0), item('Distance', m?.distance ?? 0, 'm', '1.2-2'), upright];
  });
  readonly graph = computed(() => {
    const history = [...this.history()].reverse();
    const values = history.map((entry) => entry.evaluation.metrics.score);
    if (!values.length) return null;
    const low = Math.min(...values), high = Math.max(...values);
    const span = Math.max(0.001, high - low);
    const first = history[0].skillAttempt;
    const last = Math.max(first + 1, this.progress().attempts);
    const x = (iteration: number) => 4 + 312 * (iteration - first) / (last - first);
    const y = (score: number) => 74 - 64 * (score - low) / span;
    const path = history.map((entry, i) =>
      i === 0 ? 'M ' + x(entry.skillAttempt) + ' ' + y(values[i]) :
        'H ' + x(entry.skillAttempt) + ' V ' + y(values[i]),
    ).join(' ') + ' H 316';
    return { path, low, high, latest: values[values.length - 1], first };
  });
  readonly trainingMessage = computed(() => {
    if (this.pendingSkill()) return 'Switching after the current batch';
    const best = this.currentBest();
    if (!best) return this.training() ? 'Evaluating first candidates' : 'Ready to train';
    if (best.evaluation.passed) return 'Normal-ground goal reached';
    if (this.training()) return this.progress().sinceImprovement >= 240 ? 'No recent improvement' : 'Learning';
    return 'Paused · goal not reached';
  });
  readonly replayLabel = signal('Initial pose');
  private lastAutoReplay = 0;
  private readonly initialFrame = trial(neutralPolicy()).rig.frame();
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
        this.legacyAvailable.set(Boolean(localStorage.getItem(LEGACY_KEY)));
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
    this.pendingSkill.set(null);
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
    this.followBest.set(true);
    this.rateStart = performance.now();
    this.rateCount = 0;
    this.rateSteps = 0;
    this.lastAutoReplay = 0;
    this.runWave();
  }

  private runWave() {
    if (!this.training() || this.disposed) return;
    const before = this.state();
    const wave = propose(before);
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
        const requested = this.pendingSkill();
        this.pendingSkill.set(null);
        const advanced = requested ? selectSkill(result, requested) : result;
        if (advanced.stage !== before.stage) {
          this.clearSkillView();
        } else if (!skillState(before).best?.evaluation.passed && skillState(result).best?.evaluation.passed) {
          this.training.set(false);
        }
        this.state.set(advanced);
        this.dirty = true;
        const entry = this.currentBest();
        if (
          this.followBest() &&
          !this.playing() &&
          entry &&
          entry.iteration !== this.lastAutoReplay
        ) {
          this.lastAutoReplay = entry.iteration;
          this.replayEntry(entry);
        }
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
        if (requested || !this.training() || performance.now() - this.lastSave >= 2000) this.flush();
        this.busy.set(false);
        if (this.training()) this.timer = setTimeout(() => this.runWave(), 0);
      });
      const message: EvaluationRequest = { id, stage: before.stage, candidates };
      this.workers[index].postMessage(message);
    });
  }

  exportTraining() {
    this.flush();
    this.download(JSON.stringify(this.state(), null, 2), 'trex-training-' + this.state().iteration + '.json');
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
      this.clearSkillView();
      this.error.set('');
      this.flush();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not import checkpoint.');
    }
  }

  resetTraining() {
    if (this.training() || this.busy() || !window.confirm('Delete local dinosaur training?'))
      return;
    this.pendingSkill.set(null);
    this.state.set(emptyCheckpoint());
    this.dirty = true;
    this.clearSkillView();
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

  chooseSkill(event: Event) {
    const stage = (event.target as HTMLSelectElement).value as Stage;
    if (!STAGES.includes(stage)) return;
    if (this.busy()) {
      this.pendingSkill.set(stage);
      return;
    }
    this.state.update((state) => selectSkill(state, stage));
    this.clearSkillView();
    this.dirty = true;
    this.flush();
  }

  private clearSkillView() {
    this.stopReplay();
    this.selected.set('0');
    this.lastAutoReplay = 0;
    this.replayLabel.set('Initial pose');
    this.status.set('Ready');
    this.distance.set(0);
    this.overhead.set(project(this.initialFrame, false));
    this.side.set(project(this.initialFrame, true));
  }

  resumeFrom(entry: Entry) {
    if (this.training() || this.busy()) return;
    this.state.update((old) => seedFromEntry(old, entry));
    this.clearSkillView();
    this.dirty = true;
    this.error.set('');
    this.flush();
  }

  stopWatching() {
    this.followBest.set(false);
    this.stopReplay();
  }

  replayEntry(entry: Entry) {
    this.play(entry.policy, entry.stage, 'Candidate #' + entry.iteration);
  }

  replayBest() {
    const entry = this.currentBest();
    if (entry) {
      this.followBest.set(false);
      this.replayEntry(entry);
    }
  }

  watchBaseline() {
    this.followBest.set(false);
    this.play(neutralPolicy(), this.state().stage, 'Untrained baseline');
  }

  exportLegacy() {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      this.download(raw, 'trex-legacy-torque-training.json');
    } catch {
      this.error.set('Legacy checkpoint could not be read.');
    }
  }

  private download(source: string, filename: string) {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  play(policy: number[], stage: Stage, label: string) {
    this.stopReplay();
    this.replayLabel.set(label);
    const run = trial(policy, optionsFor(stage));
    const draw = () => {
      const frame = run.rig.frame();
      this.overhead.set(project(frame, false));
      this.side.set(project(frame, true));
      const m = run.metrics();
      this.distance.set(m.distance);
      this.status.set(
        m.steps + ' steps · ' + m.distance.toFixed(2) + ' m · ' +
        (m.ticks / 120).toFixed(1) + ' s' +
        (m.fell ? ' · Fell' : run.done ? ' · Complete' : ''),
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
