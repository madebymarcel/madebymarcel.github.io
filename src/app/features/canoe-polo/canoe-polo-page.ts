import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { COLLECT, FREE_THROW, HOLD } from './ball-play';
import {
  GENESIS,
  MAX_GENERATION_IMPORT_BYTES,
  exportGenerations,
  importGenerations,
  mergeGenerations,
  type Generation,
} from './generations';
import { clearGenerations, loadGenerations, saveGenerations } from './generation-store';
import {
  DT,
  HALF_TICKS,
  PITCH,
  RULESET,
  SHOT_TICKS,
  seededRandom,
  type Action,
  type MatchState,
  type Player,
} from './model';
import { sample, SHOT_AIM, SHOT_LOFT, SHOT_POWER } from './policy';
import { paddlePose } from './paddle';
import {
  canSee,
  PLAYER_VISION_ANGLE_DEGREES,
  PLAYER_VISION_CONE,
  PLAYER_VISION_RANGE,
} from './player-body';
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
  imports: [NgTemplateOutlet],
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
  readonly showVision = signal(false);
  readonly visionCone = PLAYER_VISION_CONE;
  readonly visionAngle = PLAYER_VISION_ANGLE_DEGREES;
  readonly visionRange = PLAYER_VISION_RANGE;
  readonly visionBallPlayers = computed(() => {
    const { players, ball } = this.match();
    return [0, 1].map(
      (team) =>
        players
          .filter((p) => p.team === team && canSee(p, ball))
          .map((p) => (p.id % 5) + 1)
          .join(', ') || 'none',
    );
  });
  readonly manualPlayer = signal(-1);
  readonly manualLook = signal(0);
  readonly manualActive = computed(
    () => this.manualPlayer() >= 0 && this.playing() && this.match().phase === 'play',
  );
  readonly manualHasBall = computed(() => this.match().ball.owner === this.manualPlayer());
  readonly manualStrokes = [
    { value: 1, label: 'Paddle left' },
    { value: 2, label: 'Paddle right' },
    { value: 3, label: 'Sweep left' },
    { value: 4, label: 'Sweep right' },
    { value: 5, label: 'Reverse left' },
    { value: 6, label: 'Reverse right' },
  ];
  readonly shotAimChoices = SHOT_AIM;
  readonly shotPowerChoices = SHOT_POWER;
  readonly shotLoftChoices = SHOT_LOFT;
  private pendingStroke = 0;
  private pendingBall: Pick<Action, 'ball' | 'aim' | 'power' | 'loft' | 'hand'> = { ball: HOLD };
  readonly speed = signal(1);
  readonly training = signal(false);
  readonly ready = signal(false);
  readonly immersive = signal(false);
  private autoDelay = 30;
  private sampleFrame = 0;
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
  readonly status = signal('');
  readonly libraryStatus = signal('');
  readonly importing = signal(false);
  readonly resetting = signal(false);
  readonly resetUnavailable = computed(
    () => !this.ready() || this.importing() || this.saving() || this.resetting(),
  );
  readonly rewardMax = rewardMax;
  readonly ruleset = RULESET;
  readonly pitch = PITCH;
  readonly paddlePose = paddlePose;
  readonly halfTicks = HALF_TICKS;
  readonly cos = Math.cos;
  readonly sin = Math.sin;
  private readonly matchGenerations = computed(
    () => [this.find(this.blue()), this.find(this.red())] as const,
  );
  private readonly finishedMatchLabels = signal<string[] | null>(null);
  readonly matchLabels = computed(
    () => this.finishedMatchLabels() ?? this.matchGenerations().map((g) => this.generationLabel(g)),
  );
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
  private timer: ReturnType<typeof setInterval> | undefined;
  private engine = new CanoeMatch(1);
  private random = seededRandom(1);
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
      if (this.sampleFrame) cancelAnimationFrame(this.sampleFrame);
      clearInterval(this.timer);
      this.worker?.terminate();
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
      this.status.set(
        'Local storage is unavailable. Download any generations you want to keep before leaving.',
      );
    } finally {
      this.ready.set(true);
    }
  }

  selectGeneration(event: Event, field: 'blue' | 'red' | 'parent'): void {
    const id = (event.target as HTMLSelectElement).value;
    this[field].set(id);
  }

  generationLabel(g: Generation): string {
    return g.number === 0 ? 'Generation 0' : 'Generation ' + g.number + ' · ' + g.id.slice(0, 8);
  }

  private find(id: string): Generation {
    return this.generations().find((g) => g.id === id) ?? GENESIS;
  }

  startMatch(): void {
    this.finishedMatchLabels.set(null);
    this.clearManualCommands();
    const seed = Math.floor(Math.random() * 4294967296);
    this.engine = new CanoeMatch(seed);
    this.random = seededRandom(seed + 1);
    this.publishMatch();
    this.playing.set(true);
  }

  toggleMatch(): void {
    if (this.match().phase !== 'finished') {
      this.clearManualCommands();
      this.playing.update((value) => !value);
    }
  }

  changeSpeed(event: Event): void {
    this.speed.set(Number((event.target as HTMLSelectElement).value));
  }

  chooseManualPlayer(value: string): void {
    this.clearManualCommands();
    this.manualLook.set(0);
    this.manualPlayer.set(Number(value));
  }

  degrees(radians: number): number {
    return Math.round((radians * 180) / Math.PI);
  }

  queueManualStroke(stroke: number): void {
    if (this.manualActive() && !this.manualHasBall()) this.pendingStroke = stroke;
  }

  queueManualPickup(): void {
    if (this.manualActive() && !this.manualHasBall()) this.pendingBall = { ball: COLLECT };
  }

  queueManualThrow(aim: string, power: string, loft: string, hand: string): void {
    if (!this.manualActive() || !this.manualHasBall()) return;
    this.pendingBall = {
      ball: FREE_THROW,
      aim: Number(aim),
      power: Number(power),
      loft: Number(loft),
      hand: hand === '-1' ? -1 : hand === '1' ? 1 : undefined,
    };
  }

  private clearManualCommands(): void {
    this.pendingStroke = 0;
    this.pendingBall = { ball: HOLD };
  }

  private manualAction(p: Player, state: MatchState): Action {
    const held = state.ball.owner === p.id;
    const paddle = !held && p.strokeTicks === 0 ? this.pendingStroke : 0;
    if (held || paddle) this.pendingStroke = 0;
    const ball = this.pendingBall;
    this.pendingBall = { ball: HOLD };
    const applicable = held ? ball.ball === FREE_THROW : ball.ball === COLLECT;
    return { ...(applicable ? ball : { ball: HOLD }), paddle, look: this.manualLook() };
  }

  private advance(): void {
    if (!this.playing()) return;
    const generations = this.matchGenerations();
    for (let i = 0; i < this.speed() && this.engine.state.phase !== 'finished'; i++) {
      const state = this.engine.state;
      if (state.phase !== 'play') {
        this.clearManualCommands();
        this.engine.step(state.players.map(() => ({ paddle: 0, ball: HOLD })));
      } else {
        const manualId = this.manualPlayer();
        this.engine.step(
          state.players.map((p) =>
            p.id === manualId
              ? this.manualAction(p, state)
              : sample(generations[p.team].weights, state, p, this.random, true).action,
          ),
        );
      }
    }
    this.publishMatch();
    if (this.engine.state.phase === 'finished') {
      this.finishedMatchLabels.set(this.matchLabels());
      this.playing.set(false);
    }
  }

  private publishMatch(): void {
    this.match.set({ ...this.engine.state });
  }

  playerTransform(player: Player, headingOffset = 0): string {
    const angle = ((player.heading + headingOffset) * 180) / Math.PI;
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
    cancelAnimationFrame(this.sampleFrame);
    this.autoDelay = 30;
    if (delay === -1) this.monitorPlayback();
    this.worker?.postMessage({ kind: 'pace', delay: this.workerDelay() });
  }

  private workerDelay(): number {
    return this.pace() === -1 ? this.autoDelay : this.pace();
  }

  private monitorPlayback(): void {
    let previous = 0;
    let start = 0;
    let lateFrames = 0;
    const sample = (now: number) => {
      if (this.training() && previous && now - previous < 1000) {
        if (now - previous > 24) lateFrames++;
        if (now - start >= 1000) {
          // Poor frame pacing calls for a fast retreat. Probe for capacity gradually.
          const delay =
            lateFrames >= 3 ? Math.min(200, this.autoDelay + 15) : Math.max(0, this.autoDelay - 3);
          if (delay !== this.autoDelay) {
            this.autoDelay = delay;
            this.worker?.postMessage({ kind: 'pace', delay });
          }
          start = now;
          lateFrames = 0;
        }
      } else {
        start = now;
        lateFrames = 0;
      }
      previous = now;
      this.sampleFrame = requestAnimationFrame(sample);
    };
    this.sampleFrame = requestAnimationFrame(sample);
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
    if (this.saving() || this.resetting() || !this.ready()) return;
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
        delay: this.workerDelay(),
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
      status.set(
        'Could not save locally. Download any generations you want to keep before leaving.',
      );
    }
  }

  searchGenerations(event: Event): void {
    this.generationQuery.set((event.target as HTMLInputElement).value);
  }

  downloadGeneration(generation: Generation): void {
    const blob = new Blob([exportGenerations([generation])], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `canoe-polo-generation-${generation.number}-${generation.id}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.ready() || this.importing() || this.resetting()) return;
    if (file.size > MAX_GENERATION_IMPORT_BYTES) {
      this.libraryStatus.set('Generation file exceeds the 64 MB import limit.');
      return;
    }

    this.importing.set(true);
    this.libraryStatus.set('Importing…');
    try {
      let text: string;
      try {
        text = await file.text();
      } catch {
        this.libraryStatus.set('Could not read the generation file.');
        return;
      }
      if (this.destroyed) return;
      const incoming = importGenerations(text);
      await this.addGenerations(incoming, this.libraryStatus);
      this.libraryStatus.update(
        (message) =>
          `Imported ${incoming.length} ${incoming.length === 1 ? 'generation' : 'generations'}. ${message}`,
      );
    } catch (error) {
      this.libraryStatus.set(
        error instanceof Error ? error.message : 'Could not import generations.',
      );
    } finally {
      this.importing.set(false);
    }
  }

  async resetGenerations(): Promise<void> {
    if (
      this.resetUnavailable() ||
      !window.confirm(
        'Delete all saved Canoe Polo generations from this browser? Training will stop. This cannot be undone.',
      )
    )
      return;

    this.resetting.set(true);
    this.training.set(false);
    this.worker?.terminate();
    this.worker = null;
    this.workerParent = null;
    this.progress.set(null);
    this.libraryStatus.set('');

    try {
      await clearGenerations();
      if (this.destroyed) return;
      this.generations.set([GENESIS]);
      this.generationQuery.set('');
      this.blue.set(GENESIS.id);
      this.red.set(GENESIS.id);
      this.parent.set(GENESIS.id);
      this.rewards.set({ ...DEFAULT_REWARDS });
      this.playing.set(false);
      this.chooseManualPlayer('-1');
      this.engine = new CanoeMatch(1);
      this.random = seededRandom(1);
      this.finishedMatchLabels.set(null);
      this.publishMatch();
      this.status.set('');
      this.libraryStatus.set('Saved generations deleted. Back to Generation 0.');
    } catch {
      this.libraryStatus.set('Could not delete saved generations. Try again.');
    } finally {
      this.resetting.set(false);
    }
  }
}
