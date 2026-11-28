import { ACTIONS, OBSERVATIONS, BalanceEnvironment, describePhysicsFault } from './balance-environment';
import type { PhysicsFault, PhysicsFaultKind, Transition } from './balance-environment';
import { CapabilityAudit, assessCapabilities } from './capability-audit';
import type { CapabilityGate, CapabilityReport } from './capability-audit';
import { DepController } from './dep-controller';
import type { DepState } from './dep-controller';
import type { DepEpisode, DepJob, DepResult } from './dep-rollout';
import type { Phase, TrainingStats } from './distance-training';
import { MpoAgent, MpoPolicy } from './mpo';
import type { MpoState } from './mpo';
import { ReplayBuffer } from './replay-buffer';
import type { ReplayState } from './replay-buffer';
import { distanceReward } from './rollout-collection';
import type { RolloutView } from './rollout-collection';
import type { BrainFrame } from './training-protocol';

const FORMAT = 'trex-v3-dep-mpo-1';
const KEYS = ACTIONS.map(({ id, axis }) => id + ':' + axis);
export const WARMUP = 2048;
const BATCH = 32;
const UPDATES_PER_ROUND = 4;
const EVALUATION_SEEDS = [0x5a17d31, 0x1e529f3] as const;
const HISTORY_LIMIT = 2000;

export interface DepHistory {
  readonly round: number;
  readonly stats: TrainingStats;
  readonly replaySize: number;
  readonly gate: CapabilityGate;
  readonly latestEvaluationSeconds: number | null;
  readonly bestEvaluationSeconds: number | null;
  readonly bestCapability: CapabilityReport;
}

export interface DepCheckpoint {
  readonly format: typeof FORMAT;
  readonly brain: 'dep' | 'dep-mpo';
  readonly actions: readonly string[];
  readonly observations: readonly string[];
  readonly seed: number;
  readonly rng: number;
  readonly horizon: number;
  readonly round: number;
  readonly learner: MpoState;
  readonly replay: ReplayState;
  readonly depStates: readonly (DepState | null)[];
  readonly stats: TrainingStats;
  readonly depDecisions: number;
  readonly sampledTransitions: number;
  readonly gate: CapabilityGate;
  readonly bestCapability: CapabilityReport;
  readonly latestEvaluationSeconds: number | null;
  readonly bestEvaluationSeconds: number | null;
  readonly bestPolicy: number[] | null;
  readonly recentInvalid: readonly boolean[];
  readonly consecutiveInvalid: number;
  readonly history: readonly DepHistory[];
  readonly lastPhysicsFault?: PhysicsFault;
  readonly physicsFaultCounts?: Partial<Record<PhysicsFaultKind, number>>;
}

interface Evaluation {
  env: BalanceEnvironment;
  state: Transition;
  audit: CapabilityAudit;
  distanceM: number;
}

