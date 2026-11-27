import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { StableSelect } from '../../core/ui/stable-select';
import { trial, type TrialOptions } from './spatial-learning.mjs';
import {
  completeWave,
  emptyCheckpoint,
  evaluationDeficit,
  LABELS,
  nextStage,
  parseCheckpoint,
  propose,
  qualifies,
  scenarios,
  seedFromEntry,
  selectSkill,
  skillProgress,
  STAGNATION,
  STAGES,
  trialChecks,
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
  readonly entryDeficit = (entry: Entry) => evaluationDeficit(entry.stage, entry.evaluation);
  readonly currentBest = computed(() => this.state().best[this.state().stage]);
  readonly best = computed(() => this.currentBest()?.policy ?? null);
  readonly progress = computed(() => skillProgress(this.state()));
  readonly pendingSkill = signal<Stage | null>(null);
  readonly chosenSkill = computed(() => this.pendingSkill() ?? this.state().stage);
  readonly followBest = signal(true);
  readonly panel = signal<'trials' | 'records' | 'history' | 'settings'>('trials');
  readonly panels = ['trials', 'records', 'history', 'settings'] as const;
  readonly panelLabels = {
    trials: 'Trials',
    records: 'Records',
    history: 'History',
    settings: 'Settings',
  };
  readonly trialIndex = signal(0);
  readonly trialRows = computed(() => {
    const stage = this.state().stage;
    const metrics = this.currentBest()?.evaluation.trials;
    return scenarios(stage).map((options, index) => {
      const result = metrics?.[index];
      const checks = result ? trialChecks(stage, result) : [];
      return {
        name: ['Normal', 'Slipperier', 'Grippier'][index],
        options,
        checks,
        passed: result ? checks.every((check) => check.passed) : undefined,
        failures: checks.filter((check) => !check.passed).length,
      };
    });
  });
  readonly inspection = computed(() => this.trialRows()[this.trialIndex()]);
  readonly deficit = computed(() => {
    const entry = this.currentBest();
    return entry ? evaluationDeficit(entry.stage, entry.evaluation) : undefined;
  });
  readonly trainingMessage = computed(() => {
    if (this.pendingSkill()) return 'Switching after the current batch.';
    const best = this.currentBest();
    const progress = this.progress();
    if (!best) return 'No policy evaluated for this skill yet.';
    if (best.evaluation.passes === 3)
      return this.training() ? 'Passed · refining policy' : 'All trials passed';
    if (progress.sinceImprovement >= STAGNATION) return 'Plateau detected · exploring new policies';
    if (!progress.attempts) return 'Restored policy · new search statistics begin on resume';
    if (progress.sinceImprovement === 0) return 'New best policy';
    return 'Searching for a better policy';
  });
  readonly history = computed(() =>
    this.state().history.filter((e) => e.stage === this.state().stage),
  );
  readonly historyOptions = computed(() => [
    { id: '0', label: 'Select checkpoint' },
    ...this.history().map((entry) => ({
      id: String(entry.iteration),
      label:
        '#' +
        entry.iteration +
        ' · ' +
        entry.evaluation.passes +
        '/3 · fitness ' +
        entry.evaluation.score.toFixed(2),
    })),
  ]);
  readonly selected = signal('0');
  readonly selectedEntry = computed(() =>
    this.history().find((entry) => String(entry.iteration) === this.selected()),
  );
  readonly replayLabel = signal('Initial pose');
  private lastAutoReplay = 0;
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
    this.lastAutoReplay = 0;
    this.runWave();
  }

  private runWave() {
    if (!this.training() || this.disposed) return;
    const before = this.state();
    const wave = propose(before, standing.policy, checkpoint.policy);
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
        const result = {
          ...completeWave(before, wave, evaluations),
          autoAdvance: this.state().autoAdvance ?? false,
        };
        const requested = this.pendingSkill();
        this.pendingSkill.set(null);
        const advanced = requested
          ? selectSkill(result, requested)
          : result.autoAdvance
            ? nextStage(result)
            : result;
        const passed = result.best[result.stage]?.evaluation.passes === 3;
        if (advanced.stage !== before.stage) {
          this.clearSkillView();
        } else if (
          passed &&
          !requested &&
          (result.autoAdvance || before.best[before.stage]?.evaluation.passes !== 3)
        ) {
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

  toggleAutoAdvance() {
    this.state.update((state) => ({ ...state, autoAdvance: !state.autoAdvance }));
    this.dirty = true;
    this.flush();
  }

  private clearSkillView() {
    this.stopReplay();
    this.selected.set('0');
    this.trialIndex.set(0);
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

  watchTrial(index: number) {
    const entry = this.currentBest();
    if (entry) {
      this.followBest.set(false);
      this.replayEntry(entry, index);
    }
  }

  stopWatching() {
    this.followBest.set(false);
    this.stopReplay();
  }

  replayEntry(entry: Entry, trialIndex = 0) {
    this.play(entry.policy, entry.stage, scenarios(entry.stage)[trialIndex], true);
    this.replayLabel.set(
      this.labels[entry.stage] +
        ' · ' +
        ['Normal', 'Slipperier', 'Grippier'][trialIndex] +
        ' · #' +
        entry.iteration,
    );
  }

  replayBest() {
    const entry = this.currentBest();
    if (entry) {
      this.followBest.set(false);
      this.replayEntry(entry);
    }
  }

  watchRecord(key: RecordKey) {
    const record = this.state().records[key];
    if (record) {
      this.followBest.set(false);
      this.replayEntry(record.entry, record.trialIndex);
    }
  }

  play(
    policy = checkpoint.policy,
    stage: Stage = 'walk',
    options: TrialOptions = { stage, seconds: 5 },
    learned = false,
  ) {
    this.stopReplay();
    if (!learned) this.followBest.set(false);
    this.replayLabel.set(
      learned ? this.labels[stage] : 'Historical ' + this.labels[stage] + ' demo',
    );
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
          ' steps · ' +
          m.flights +
          ' strides · ' +
          (m.ticks / 120).toFixed(2) +
          ' s' +
          (m.fell
            ? ' · Fell'
            : run.done
              ? learned && qualifies(stage, m)
                ? ' · Trial passed'
                : learned
                  ? ' · Trial failed'
                  : ' · Demo complete'
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
