import seed from './seed-policy.json' with { type: 'json' };
import { boundPolicy, evaluate, PARAMETER_SCALE, POLICY_SIZE, TRIAL_SECONDS } from './servo-learning.mjs';

export const FORMAT = 'trex-continuous-v4';
export const STORAGE_KEY = 'made-by-marcel-trex-continuous-v4';
export const WAVE_SIZE = 16;
const MILESTONES = {
  stand: 'Standing independently',
  support: 'Balancing on one leg',
  step: 'First forward step',
  alternate: 'Four alternating steps',
  walk: 'Sustained walking',
};

export function achievements(m) {
  return [
    ...(m.settledTicks >= 600 ? ['stand'] : []),
    ...(m.supportTicks >= 120 ? ['support'] : []),
    ...(m.steps >= 1 ? ['step'] : []),
    ...(m.steps >= 4 ? ['alternate'] : []),
    ...(!m.fell && m.ticks >= TRIAL_SECONDS * 120 && m.steps >= 8 &&
    m.distance >= 2.4 && m.flightTicks <= m.ticks * 0.15 && m.slip <= m.distance * 0.3
      ? ['walk']
      : []),
  ];
}

export function milestoneLabel(key) {
  return MILESTONES[key];
}

export function emptyCheckpoint(randomSeed = 3) {
  const best = { iteration: 0, policy: seed.policy.slice(), metrics: { ...seed.metrics } };
  return {
    format: FORMAT,
    rng: randomSeed >>> 0 || 1,
    iteration: 0,
    stale: 0,
    best,
    records: Object.fromEntries(achievements(best.metrics).map((key) => [key, best])),
  };
}

export const assess = (policy) => evaluate(policy);

function random(state) {
  let value = state.rng;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rng = value >>> 0;
  return state.rng / 4294967296;
}

// Perturb only a few physically meaningful parameters at once. All candidates descend
// from the same retained policy; stagnant waves widen exploration without forgetting it.
export function propose(checkpoint) {
  if (checkpoint.iteration > Number.MAX_SAFE_INTEGER - WAVE_SIZE) {
    throw new Error('Candidate limit reached.');
  }
  const state = { ...checkpoint };
  const candidates = [];
  const centre = state.best.policy;
  const exploration = Math.min(2.5, 1 + state.stale / 12);
  for (let pair = 0; pair < WAVE_SIZE / 2; pair++) {
    const direction = Array(POLICY_SIZE).fill(0);
    const count = 1 + Math.floor(random(state) * 3);
    for (let i = 0; i < count; i++) {
      const j = Math.floor(random(state) * POLICY_SIZE);
      direction[j] += (random(state) - 0.5) * PARAMETER_SCALE[j];
    }
    const noise = exploration * (pair % 4 === 0 ? 2 : 0.65);
    for (const sign of [1, -1]) {
      candidates.push({
        iteration: checkpoint.iteration + candidates.length + 1,
        policy: boundPolicy(centre.map((w, j) => w + sign * noise * direction[j])),
      });
    }
  }
  return { rng: state.rng, candidates };
}

function fitness(m) {
  return m.score + (2 * m.stableTicks) / (TRIAL_SECONDS * 120) + (m.fell ? 0 : 5) + m.distance;
}

export function better(candidate, incumbent) {
  const a = candidate.metrics;
  const b = incumbent.metrics;
  const walkA = achievements(a).includes('walk');
  const walkB = achievements(b).includes('walk');
  if (walkA !== walkB) return walkA;
  return fitness(a) > fitness(b);
}

export function completeWave(state, wave, evaluations) {
  if (wave.candidates.length !== WAVE_SIZE || evaluations.length !== WAVE_SIZE) {
    throw new Error('Incomplete search wave.');
  }
  let best = state.best;
  const records = { ...state.records };
  for (const [i, candidate] of wave.candidates.entries()) {
    const entry = { ...candidate, metrics: evaluations[i] };
    if (better(entry, best)) best = entry;
    for (const key of achievements(entry.metrics)) {
      if (!records[key] || better(entry, records[key])) records[key] = entry;
    }
  }
  return {
    ...state,
    rng: wave.rng,
    iteration: state.iteration + WAVE_SIZE,
    stale: best === state.best ? state.stale + 1 : 0,
    best,
    records,
  };
}

const count = (x) => Number.isSafeInteger(x) && x >= 0;
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const metricKeys = Object.keys(seed.metrics).filter((key) => key !== 'fell');
const validEntry = (entry, max) =>
  object(entry) &&
  count(entry.iteration) &&
  entry.iteration <= max &&
  Array.isArray(entry.policy) &&
  entry.policy.length === POLICY_SIZE &&
  entry.policy.every(Number.isFinite) &&
  entry.policy.every((value, i) => boundPolicy(entry.policy)[i] === value) &&
  object(entry.metrics) &&
  typeof entry.metrics.fell === 'boolean' &&
  metricKeys.every((key) => Number.isFinite(entry.metrics[key])) &&
  count(entry.metrics.steps) &&
  count(entry.metrics.ticks) &&
  entry.metrics.ticks <= TRIAL_SECONDS * 120 &&
  entry.metrics.steps <= entry.metrics.ticks;

export function parseCheckpoint(source) {
  const state = JSON.parse(source);
  if (
    !object(state) ||
    state.format !== FORMAT ||
    !count(state.iteration) ||
    state.iteration % WAVE_SIZE !== 0 ||
    !count(state.rng) ||
    state.rng < 1 ||
    state.rng > 0xffffffff ||
    !count(state.stale) ||
    state.stale > state.iteration / WAVE_SIZE ||
    !validEntry(state.best, state.iteration) ||
    !object(state.records) ||
    !Object.entries(state.records).every(
      ([key, entry]) => Object.hasOwn(MILESTONES, key) &&
        validEntry(entry, state.iteration) && achievements(entry.metrics).includes(key),
    )
  ) {
    throw new Error('Invalid or incompatible locomotion checkpoint.');
  }
  return state;
}
