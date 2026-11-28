import { ACTIONS, OBSERVATIONS, BalanceEnvironment, seededRandom } from './balance-environment';
import type { EndReason } from './balance-environment';
import type { PhysicsSnapshot } from './passive-physics';
import { PpoAgent, advantages } from './ppo';
import type { InferenceState, Sample, TrainingSample } from './ppo';

export function distanceReward(previous: number, next: number, reason: EndReason): number | null {
  if (reason === 'invalid' || !Number.isFinite(previous) || !Number.isFinite(next)) return null;
  return reason === 'fall' ? 0 : next - previous;
}

export interface RolloutJob {
  readonly round: number;
  readonly lane: number;
  readonly seed: number;
  readonly horizon: number;
  readonly correlation: number;
  readonly policy: InferenceState;
  readonly minimumActions: number;
  // Used only for matched-budget diagnostics. An unfinished episode is discarded.
  readonly exactBudget: boolean;
}

export interface RolloutView {
  readonly distanceM: number;
  readonly elapsed: number;
  readonly reason: EndReason;
  readonly snapshot: PhysicsSnapshot;
}

export interface RolloutProgress {
  readonly round: number;
  readonly lane: number;
  readonly attempts: number;
  readonly view: RolloutView;
}

export interface CompletedRollout {
  readonly actions: number;
  readonly distanceM: number | null;
  readonly elapsed: number;
  readonly reason: EndReason;
  readonly samples: readonly TrainingSample[];
}

export interface RolloutResult {
  readonly round: number;
  readonly lane: number;
  readonly attempts: number;
  readonly episodes: readonly CompletedRollout[];
  readonly view: RolloutView;
}

// Independent deterministic seed streams for body resets and action noise.
// One frozen actor/critic for the entire collection round. Production
// collectors complete episodes even when the nominal action budget is met.
export function collectRollouts(
  job: RolloutJob,
  progress?: (event: RolloutProgress) => void,
): RolloutResult {
  const resetRandom = seededRandom((job.seed ^ 0x6a09e667) >>> 0);
  const actionRandom = seededRandom((job.seed ^ 0xbb67ae85) >>> 0);
  const agent = new PpoAgent(OBSERVATIONS.length, ACTIONS.length, actionRandom, job.correlation);
  agent.restoreInference(job.policy);
  const env = new BalanceEnvironment(job.horizon, true);
  const reset = () => env.reset(Math.floor(resetRandom() * 4294967296));
  let state = reset();
  let distanceM = 0;
  let attempts = 0;
  const episodes: CompletedRollout[] = [];
  const view = (): RolloutView => ({
    distanceM,
    elapsed: state.elapsed,
    reason: state.reason,
    snapshot: env.snapshot(),
  });
  while (attempts < job.minimumActions && episodes.length < job.minimumActions + 8) {
    if (episodes.length) state = reset();
    distanceM = 0;
    const samples: Sample[] = [];
    const start = attempts;
    while (state.reason === 'running' && state.observation) {
      if (job.exactBudget && attempts >= job.minimumActions) break;
      const observation = state.observation;
      const decision = agent.sample(observation, samples.at(-1));
      const next = env.step(decision.action);
      const reward = distanceReward(state.forwardPositionM, next.forwardPositionM, next.reason);
      state = next;
      attempts++;
      if (reward !== null) {
        distanceM += reward;
        samples.push({
          observation,
          latent: decision.latent,
          history: decision.history,
          logProbability: decision.logProbability,
          value: decision.value,
          reward,
        });
      }
      if (progress && attempts % 8 === 0) {
        progress({ round: job.round, lane: job.lane, attempts, view: view() });
      }
    }
    if (state.reason === 'running') break;
    const invalid = state.reason === 'invalid' || !state.observation;
    const bootstrap = !invalid && state.truncated ? agent.value(state.observation!) : 0;
    episodes.push({
      actions: attempts - start,
      distanceM: invalid ? null : distanceM,
      elapsed: state.elapsed,
      reason: state.reason,
      samples: invalid ? [] : advantages(samples, bootstrap),
    });
  }
  return { round: job.round, lane: job.lane, attempts, episodes, view: view() };
}

export function evaluateFrozenPolicy(
  policy: InferenceState,
  seeds: readonly number[],
  horizon: number,
): { distanceM: number | null; elapsed: number; reason: EndReason }[] {
  const agent = new PpoAgent(OBSERVATIONS.length, ACTIONS.length, seededRandom(0));
  agent.restoreInference(policy);
  const env = new BalanceEnvironment(horizon, true);
  return seeds.map((seed) => {
    let state = env.reset(seed);
    let distanceM = 0;
    while (state.reason === 'running' && state.observation) {
      const next = env.step(agent.action(state.observation));
      const reward = distanceReward(state.forwardPositionM, next.forwardPositionM, next.reason);
      if (reward !== null) distanceM += reward;
      state = next;
    }
    return {
      distanceM: state.reason === 'invalid' ? null : distanceM,
      elapsed: state.elapsed,
      reason: state.reason,
    };
  });
}
