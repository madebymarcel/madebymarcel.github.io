import { ACTIONS, OBSERVATIONS, BalanceEnvironment } from './balance-environment';
import type { EndReason, Transition } from './balance-environment';
import type { PhysicsSnapshot } from './passive-physics';
import { PpoAgent, advantages } from './ppo';
import type { Sample, TrainingSample } from './ppo';

const BATCH = 256;
const EVALUATION_SEEDS = [0x5a17d31, 0x1e529f3] as const;
const FORMAT = 'trex-v3-ppo-distance-1';
const ACTION_KEYS = ACTIONS.map(({ id, axis }) => id + ':' + axis);

export type Phase = 'training' | 'evaluation' | 'replay' | 'blocked';
export interface TrainingStats {
  episodes: number;
  invalidEpisodes: number;
  invalidEvaluations: number;
  actions: number;
  learnedActions: number;
  updates: number;
  lastDistanceM: number | null;
  bestTrainingM: number | null;
  evaluationM: number | null;
  bestEvaluationM: number | null;
}

export interface TrainingFrame {
  readonly phase: Phase;
  readonly stats: Readonly<TrainingStats>;
  readonly distanceM: number;
  readonly elapsed: number;
  readonly reason: EndReason;
  readonly snapshot: PhysicsSnapshot;
  readonly horizon: number;
  readonly message: string;
}

export interface Checkpoint {
  readonly format: typeof FORMAT;
  readonly actions: readonly string[];
  readonly observations: readonly string[];
  readonly horizon: number;
  readonly rng: number;
  readonly learner: ReturnType<PpoAgent['state']>;
  readonly stats: TrainingStats;
  readonly bestPolicy: number[] | null;
}

interface Episode {
  env: BalanceEnvironment;
  state: Transition;
  samples: Sample[];
  distance: number;
}

// Reward is exactly signed forward COM displacement before falling.
// An invalid run is discarded, not scored as a zero-distance fall.
export function distanceReward(previous: number, next: number, reason: EndReason): number | null {
  if (reason === 'invalid' || !Number.isFinite(previous) || !Number.isFinite(next)) return null;
  return reason === 'fall' ? 0 : next - previous;
}

function episode(seed: number, horizon: number): Episode {
  const env = new BalanceEnvironment(horizon, true);
  return { env, state: env.reset(seed), samples: [], distance: 0 };
}

function emptyStats(): TrainingStats {
  return {
    episodes: 0,
    invalidEpisodes: 0,
    invalidEvaluations: 0,
    actions: 0,
    learnedActions: 0,
    updates: 0,
    lastDistanceM: null,
    bestTrainingM: null,
    evaluationM: null,
    bestEvaluationM: null,
  };
}

export class DistanceTrainer {
  private rng: number;
  private readonly random = () => {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  };
  private readonly agent: PpoAgent;
  private active: Episode;
  private replay: Episode | null = null;
  private batch: TrainingSample[] = [];
  private phase: Exclude<Phase, 'replay'> = 'training';
  private evaluation: (number | null)[] = [];
  private bestPolicy: number[] | null = null;
  private recentInvalid: boolean[] = [];
  private consecutiveInvalid = 0;
  private message = '';
  private stats = emptyStats();

