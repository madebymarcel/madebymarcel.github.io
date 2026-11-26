import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import {
  GENESIS,
  exportGenerations,
  importGenerations,
  mergeGenerations,
  type Generation,
} from './generations';
import { loadGenerations, saveGenerations } from './generation-store';
import {
  DT,
  HALF_TICKS,
  PITCH,
  RULESET,
  SHOT_TICKS,
  seededRandom,
  type MatchState,
  type Player,
} from './model';
import { sample } from './policy';
import { TRIALS, type Drill } from './skills-drills';
import { paddlePose } from './paddle';
import { CanoeMatch } from './simulation';
import { type TrainingProgress } from './training';
import { type TrainingMessage } from './training.worker';
import {
  DEFAULT_REWARDS,
  rewardMax,
  validRewardValue,
  type RewardKey,
  type TrainingRewards,
} from './training-rewards';

@Component({
  templateUrl: './canoe-polo-page.html',
  styleUrl: './canoe-polo-page.scss',
})
export class CanoePoloPage {
  readonly generations = signal<Generation[]>([GENESIS]);
  readonly generationQuery = signal('');
  readonly shownGenerations = computed(() => {
    const query = this.generationQuery().trim().toLowerCase();
    return query
      ? this.generations().filter(
          (g) => this.generationLabel(g).toLowerCase().includes(query) || g.id.includes(query),
        )
      : this.generations();
  });
  readonly blue = signal(GENESIS.id);
  readonly red = signal(GENESIS.id);
  readonly parent = signal(GENESIS.id);
  readonly match = signal<MatchState>(new CanoeMatch(1).state);
  readonly playing = signal(false);
  readonly speed = signal(1);
  readonly training = signal(false);
  readonly ready = signal(false);
  readonly pace = signal(30);
  readonly rewards = signal<TrainingRewards>({ ...DEFAULT_REWARDS });
  readonly rewardControls: readonly { key: RewardKey; label: string }[] = [
    { key: 'winBall', label: 'Win a loose ball or intercept' },
    { key: 'usefulPass', label: 'Make a useful pass' },
    { key: 'receivePass', label: 'Receive a useful pass' },
    { key: 'saveGoal', label: 'Save a goal-bound shot' },
    { key: 'ignoreLooseBall', label: 'Ignore a reachable loose ball (penalty)' },
    { key: 'scoreGoal', label: 'Score a goal' },
    { key: 'concedeGoal', label: 'Concede a goal (penalty)' },
    { key: 'matchResult', label: 'Win or lose a match (±)' },
    { key: 'teamFoul', label: 'Commit a team foul (penalty)' },
    { key: 'opponentFoul', label: 'Opponent commits a foul' },
    { key: 'throwOut', label: 'Throw out of bounds (penalty)' },
    { key: 'approachLooseBall', label: 'Approach a loose ball' },
    { key: 'advanceWithBall', label: 'Advance with the ball' },
  ];
  readonly progress = signal<TrainingProgress | null>(null);
  readonly transfer = signal('');
  readonly status = signal('');
  readonly transferStatus = signal('');
  readonly rewardMax = rewardMax;
  readonly ruleset = RULESET;
  readonly pitch = PITCH;
  readonly paddlePose = paddlePose;
  readonly halfTicks = HALF_TICKS;
  readonly drillTrials = TRIALS;
  readonly drillResults = signal<Record<Drill, number> | null>(null);
  readonly drillBusy = signal(false);
  readonly drillLabel = signal('');
  readonly drillCandidate = signal(GENESIS.id);
  readonly cos = Math.cos;
  readonly sin = Math.sin;
  readonly matchLabels = signal(['Generation 0', 'Generation 0']);
  readonly clock = computed(() => {
    const state = this.match();
    return this.formatSeconds((state.half * HALF_TICKS - state.ticks) * DT);
  });
  readonly shotClock = computed(() => {
    const state = this.match();
    const remaining = Math.min(SHOT_TICKS - state.shotTicks, state.half * HALF_TICKS - state.ticks);
    return state.possessionTeam === null ? '—' : String(Math.max(0, Math.ceil(remaining * DT)));
  });
  private readonly destroyRef = inject(DestroyRef);
  private worker: Worker | null = null;
  private drillWorker: Worker | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private engine = new CanoeMatch(1);
  private random = seededRandom(1);
  private policies = [GENESIS.weights, GENESIS.weights];
  private workerParent: string | null = null;
  readonly saving = signal(false);
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      void this.restore();
      this.timer = setInterval(() => this.advance(), 100);
    });
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      clearInterval(this.timer);
      this.worker?.terminate();
      this.drillWorker?.terminate();
    });
  }

  private async restore(): Promise<void> {
    try {
      const generations = await loadGenerations();
      if (this.destroyed) return;
      this.generations.set(generations);
      this.blue.set(generations[0].id);
      this.parent.set(generations[0].id);
      if (generations[0].rewards)
        this.rewards.set({ ...DEFAULT_REWARDS, ...generations[0].rewards });
    } catch {
      this.status.set('Local storage is unavailable. Export generations before leaving.');
    } finally {
      this.ready.set(true);
    }
  }

  selectGeneration(event: Event, field: 'blue' | 'red' | 'parent' | 'drillCandidate'): void {
    const id = (event.target as HTMLSelectElement).value;
    this[field].set(id);
  }

  generationLabel(g: Generation): string {
    return g.number === 0 ? 'Generation 0' : 'Generation ' + g.number + ' · ' + g.id.slice(0, 8);
  }

  private find(id: string): Generation {
    return this.generations().find((g) => g.id === id) ?? GENESIS;
  }

  runDrills(): void {
    if (this.drillBusy()) return;
    const candidate = this.find(this.drillCandidate());
    this.drillResults.set(null);
    this.drillLabel.set(this.generationLabel(candidate));
    this.drillBusy.set(true);
    const finish = () => {
      this.drillWorker?.terminate();
      this.drillWorker = null;
      this.drillBusy.set(false);
    };
    try {
      const worker = new Worker(new URL('./skills-drills.worker', import.meta.url), {
        type: 'module',
      });
      this.drillWorker = worker;
      worker.onmessage = ({ data }: MessageEvent<Record<Drill, number>>) => {
        this.drillResults.set(data);
        finish();
      };
      worker.onerror = () => {
        this.status.set('The drills could not finish in this browser.');
        finish();
      };
      worker.postMessage(candidate.weights);
    } catch {
      this.status.set('The drills could not start in this browser.');
      finish();
    }
  }

  startMatch(): void {
    const blue = this.find(this.blue());
    const red = this.find(this.red());
    this.policies = [blue.weights, red.weights];
    this.matchLabels.set([this.generationLabel(blue), this.generationLabel(red)]);
    const seed = Math.floor(Math.random() * 4294967296);
    this.engine = new CanoeMatch(seed);
    this.random = seededRandom(seed + 1);
    this.publishMatch();
    this.playing.set(true);
  }

  toggleMatch(): void {
    if (this.match().phase !== 'finished') this.playing.update((value) => !value);
  }

  changeSpeed(event: Event): void {
    this.speed.set(Number((event.target as HTMLSelectElement).value));
  }

  private advance(): void {
    if (!this.playing()) return;
    for (let i = 0; i < this.speed() && this.engine.state.phase !== 'finished'; i++) {
      const state = this.engine.state;
      this.engine.step(
        state.players.map((p) =>
          state.phase === 'play'
            ? sample(this.policies[p.team], state, p, this.random).action
            : { paddle: 0, ball: 0 },
        ),
      );
    }
    this.publishMatch();
    if (this.engine.state.phase === 'finished') this.playing.set(false);
  }

  private publishMatch(): void {
    this.match.set({ ...this.engine.state });
  }

  playerTransform(player: Player): string {
    const angle = (player.heading * 180) / Math.PI;
    return `translate(${player.x} ${player.y}) rotate(${angle})`;
  }

  formatSeconds(seconds: number): string {
    const value = Math.max(0, Math.ceil(seconds));
    return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
  }

  eventTime(ticks: number): string {
    return this.formatSeconds(ticks * DT);
  }

  setPace(event: Event): void {
    const delay = Number((event.target as HTMLSelectElement).value);
    this.pace.set(delay);
    this.worker?.postMessage({ kind: 'pace', delay });
  }

  updateReward(event: Event, key: RewardKey): void {
    const input = event.target as HTMLInputElement;
    const value = input.valueAsNumber;
    if (!validRewardValue(key, value)) {
      input.value = String(this.rewards()[key]);
      return;
    }
    this.rewards.update((rewards) => ({ ...rewards, [key]: value }));
  }

  resetRewards(): void {
    this.rewards.set({ ...DEFAULT_REWARDS });
  }

  toggleTraining(): void {
    if (this.saving() || !this.ready()) return;
    if (this.training()) {
      this.worker?.postMessage({ kind: 'pause' });
      this.training.set(false);
      return;
    }
    if (this.worker && this.workerParent === this.parent()) {
      this.training.set(true);
      this.worker.postMessage({ kind: 'resume' });
    } else {
      this.startTraining();
    }
  }

  private startTraining(): void {
    this.worker?.terminate();
    this.worker = null;
    try {
      const worker = new Worker(new URL('./training.worker', import.meta.url), { type: 'module' });
      this.worker = worker;
      this.workerParent = this.parent();
      worker.onmessage = (event: MessageEvent<TrainingMessage>) => {
        if (this.worker !== worker || this.destroyed) return;
        if (event.data.kind === 'progress') {
          this.progress.set(event.data.progress);
        } else {
          void this.acceptGeneration(event.data.generation);
        }
      };
      worker.onerror = () => {
        if (this.worker !== worker) return;
        worker.terminate();
        this.worker = null;
        this.training.set(false);
        this.status.set('Training worker stopped unexpectedly.');
      };
      this.training.set(true);
      this.progress.set(null);
      worker.postMessage({
        kind: 'start',
        parent: this.find(this.parent()),
        seed: Math.floor(Math.random() * 4294967296),
        delay: this.pace(),
        rewards: this.rewards(),
      });
    } catch {
      this.training.set(false);
      this.status.set('Background training is not available in this browser.');
    }
  }

  private async acceptGeneration(generation: Generation): Promise<void> {
    this.saving.set(true);
    this.worker?.terminate();
    this.worker = null;
    try {
      await this.addGenerations([generation]);
      if (this.destroyed) return;
      this.parent.set(generation.id);
      this.status.update((message) => this.generationLabel(generation) + ' unlocked. ' + message);
    } finally {
      this.saving.set(false);
      if (!this.destroyed && this.training()) this.startTraining();
    }
  }

  private async addGenerations(incoming: Generation[], status = this.status): Promise<void> {
    this.generations.set(mergeGenerations(this.generations(), incoming));
    try {
      await saveGenerations(incoming);
      status.set('Saved on this device.');
    } catch {
      status.set('Could not save locally. Export before leaving.');
    }
  }

  searchGenerations(event: Event): void {
    this.generationQuery.set((event.target as HTMLInputElement).value);
  }

  exportOne(g: Generation): void {
    this.transfer.set(exportGenerations([g]));
    this.transferStatus.set('Export ready. Select and copy the text.');
  }

  exportAll(): void {
    this.transfer.set(exportGenerations(this.generations()));
    this.transferStatus.set('Collection export ready. Select and copy the text.');
  }

  async copyExport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.transfer());
      this.transferStatus.set('Copied.');
    } catch {
      this.transferStatus.set('Clipboard unavailable. Select and copy the text manually.');
    }
  }

  updateTransfer(event: Event): void {
    this.transfer.set((event.target as HTMLTextAreaElement).value);
  }

  async importData(): Promise<void> {
    try {
      await this.addGenerations(importGenerations(this.transfer()), this.transferStatus);
      this.transferStatus.update((message) => 'Import complete. ' + message);
    } catch {
      this.transferStatus.set('Could not import. This simulator requires a v3 policy export.');
    }
  }
}