function evaluation(seed: number, horizon: number): Evaluation {
  const env = new BalanceEnvironment(horizon);
  const state = env.reset(seed);
  const audit = new CapabilityAudit();
  audit.observe(state, env.snapshot());
  return { env, state, audit, distanceM: 0 };
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

function emptyCapability(): CapabilityReport {
  return {
    supportedSeconds: 0,
    longestStableSeconds: 0,
    longestSupportedSeconds: 0,
    leftLifts: 0,
    rightLifts: 0,
    weightTransfers: 0,
    leftSteps: 0,
    rightSteps: 0,
    alternatingSteps: 0,
    maxTailPitchDegrees: 0,
    maxTorsoPitchDegrees: 0,
    counterRotationSeconds: 0,
  };
}

function combineGate(a: CapabilityGate, b: CapabilityGate): CapabilityGate {
  const result = {
    validEpisodes: a.validEpisodes + b.validEpisodes,
    invalidEpisodes: a.invalidEpisodes + b.invalidEpisodes,
    stableStanding: a.stableStanding || b.stableStanding,
    leftLift: a.leftLift || b.leftLift,
    rightLift: a.rightLift || b.rightLift,
    transfer: a.transfer || b.transfer,
    alternatingSteps: a.alternatingSteps || b.alternatingSteps,
    tailTorsoCounterRotation: a.tailTorsoCounterRotation || b.tailTorsoCounterRotation,
  };
  return {
    ...result,
    passed:
      result.validEpisodes >= 3 &&
      result.invalidEpisodes <= 0.1 * (result.invalidEpisodes + result.validEpisodes) &&
      result.stableStanding &&
      result.leftLift &&
      result.rightLift &&
      result.transfer &&
      result.alternatingSteps &&
      result.tailTorsoCounterRotation,
  };
}

function maxCapability(a: CapabilityReport, b: CapabilityReport): CapabilityReport {
  const result = { ...a };
  for (const key of Object.keys(a) as (keyof CapabilityReport)[]) {
    result[key] = Math.max(a[key], b[key]);
  }
  return result;
}

export class DepTrainer {
  private rng: number;
  private readonly random = () => {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  };
  private readonly agent: MpoAgent;
  private readonly buffer = new ReplayBuffer(OBSERVATIONS.length, ACTIONS.length);
  private readonly depStates: (DepState | null)[] = [null, null, null, null];
  private stats = emptyStats();
  private gate = assessCapabilities([]);
  private bestCapability = emptyCapability();
  private depDecisions = 0;
  private sampledTransitions = 0;
  private round = 0;
  private pending: readonly DepJob[] | null = null;
  private phase: Exclude<Phase, 'replay'> = 'training';
  private active: Evaluation;
  private lastView: RolloutView | null = null;
  private playback: Evaluation | null = null;
  private playbackPolicy: MpoPolicy | null = null;
  private evaluationResults: { distanceM: number | null; elapsed: number }[] = [];
  private latestEvaluationSeconds: number | null = null;
  private bestEvaluationSeconds: number | null = null;
  private bestPolicy: number[] | null = null;
  private recentInvalid: boolean[] = [];
  private consecutiveInvalid = 0;
  private lastPhysicsFault: PhysicsFault | undefined;
  private physicsFaultCounts: Partial<Record<PhysicsFaultKind, number>> = {};
  private message = '';
  private history: DepHistory[] = [];

  constructor(
    readonly seed: number,
    readonly horizon = 30,
    private brain: 'dep' | 'dep-mpo' = 'dep',
  ) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new Error('Invalid training seed');
    }
    if (!Number.isFinite(horizon) || horizon < 5 || horizon > 120) {
      throw new Error('Training horizon must be between 5 and 120 seconds');
    }
    if (brain !== 'dep' && brain !== 'dep-mpo') throw new Error('Invalid DEP brain');
    this.rng = seed;
    this.agent = new MpoAgent(OBSERVATIONS.length, ACTIONS.length, this.random);
    this.active = evaluation(seed, horizon);
  }

  enableMpo(): BrainFrame {
    if (this.pending || this.playback || this.phase !== 'training') {
      throw new Error('Pause pure DEP before enabling MPO');
    }
    this.brain = 'dep-mpo';
    return this.frame();
  }

  beginRound(lanes: number, minimumActions = 64, exactBudget = false): readonly DepJob[] {
    if (this.phase !== 'training' || this.playback || this.pending) {
      throw new Error('Cannot start DEP collection from this state');
    }
    if (
      !Number.isSafeInteger(lanes) ||
      lanes < 1 ||
      lanes > 4 ||
      !Number.isSafeInteger(minimumActions) ||
      minimumActions < 1 ||
      minimumActions > 1024
    )
      throw new Error('Invalid DEP collection budget');
    const round = ++this.round;
    const pure = this.brain === 'dep' || this.buffer.size < WARMUP || this.stats.updates === 0;
    const policy = pure ? null : this.agent.policy();
    this.pending = Array.from({ length: lanes }, (_, lane) => ({
      brain: this.brain,
      round,
      lane,
      seed: (this.seed ^ Math.imul(round, 0x9e3779b9) ^ Math.imul(lane + 1, 0x85ebca6b)) >>> 0,
      horizon: this.horizon,
      minimumActions,
      exactBudget,
      exploration: pure ? 'dep' : 'mixed',
      depState: this.depStates[lane],
      policy,
    }));
    return this.pending;
  }

  private recordEpisode(run: DepEpisode): void {
    const invalid = run.distanceM === null;
    this.stats.episodes++;
    this.recentInvalid.push(invalid);
    if (this.recentInvalid.length > 20) this.recentInvalid.shift();
    if (invalid) {
      this.stats.invalidEpisodes++;
      this.consecutiveInvalid++;
      if (run.physicsFault) {
        this.lastPhysicsFault = run.physicsFault;
        for (const kind of run.physicsFault.kinds) {
          this.physicsFaultCounts[kind] = (this.physicsFaultCounts[kind] ?? 0) + 1;
        }
      }
    } else {
      this.consecutiveInvalid = 0;
      this.stats.lastDistanceM = run.distanceM;
      this.stats.bestTrainingM = Math.max(this.stats.bestTrainingM ?? -Infinity, run.distanceM!);
      this.stats.learnedActions += run.experiences.length;
      this.bestCapability = maxCapability(this.bestCapability, run.capability);
      for (const experience of run.experiences) this.buffer.add(experience);
    }
    if (run.depActions === run.actions) {
      this.gate = combineGate(this.gate, assessCapabilities([run]));
    }
    if (
      this.consecutiveInvalid >= 8 ||
      (this.recentInvalid.length === 20 && this.recentInvalid.filter(Boolean).length >= 10)
    ) {
      this.phase = 'blocked';
      this.message = 'Too many invalid physics episodes. Inspect the body before resuming.';
    }
  }

  finishRound(results: readonly DepResult[]): BrainFrame {
    const jobs = this.pending;
    if (!jobs || results.length !== jobs.length) throw new Error('Incomplete DEP collection');
    const ordered = [...results].sort((a, b) => a.lane - b.lane);
    for (let i = 0; i < ordered.length; i++) {
      const result = ordered[i];
      const job = jobs[i];
      if (
        result.round !== job.round ||
        result.lane !== i ||
        result.brain !== job.brain ||
        !Number.isSafeInteger(result.attempts) ||
        result.attempts < 0 ||
        !Number.isSafeInteger(result.depAttempts) ||
        result.depAttempts < 0 ||
        result.depAttempts > result.attempts ||
        (job.exactBudget && result.attempts > job.minimumActions) ||
        result.episodes.reduce((sum, run) => sum + run.actions, 0) > result.attempts
      )
        throw new Error('Mismatched DEP collection result');
      for (const run of result.episodes) {
        if (
          run.reason === 'running' ||
          (run.reason === 'invalid' && (run.experiences.length || run.distanceM !== null)) ||
          (run.reason !== 'invalid' &&
            (run.distanceM === null || run.experiences.length !== run.actions))
        )
          throw new Error('Invalid DEP episode');
      }
      new DepController(ACTIONS.length).restore(result.depState);
    }
    this.pending = null;
    for (const result of ordered) {
      this.stats.actions += result.attempts;
      this.depDecisions += result.depAttempts;
      this.depStates[result.lane] = result.depState;
      for (const run of result.episodes) this.recordEpisode(run);
    }
    this.lastView = ordered[0].view;
    if (this.phase !== 'blocked' && this.brain === 'dep-mpo' && this.buffer.size >= WARMUP) {
      for (let i = 0; i < UPDATES_PER_ROUND; i++) {
        this.agent.update(this.buffer.sample(BATCH, this.random));
        this.stats.updates++;
        this.sampledTransitions += BATCH;
      }
      this.evaluationResults = [];
      this.phase = 'evaluation';
      this.active = evaluation(EVALUATION_SEEDS[0], this.horizon);
    }
    this.recordHistory();
    return this.frame();
  }

  private recordHistory(): void {
    this.history.push({
      round: this.round,
      stats: { ...this.stats },
      replaySize: this.buffer.size,
      gate: { ...this.gate },
      latestEvaluationSeconds: this.latestEvaluationSeconds,
      bestEvaluationSeconds: this.bestEvaluationSeconds,
      bestCapability: { ...this.bestCapability },
    });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  cancelRound(round: number): BrainFrame {
    if (this.pending?.[0].round === round) this.pending = null;
    return this.frame();
  }

  private stepEvaluation(): void {
    const run = this.playback ?? this.active;
    if (run.state.reason !== 'running' || !run.state.observation) return;
    const policy = this.playback ? this.playbackPolicy! : this.agent;
    const next = run.env.step(policy.action(run.state.observation));
    const reward = distanceReward(run.state.forwardPositionM, next.forwardPositionM, next.reason);
    if (reward !== null) run.distanceM += reward;
    run.state = next;
    run.audit.observe(next, run.env.snapshot());
    if (this.playback || next.reason === 'running') return;
    const invalid = next.reason === 'invalid';
    if (invalid) this.stats.invalidEvaluations++;
    this.evaluationResults.push({
      distanceM: invalid ? null : run.distanceM,
      elapsed: next.elapsed,
    });
    if (this.evaluationResults.length < EVALUATION_SEEDS.length) {
      this.active = evaluation(EVALUATION_SEEDS[this.evaluationResults.length], this.horizon);
      return;
    }
    if (this.evaluationResults.every((result) => result.distanceM !== null)) {
      const mean =
        this.evaluationResults.reduce((sum, result) => sum + result.distanceM!, 0) /
        this.evaluationResults.length;
      const seconds =
        this.evaluationResults.reduce((sum, result) => sum + result.elapsed, 0) /
        this.evaluationResults.length;
      this.stats.evaluationM = mean;
      this.latestEvaluationSeconds = seconds;
      if (this.stats.bestEvaluationM === null || mean > this.stats.bestEvaluationM) {
        this.stats.bestEvaluationM = mean;
        this.bestEvaluationSeconds = seconds;
        this.bestPolicy = this.agent.policy();
      }
    } else {
      this.stats.evaluationM = null;
      this.latestEvaluationSeconds = null;
    }
    this.phase = 'training';
    this.recordHistory();
  }

  advance(count: number): BrainFrame {
    if (this.pending || !Number.isSafeInteger(count) || count < 1 || count > 16) {
      throw new Error('Invalid DEP evaluation budget');
    }
    for (let i = 0; i < count; i++) {
      if (this.playback) {
        if (this.playback.state.reason !== 'running') break;
      } else if (this.phase !== 'evaluation') break;
      this.stepEvaluation();
    }
    return this.frame();
  }

  startReplay(): BrainFrame {
    if (!this.bestPolicy || this.pending) throw new Error('No evaluated MPO policy yet');
    this.playback = evaluation(EVALUATION_SEEDS[0], Infinity);
    this.playbackPolicy = new MpoPolicy(OBSERVATIONS.length, ACTIONS.length, () => 0.5);
    this.playbackPolicy.restorePolicy(this.bestPolicy);
    return this.frame();
  }

  resumeTraining(): BrainFrame {
    this.playback = null;
    this.playbackPolicy = null;
    return this.frame();
  }

  frame(): BrainFrame {
    const run = this.playback ?? this.active;
    const collected = this.playback || this.phase === 'evaluation' ? null : this.lastView;
    return {
      phase: this.playback ? 'replay' : this.phase,
      brain: this.brain,
      correlation: 0,
      stats: { ...this.stats },
      distanceM: collected?.distanceM ?? run.distanceM,
      elapsed: collected?.elapsed ?? run.state.elapsed,
      reason: collected?.reason ?? run.state.reason,
      snapshot: collected?.snapshot ?? run.env.snapshot(),
      horizon: this.horizon,
      message: this.playback ? '' : this.message,
      ...(this.lastPhysicsFault ? { lastPhysicsFault: describePhysicsFault(this.lastPhysicsFault) } : {}),
      physicsFaultCounts: { ...this.physicsFaultCounts },
      gate: { ...this.gate },
      bestCapability: { ...this.bestCapability },
      replaySize: this.buffer.size,
      depDecisions: this.depDecisions,
      warmup: WARMUP,
      latestEvaluationSeconds: this.latestEvaluationSeconds,
      bestEvaluationSeconds: this.bestEvaluationSeconds,
      sampledTransitions: this.sampledTransitions,
    };
  }

  checkpoint(): DepCheckpoint {
    return {
      format: FORMAT,
      brain: this.brain,
      actions: KEYS,
      observations: OBSERVATIONS,
      seed: this.seed,
      rng: this.rng,
      horizon: this.horizon,
      round: this.round,
      learner: this.agent.state(),
      replay: this.buffer.state(),
      depStates: this.depStates.map((state) =>
        state ? { matrix: [...state.matrix], bias: [...state.bias] } : null,
      ),
      stats: { ...this.stats },
      depDecisions: this.depDecisions,
      sampledTransitions: this.sampledTransitions,
      gate: { ...this.gate },
      bestCapability: { ...this.bestCapability },
      latestEvaluationSeconds: this.latestEvaluationSeconds,
      bestEvaluationSeconds: this.bestEvaluationSeconds,
      bestPolicy: this.bestPolicy?.slice() ?? null,
      recentInvalid: [...this.recentInvalid],
      consecutiveInvalid: this.consecutiveInvalid,
      history: this.history.slice(),
      ...(this.lastPhysicsFault ? { lastPhysicsFault: this.lastPhysicsFault } : {}),
      physicsFaultCounts: { ...this.physicsFaultCounts },
    };
  }

  static restore(data: unknown): DepTrainer {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid DEP checkpoint');
    const saved = data as DepCheckpoint;
    if (
      saved.format !== FORMAT ||
      JSON.stringify(saved.actions) !== JSON.stringify(KEYS) ||
      JSON.stringify(saved.observations) !== JSON.stringify(OBSERVATIONS) ||
      !saved.stats ||
      !saved.gate ||
      !saved.bestCapability ||
      !Array.isArray(saved.depStates) ||
      saved.depStates.length !== 4 ||
      !Array.isArray(saved.history) ||
      saved.history.length > HISTORY_LIMIT ||
      !Array.isArray(saved.recentInvalid) ||
      saved.recentInvalid.length > 20 ||
      !saved.recentInvalid.every((value) => typeof value === 'boolean') ||
      ![
        saved.round,
        saved.depDecisions,
        saved.sampledTransitions,
        saved.consecutiveInvalid,
        saved.rng,
      ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      saved.rng > 0xffffffff
    )
      throw new Error('Checkpoint does not match the DEP-MPO environment');
    const next = new DepTrainer(saved.seed, saved.horizon, saved.brain);
    next.agent.restore(saved.learner);
    next.buffer.restore(saved.replay);
    for (const key of [
      'episodes',
      'invalidEpisodes',
      'invalidEvaluations',
      'actions',
      'learnedActions',
      'updates',
    ] as const) {
      if (!Number.isSafeInteger(saved.stats[key]) || saved.stats[key] < 0) {
        throw new Error('Invalid checkpoint counters');
      }
    }
    for (const value of [
      saved.stats.lastDistanceM,
      saved.stats.bestTrainingM,
      saved.stats.evaluationM,
      saved.stats.bestEvaluationM,
      saved.latestEvaluationSeconds,
      saved.bestEvaluationSeconds,
    ]) {
      if (value !== null && !Number.isFinite(value)) throw new Error('Invalid checkpoint score');
    }
    if (
      saved.stats.invalidEpisodes > saved.stats.episodes ||
      saved.stats.learnedActions > saved.stats.actions ||
      saved.depDecisions > saved.stats.actions ||
      saved.stats.updates !== saved.learner.updates ||
      saved.sampledTransitions !== saved.stats.updates * BATCH ||
      saved.replay.count > saved.stats.learnedActions ||
      (saved.bestPolicy === null) !== (saved.stats.bestEvaluationM === null)
    )
      throw new Error('Inconsistent checkpoint totals');
    if (saved.bestPolicy !== null) {
      const policy = new MpoPolicy(OBSERVATIONS.length, ACTIONS.length, () => 0.5);
      policy.restorePolicy(saved.bestPolicy);
    }
    saved.depStates.forEach((state, lane) => {
      if (state !== null) {
        const controller = new DepController(ACTIONS.length);
        controller.restore(state);
        next.depStates[lane] = controller.state();
      }
    });
    for (const key of Object.keys(emptyCapability()) as (keyof CapabilityReport)[]) {
      if (!Number.isFinite(saved.bestCapability[key]) || saved.bestCapability[key] < 0) {
        throw new Error('Invalid capability checkpoint');
      }
    }
    if (
      ![saved.gate.validEpisodes, saved.gate.invalidEpisodes].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      ![
        saved.gate.stableStanding,
        saved.gate.leftLift,
        saved.gate.rightLift,
        saved.gate.transfer,
        saved.gate.alternatingSteps,
        saved.gate.tailTorsoCounterRotation,
        saved.gate.passed,
      ].every((value) => typeof value === 'boolean')
    )
      throw new Error('Invalid capability gate');
    next.rng = saved.rng;
    next.round = saved.round;
    next.stats = { ...saved.stats };
    next.depDecisions = saved.depDecisions;
    next.sampledTransitions = saved.sampledTransitions;
    next.gate = combineGate(assessCapabilities([]), saved.gate);
    next.bestCapability = { ...saved.bestCapability };
    next.latestEvaluationSeconds = saved.latestEvaluationSeconds;
    next.bestEvaluationSeconds = saved.bestEvaluationSeconds;
    next.bestPolicy = saved.bestPolicy?.slice() ?? null;
    next.recentInvalid = [...saved.recentInvalid];
    next.consecutiveInvalid = saved.consecutiveInvalid;
    next.history = [...saved.history];
    next.lastPhysicsFault = saved.lastPhysicsFault;
    next.physicsFaultCounts = { ...saved.physicsFaultCounts };
    if (
      next.consecutiveInvalid >= 8 ||
      (next.recentInvalid.length === 20 && next.recentInvalid.filter(Boolean).length >= 10)
    ) {
      next.phase = 'blocked';
      next.message = 'Checkpoint was blocked by invalid physics.';
    }
    return next;
  }
}
