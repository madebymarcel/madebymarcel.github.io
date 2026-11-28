import { DIRECTIONS, perturb, updateWeights } from './v2-ars.mjs';
import { evaluate, passed } from './v2-learning.mjs';
import { activeParameters, POLICY_SIZE } from './v2-policy.mjs';

export const FORMAT = 'trex-v2-ars-1';
export const MODES = ['planar', 'spatial'];
export const TRAIN_STARTS = [
  { startSplit: 0.045, friction: 0.85 },
  { startSplit: -0.04, friction: 0.9 },
  { startSplit: 0.055, friction: 0.8, lateralVelocity: 0.015 },
];
export const TEST_STARTS = [
  { startSplit: 0.035, friction: 0.87 },
  { startSplit: -0.05, friction: 0.82, lateralVelocity: -0.025 },
  { startSplit: 0.06, friction: 0.93, lateralVelocity: 0.025 },
];
export const HOLDOUT_STARTS = [
  { startSplit: -0.065, friction: 0.76, lateralVelocity: 0.04 },
  { startSplit: 0.025, friction: 0.96, lateralVelocity: -0.04 },
];

export const storageKey = (mode) => 'made-by-marcel-trex-v2-ars-' + mode;

export function emptyCheckpoint(mode, seed = 3, initialWeights) {
  if (!MODES.includes(mode)) throw new Error('Invalid mode.');
  const active = activeParameters(mode);
  const weights = Array.from({ length: POLICY_SIZE }, (_, i) =>
    active[i] ? (initialWeights?.[i] ?? 0) : 0,
  );
  return {
    format: FORMAT,
    mode,
    rng: seed >>> 0 || 1,
    iteration: 0,
    rollouts: 0,
    evaluationRollouts: 0,
    weights,
    best: null,
  };
}

export function propose(state) {
  const wave = perturb(state.weights, activeParameters(state.mode), state.rng);
  return { ...wave, start: TRAIN_STARTS[state.iteration % TRAIN_STARTS.length] };
}

export function advanceWeights(state, wave, rewards) {
  return {
    ...state,
    rng: wave.rng,
    iteration: state.iteration + 1,
    rollouts: state.rollouts + 2 * DIRECTIONS,
    weights: updateWeights(state.weights, wave.directions, rewards),
  };
}

export function assessment(weights, mode, starts = TEST_STARTS) {
  const trials = starts.map((start) => evaluate(weights, mode, start));
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return {
    trials,
    passes: trials.filter(passed).length,
    medianDistance: median(trials.map((m) => m.distance)),
    medianScore: median(trials.map((m) => m.score)),
  };
}

export function better(a, b) {
  if (!b) return true;
  if (a.passes !== b.passes) return a.passes > b.passes;
  if (a.passes > 0 && a.medianDistance !== b.medianDistance) {
    return a.medianDistance > b.medianDistance;
  }
  if (a.medianScore !== b.medianScore) return a.medianScore > b.medianScore;
  return a.medianDistance > b.medianDistance;
}

export function recordEvaluation(state, evaluation) {
  const best = better(evaluation, state.best?.evaluation)
    ? { iteration: state.iteration, policy: state.weights.slice(), evaluation }
    : state.best;
  return {
    ...state,
    best,
    evaluationRollouts: state.evaluationRollouts + evaluation.trials.length,
  };
}

const validPolicy = (p) =>
  Array.isArray(p) &&
  p.length === POLICY_SIZE &&
  p.every((x) => Number.isFinite(x) && Math.abs(x) <= 8);
const count = (x) => Number.isSafeInteger(x) && x >= 0;
const validMetric = (m) =>
  m &&
  typeof m.fell === 'boolean' &&
  ['ticks', 'steps', 'flightTicks', 'stableTicks'].every((key) => count(m[key])) &&
  ['distance', 'slip', 'work', 'lateralDistance', 'score'].every((key) => Number.isFinite(m[key]));
const validEvaluation = (e) =>
  e &&
  Array.isArray(e.trials) &&
  e.trials.length === TEST_STARTS.length &&
  e.trials.every(validMetric) &&
  e.passes === e.trials.filter(passed).length &&
  Number.isFinite(e.medianDistance) &&
  Number.isFinite(e.medianScore);

export function parseCheckpoint(source, mode) {
  const s = JSON.parse(source);
  if (
    s?.format !== FORMAT ||
    s.mode !== mode ||
    !count(s.iteration) ||
    !count(s.rollouts) ||
    s.rollouts !== s.iteration * 2 * DIRECTIONS ||
    !count(s.evaluationRollouts) ||
    !count(s.rng) ||
    s.rng < 1 ||
    s.rng > 0xffffffff ||
    !validPolicy(s.weights) ||
    (s.best !== null &&
      (!count(s.best?.iteration) ||
        s.best.iteration > s.iteration ||
        !validPolicy(s.best.policy) ||
        !validEvaluation(s.best.evaluation)))
  ) {
    throw new Error('Invalid V2 checkpoint.');
  }
  return s;
}
