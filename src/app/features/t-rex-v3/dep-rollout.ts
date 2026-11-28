import { ACTIONS, OBSERVATIONS, BalanceEnvironment, seededRandom } from './balance-environment';
import type { EndReason, PhysicsFault, PhysicsResolution } from './balance-environment';
import { CapabilityAudit } from './capability-audit';
import type { CapabilityReport } from './capability-audit';
import { DepController, depSensors } from './dep-controller';
import type { DepState } from './dep-controller';
import { MpoPolicy } from './mpo';
import { nStepExperiences } from './replay-buffer';
import type { Experience } from './replay-buffer';
import { distanceReward } from './rollout-collection';
import type { RolloutProgress, RolloutView } from './rollout-collection';

export const DEP_INTERVENTION_LENGTH = 4;
// Adapted for 30 Hz and ~20-decision early V3 episodes. The original
// ostrich probability was 0.0004; this is a documented experiment.
export const DEP_INTERVENTION_PROBABILITY = 0.02;

export interface DepJob {
  readonly brain: 'dep' | 'dep-mpo';
  readonly round: number;
  readonly lane: number;
  readonly seed: number;
  readonly horizon: number;
  readonly minimumActions: number;
  readonly exactBudget: boolean;
  readonly exploration: 'dep' | 'mixed' | 'iid' | 'zero';
  readonly depState: DepState | null;
  readonly policy: readonly number[] | null;
  readonly physics?: PhysicsResolution;
}

export interface DepEpisode {
  readonly actions: number;
  readonly depActions: number;
  readonly distanceM: number | null;
  readonly elapsed: number;
  readonly reason: EndReason;
  readonly capability: CapabilityReport;
  readonly experiences: readonly Experience[];
  readonly physicsFault?: PhysicsFault;
}

export interface DepResult {
  readonly brain: 'dep' | 'dep-mpo';
  readonly round: number;
  readonly lane: number;
  readonly attempts: number;
  readonly depAttempts: number;
  readonly episodes: readonly DepEpisode[];
  readonly depState: DepState;
  readonly view: RolloutView;
}

export interface FailureWitness {
  readonly resetSeed: number;
  readonly actions: readonly (readonly number[])[];
  readonly fault: PhysicsFault;
}

// One controller per lane; preserve its learned C and bias between valid
// episodes, but clear finite differences across resets. Discard both replay
// and DEP adaptation from invalid or unfinished benchmark episodes.
export function collectDepRollouts(
  job: DepJob,
  progress?: (event: RolloutProgress) => void,
  captureFailure?: (witness: FailureWitness) => void,
): DepResult {
  const resetRandom = seededRandom((job.seed ^ 0x6a09e667) >>> 0);
  const actionRandom = seededRandom((job.seed ^ 0xbb67ae85) >>> 0);
  const switchRandom = seededRandom((job.seed ^ 0x3c6ef372) >>> 0);
  const controller = new DepController(ACTIONS.length);
  if (job.depState) controller.restore(job.depState);
  const policy =
    job.exploration === 'mixed'
      ? new MpoPolicy(OBSERVATIONS.length, ACTIONS.length, actionRandom)
      : null;
  if (policy) {
    if (!job.policy) throw new Error('Missing frozen MPO policy');
    policy.restorePolicy(job.policy);
  }
  const env = new BalanceEnvironment(job.horizon, true, job.physics);
  let resetSeed = 0;
  const reset = () => {
    resetSeed = Math.floor(resetRandom() * 4294967296);
    return env.reset(resetSeed);
  };
  let state = reset();
  let distanceM = 0;
  let attempts = 0;
  let depAttempts = 0;
  const episodes: DepEpisode[] = [];
  const view = (): RolloutView => ({
    distanceM,
    elapsed: state.elapsed,
    reason: state.reason,
    snapshot: env.snapshot(),
  });
  while (attempts < job.minimumActions && episodes.length < job.minimumActions + 8) {
    if (episodes.length) state = reset();
    controller.resetHistory();
    const before = controller.state();
    const audit = new CapabilityAudit();
    audit.observe(state, env.snapshot());
    distanceM = 0;
    let remaining = 0;
    let depActions = 0;
    const start = attempts;
    const experiences: Experience[] = [];
    const trace: number[][] = [];
    while (state.reason === 'running' && state.observation) {
      if (job.exactBudget && attempts >= job.minimumActions) break;
      const observation = state.observation;
      let source: Experience['source'] = 'policy';
      let action: number[];
      if (job.exploration === 'zero') {
        action = ACTIONS.map(() => 0);
      } else if (job.exploration === 'iid') {
        action = ACTIONS.map(() => {
          const radius = Math.sqrt(-2 * Math.log(Math.max(1e-12, actionRandom())));
          return Math.tanh(0.45 * radius * Math.cos(2 * Math.PI * actionRandom()));
        });
      } else {
        // DEP keeps adapting to the real body even during policy control.
        const proposal = controller.step(depSensors(observation));
        if (
          job.exploration === 'mixed' &&
          remaining === 0 &&
          switchRandom() < DEP_INTERVENTION_PROBABILITY
        )
          remaining = DEP_INTERVENTION_LENGTH;
        if (job.exploration === 'dep' || remaining > 0) {
          source = 'dep';
          action = proposal;
          depActions++;
          depAttempts++;
          remaining = Math.max(0, remaining - 1);
        } else {
          action = policy!.action(observation, true);
        }
      }
      if (captureFailure) trace.push(action.slice());
      const next = env.step(action);
      const reward = distanceReward(state.forwardPositionM, next.forwardPositionM, next.reason);
      state = next;
      attempts++;
      if (reward !== null && next.observation) {
        distanceM += reward;
        experiences.push({
          observation,
          action,
          nextObservation: next.observation,
          reward,
          discount: next.terminated ? 0 : 1,
          source,
        });
      }
      audit.observe(state, env.snapshot());
      if (progress && attempts % 8 === 0) {
        progress({ round: job.round, lane: job.lane, attempts, view: view() });
      }
    }
    if (state.reason === 'running') {
      controller.restore(before);
      break;
    }
    const invalid = state.reason === 'invalid' || !state.observation;
    if (invalid) {
      controller.restore(before);
      if (state.physicsFault) captureFailure?.({ resetSeed, actions: trace, fault: state.physicsFault });
    }
    episodes.push({
      actions: attempts - start,
      depActions,
      distanceM: invalid ? null : distanceM,
      elapsed: state.elapsed,
      reason: state.reason,
      capability: audit.report(state),
      experiences: invalid ? [] : nStepExperiences(experiences),
      ...(state.physicsFault ? { physicsFault: state.physicsFault } : {}),
    });
  }
  return {
    brain: job.brain,
    round: job.round,
    lane: job.lane,
    attempts,
    depAttempts,
    episodes,
    depState: controller.state(),
    view: view(),
  };
}