  constructor(
    seed: number,
    readonly horizon = 30,
  ) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new Error('Invalid training seed');
    }
    if (!Number.isFinite(horizon) || horizon < 5 || horizon > 120) {
      throw new Error('Training horizon must be between 5 and 120 seconds');
    }
    this.rng = seed;
    this.agent = new PpoAgent(OBSERVATIONS.length, ACTIONS.length, this.random);
    this.active = this.newTrainingEpisode();
  }

  private newTrainingEpisode(): Episode {
    return episode(Math.floor(this.random() * 4294967296), this.horizon);
  }

  private finishTraining(): void {
    const run = this.active;
    const invalid = run.state.reason === 'invalid' || !run.state.observation;
    this.stats.episodes++;
    this.recentInvalid.push(invalid);
    if (this.recentInvalid.length > 20) this.recentInvalid.shift();
    if (invalid) {
      this.stats.invalidEpisodes++;
      this.consecutiveInvalid++;
    } else {
      this.consecutiveInvalid = 0;
      this.stats.lastDistanceM = run.distance;
      this.stats.bestTrainingM = Math.max(this.stats.bestTrainingM ?? -Infinity, run.distance);
      const bootstrap = run.state.truncated ? this.agent.value(run.state.observation!) : 0;
      this.batch.push(...advantages(run.samples, bootstrap));
    }
    if (
      this.consecutiveInvalid >= 8 ||
      (this.recentInvalid.length === 20 && this.recentInvalid.filter(Boolean).length >= 10)
    ) {
      this.phase = 'blocked';
      this.message =
        'Too many invalid physics episodes. Training stopped; inspect the body before learning.';
      this.batch = [];
      return;
    }
    if (this.batch.length >= BATCH) {
      const count = this.batch.length;
      this.agent.update(this.batch);
      this.stats.learnedActions += count;
      this.stats.updates++;
      this.batch = [];
      this.evaluation = [];
      this.phase = 'evaluation';
      this.active = episode(EVALUATION_SEEDS[0], this.horizon);
    } else {
      this.active = this.newTrainingEpisode();
    }
  }

  private finishEvaluation(): void {
    const invalid = this.active.state.reason === 'invalid' || !this.active.state.observation;
    this.evaluation.push(invalid ? null : this.active.distance);
    if (invalid) this.stats.invalidEvaluations++;
    if (this.evaluation.length < EVALUATION_SEEDS.length) {
      this.active = episode(EVALUATION_SEEDS[this.evaluation.length], this.horizon);
      return;
    }
    const distances = this.evaluation;
    if (distances.every((value): value is number => value !== null)) {
      const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
      this.stats.evaluationM = mean;
      if (this.stats.bestEvaluationM === null || mean > this.stats.bestEvaluationM) {
        this.stats.bestEvaluationM = mean;
        this.bestPolicy = this.agent.policy();
      }
    } else {
      this.stats.evaluationM = null;
    }
    this.phase = 'training';
    this.active = this.newTrainingEpisode();
  }

  private advanceOne(): void {
    if (this.phase === 'blocked' && !this.replay) return;
    const run = this.replay ?? this.active;
    if (run.state.reason !== 'running' || !run.state.observation) {
      if (this.replay) return;
      if (this.phase === 'training') this.finishTraining();
      else this.finishEvaluation();
      return;
    }
    const observation = run.state.observation;
    const previous = run.state.forwardPositionM;
    const learning = !this.replay && this.phase === 'training';
    const decision = learning ? this.agent.sample(observation) : null;
    const action =
      decision?.action ??
      this.agent.action(observation, this.replay ? (this.bestPolicy ?? undefined) : undefined);
    const next = run.env.step(action);
    const reward = distanceReward(previous, next.forwardPositionM, next.reason);
    run.state = next;
    if (reward !== null) {
      run.distance += reward;
      if (decision) {
        run.samples.push({
          observation,
          latent: decision.latent,
          logProbability: decision.logProbability,
          value: decision.value,
          reward,
        });
      }
    }
    if (learning) this.stats.actions++;
    if (this.replay || next.reason === 'running') return;
    if (this.phase === 'training') this.finishTraining();
    else this.finishEvaluation();
  }

  advance(count: number): TrainingFrame {
    if (!Number.isSafeInteger(count) || count < 1 || count > 16)
      throw new Error('Invalid step budget');
    for (let i = 0; i < count; i++) {
      if (this.replay && this.replay.state.reason !== 'running') break;
      if (this.phase === 'blocked' && !this.replay) break;
      this.advanceOne();
    }
    return this.frame();
  }

  startReplay(): TrainingFrame {
    if (!this.bestPolicy) throw new Error('No evaluated policy yet');
    // A replay has no time limit. It uses the same physics, but not PPO
    // exploration or an artificial reset at the end of a training horizon.
    this.replay = episode(EVALUATION_SEEDS[0], Infinity);
    return this.frame();
  }

  resumeTraining(): TrainingFrame {
    this.replay = null;
    return this.frame();
  }

  frame(): TrainingFrame {
    const run = this.replay ?? this.active;
    return {
      phase: this.replay ? 'replay' : this.phase,
      stats: { ...this.stats },
      distanceM: run.distance,
      elapsed: run.state.elapsed,
      reason: run.state.reason,
      snapshot: run.env.snapshot(),
      horizon: this.horizon,
      message: this.replay ? '' : this.message,
    };
  }

  checkpoint(): Checkpoint {
    return {
      format: FORMAT,
      actions: ACTION_KEYS,
      observations: OBSERVATIONS,
      horizon: this.horizon,
      rng: this.rng,
      learner: this.agent.state(),
      stats: { ...this.stats },
      bestPolicy: this.bestPolicy?.slice() ?? null,
    };
  }

  static restore(data: unknown): DistanceTrainer {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid checkpoint');
    const saved = data as Checkpoint;
    if (
      saved.format !== FORMAT ||
      JSON.stringify(saved.actions) !== JSON.stringify(ACTION_KEYS) ||
      JSON.stringify(saved.observations) !== JSON.stringify(OBSERVATIONS) ||
      !saved.stats
    )
      throw new Error('Checkpoint does not match this V3 environment');
    const next = new DistanceTrainer(saved.rng, saved.horizon);
    next.agent.restore(saved.learner);
    const stats = emptyStats();
    for (const key of [
      'episodes',
      'invalidEpisodes',
      'invalidEvaluations',
      'actions',
      'learnedActions',
      'updates',
    ] as const) {
      const value = saved.stats[key];
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid checkpoint counters');
      stats[key] = value;
    }
    for (const key of [
      'lastDistanceM',
      'bestTrainingM',
      'evaluationM',
      'bestEvaluationM',
    ] as const) {
      const value = saved.stats[key];
      if (value !== null && !Number.isFinite(value)) throw new Error('Invalid checkpoint score');
      stats[key] = value;
    }
    if (stats.invalidEpisodes > stats.episodes || stats.learnedActions > stats.actions) {
      throw new Error('Invalid checkpoint totals');
    }
    if (
      saved.bestPolicy !== null &&
      (!Array.isArray(saved.bestPolicy) ||
        saved.bestPolicy.length !== next.agent.policy().length ||
        !saved.bestPolicy.every(Number.isFinite))
    )
      throw new Error('Invalid best policy');
    if ((saved.bestPolicy === null) !== (stats.bestEvaluationM === null)) {
      throw new Error('Inconsistent best policy');
    }
    next.stats = stats;
    next.bestPolicy = saved.bestPolicy?.slice() ?? null;
    // Resume the trained parameters and optimizer, not the in-flight episode.
    next.rng = saved.rng;
    next.active = next.newTrainingEpisode();
    return next;
  }
}
