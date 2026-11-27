import seed from './seed-policy.json' with { type: 'json' };
import {
  boundPolicy,
  evaluate,
  GAIT_DEFAULTS,
  PARAMETER_SCALE,
  POLICY_SIZE,
  TRIAL_SECONDS,
} from './servo-learning.mjs';

export const FORMAT = 'trex-population-v5';
// Keep the storage key so existing browsers discover and migrate their v4 checkpoint.
export const STORAGE_KEY = 'made-by-marcel-trex-continuous-v4';
export const WAVE_SIZE = 16;
export const POPULATION_SIZE = 8;
const MILESTONES = {
  stand: 'Standing independently',
  support: 'Balancing on one leg',
  step: 'First forward step',
  alternate: 'Four alternating steps',
  walk: 'Sustained walking',
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const VARIATIONS = [
  { seconds: 6, startSplit: 0.04 },
  { seconds: 6, startSplit: 0.05, lateralVelocity: 0.015 },
];

function walkingTrial(m, seconds) {
  return (
    !m.fell &&
    m.ticks >= seconds * 120 &&
    m.stableTicks >= m.ticks * 0.85 &&
    m.steps >= Math.ceil(seconds * 0.67) &&
    m.distance >= seconds * 0.3 &&
    m.flightTicks <= m.ticks * 0.15 &&
    m.slip <= m.distance * 0.3
  );
}

export function achievements(m, trials = []) {
  return [
    ...(m.settledTicks >= 600 ? ['stand'] : []),
    ...(m.supportTicks >= 120 ? ['support'] : []),
    ...(m.steps >= 1 ? ['step'] : []),
    ...(m.steps >= 4 ? ['alternate'] : []),
    ...(walkingTrial(m, TRIAL_SECONDS) &&
    trials.length === VARIATIONS.length &&
    trials.every((trial, i) => walkingTrial(trial, VARIATIONS[i].seconds))
      ? ['walk']
      : []),
  ];
}

export function milestoneLabel(key) {
  return MILESTONES[key];
}

// Fixed, comparable evaluations. Shorter disturbed trials are normalized to the
// reference duration; early falls remain penalized rather than averaging only survivors.
export function robustFitness(metrics, trials) {
  const scores = trials.map((m, i) => (m.score * TRIAL_SECONDS) / VARIATIONS[i].seconds);
  return 0.45 * metrics.score + 0.25 * scores[0] + 0.25 * scores[1] + 0.05 * Math.min(...scores);
}

export function assess(policy) {
  const metrics = evaluate(policy, { seconds: TRIAL_SECONDS });
  const trials = VARIATIONS.map((options) => evaluate(policy, options));
  return { metrics, trials, fitness: robustFitness(metrics, trials) };
}

function seedEntry() {
  return {
    iteration: 0,
    policy: seed.policy.slice(),
    metrics: { ...seed.metrics },
    trials: seed.trials.map((m) => ({ ...m })),
    fitness: robustFitness(seed.metrics, seed.trials),
  };
}

function collectRecords(entries, previous = {}) {
  const records = { ...previous };
  for (const entry of entries) {
    for (const key of achievements(entry.metrics, entry.trials)) {
      if (!records[key] || entry.fitness > records[key].fitness) records[key] = entry;
    }
  }
  return records;
}

export function emptyCheckpoint(randomSeed = 3) {
  const best = seedEntry();
  return {
    format: FORMAT,
    rng: randomSeed >>> 0 || 1,
    iteration: 0,
    stale: 0,
    mutationScale: 0.12,
    successRate: 0,
    best,
    population: [best],
    records: collectRecords([best]),
  };
}

function random(state) {
  let value = state.rng;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rng = value >>> 0;
  return state.rng / 4294967296;
}

function separation(a, b) {
  return Math.sqrt(
    a.policy.reduce((sum, w, i) => sum + ((w - b.policy[i]) / PARAMETER_SCALE[i]) ** 2, 0),
  );
}

function bestBy(entries, score) {
  return entries.reduce((best, entry) => (score(entry) > score(best) ? entry : best));
}

function scenarios(entry) {
  return [entry.metrics, ...entry.trials];
}

function rates(entry, measure) {
  return scenarios(entry).map(
    (m, i) =>
      (measure(m) * 120) / (i === 0 ? TRIAL_SECONDS * 120 : VARIATIONS[i - 1].seconds * 120),
  );
}

const progress = (m) => m.forwardUpright;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

// Quality-diversity archive: preserve leaders for complementary physical abilities,
// not eight near-identical copies of the same winning score.
export function selectPopulation(entries, champion) {
  const unique = new Map();
  for (const entry of [champion, ...entries]) {
    const key = entry.policy.join(',');
    if (!unique.has(key)) unique.set(key, entry);
  }
  const pool = [...unique.values()];
  const selected = [champion];
  const add = (entry) => {
    if (!selected.some((other) => separation(other, entry) < 1e-9)) selected.push(entry);
  };
  const objectives = [
    (e) => e.fitness,
    (e) => Math.min(...rates(e, progress)),
    (e) => e.metrics.forwardUpright,
    (e) => mean(rates(e, (m) => m.forwardUpright - 1.5 * m.slip)),
    (e) => mean(rates(e, (m) => m.stableTicks / 120 + m.forwardUpright)),
    (e) => mean(rates(e, (m) => m.supportTotal / 120 + m.forwardUpright)),
    (e) =>
      e.metrics.steps > 0
        ? (e.metrics.forwardUpright / e.metrics.steps) * (e.metrics.stableTicks / 1440)
        : -1,
  ];
  for (const objective of objectives) add(bestBy(pool, objective));
  // Fill spare niches with useful explorers rather than maximizing diversity among failures.
  const ranked = pool
    .filter((entry) => entry.fitness >= 0 && entry.metrics.distance >= 0)
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, 24);
  while (selected.length < POPULATION_SIZE) {
    const remaining = ranked.filter(
      (entry) =>
        !selected.includes(entry) && selected.every((other) => separation(entry, other) >= 1e-9),
    );
    if (!remaining.length) break;
    add(
      bestBy(remaining, (entry) => Math.min(...selected.map((other) => separation(entry, other)))),
    );
  }
  return selected.slice(0, POPULATION_SIZE);
}

// Tiny paired mutations exploit the champion. Other archive parents explore
// different basins; broad mutations and recombination never replace the champion directly.
export function propose(checkpoint) {
  if (checkpoint.iteration > Number.MAX_SAFE_INTEGER - WAVE_SIZE) {
    throw new Error('Candidate limit reached.');
  }
  const state = { ...checkpoint };
  const candidates = [];
  const parents = state.population;
  for (let pair = 0; pair < WAVE_SIZE / 2; pair++) {
    const parent =
      pair < 2
        ? state.best
        : parents[(Math.floor(state.iteration / WAVE_SIZE) + pair - 2) % parents.length];
    const direction = Array(POLICY_SIZE).fill(0);
    const count = 1 + Math.floor(random(state) * (pair >= 6 ? 6 : 3));
    for (let i = 0; i < count; i++) {
      const j = Math.floor(random(state) * POLICY_SIZE);
      direction[j] += (random(state) - 0.5) * PARAMETER_SCALE[j];
    }
    const local = pair < 6;
    const noise =
      pair === 0
        ? state.mutationScale * 0.1
        : pair === 1
          ? state.mutationScale * 0.5
          : local
            ? state.mutationScale
            : pair === 6
              ? 0.3
              : 0.8;
    let centre = parent.policy;
    if (pair === 7 && parents.length > 1) {
      const other = parents[Math.floor(random(state) * parents.length)];
      const mix = random(state) * 0.35;
      centre = centre.map((w, i) => w + mix * (other.policy[i] - w));
    }
    for (const sign of [1, -1]) {
      candidates.push({
        iteration: checkpoint.iteration + candidates.length + 1,
        policy: boundPolicy(centre.map((w, i) => w + sign * noise * direction[i])),
        parent: parent.iteration,
        local,
      });
    }
  }
  return { rng: state.rng, candidates };
}

// Replay selection protects the existing demonstrated motion. Robustness is a
// tie-breaker, not a reason to display a stationary or much shorter trial.
export function better(candidate, incumbent) {
  const a = candidate.metrics;
  const b = incumbent.metrics;
  const walkA = achievements(a, candidate.trials).includes('walk');
  const walkB = achievements(b, incumbent.trials).includes('walk');
  if (walkA !== walkB) return walkA;
  if (!b.fell && a.fell) return false;
  if (a.distance < b.distance - 0.05 || a.stableTicks < b.stableTicks - 120) return false;
  return a.score + 0.1 * candidate.fitness > b.score + 0.1 * incumbent.fitness;
}

export function completeWave(state, wave, evaluations) {
  if (wave.candidates.length !== WAVE_SIZE || evaluations.length !== WAVE_SIZE) {
    throw new Error('Incomplete search wave.');
  }
  let best = state.best;
  const parents = new Map(state.population.map((entry) => [entry.iteration, entry]));
  let attempts = 0;
  let successes = 0;
  const entries = wave.candidates.map(({ iteration, policy, parent, local }, i) => {
    const entry = { iteration, policy, ...evaluations[i] };
    if (better(entry, best)) best = entry;
    if (local) {
      attempts++;
      if (entry.fitness > parents.get(parent).fitness) successes++;
    }
    return entry;
  });
  const successRate = attempts ? successes / attempts : 0;
  const mutationScale = clamp(state.mutationScale * (successRate > 0.2 ? 1.12 : 0.86), 0.005, 0.6);
  return {
    ...state,
    rng: wave.rng,
    iteration: state.iteration + WAVE_SIZE,
    stale: best === state.best ? state.stale + 1 : 0,
    mutationScale,
    successRate,
    best,
    population: selectPopulation([...state.population, ...entries], best),
    records: collectRecords(entries, state.records),
  };
}

const count = (x) => Number.isSafeInteger(x) && x >= 0;
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const metricKeys = Object.keys(seed.metrics).filter((key) => key !== 'fell');
const validPolicy = (policy, length) =>
  Array.isArray(policy) &&
  policy.length === length &&
  policy.every(Number.isFinite) &&
  boundPolicy(policy).every((value, i) => value === policy[i]);

const validMetrics = (m, seconds) =>
  object(m) &&
  typeof m.fell === 'boolean' &&
  metricKeys.every((key) => Number.isFinite(m[key])) &&
  count(m.steps) &&
  count(m.ticks) &&
  m.ticks <= seconds * 120 &&
  m.steps <= m.ticks;

const validEntry = (entry, max) =>
  object(entry) &&
  count(entry.iteration) &&
  entry.iteration <= max &&
  validPolicy(entry.policy, POLICY_SIZE) &&
  validMetrics(entry.metrics, TRIAL_SECONDS) &&
  Array.isArray(entry.trials) &&
  entry.trials.length === VARIATIONS.length &&
  entry.trials.every((m, i) => validMetrics(m, VARIATIONS[i].seconds)) &&
  Number.isFinite(entry.fitness) &&
  Math.abs(entry.fitness - robustFitness(entry.metrics, entry.trials)) < 1e-8;

const validBase = (state) =>
  object(state) &&
  count(state.iteration) &&
  state.iteration % WAVE_SIZE === 0 &&
  count(state.rng) &&
  state.rng > 0 &&
  state.rng <= 0xffffffff &&
  count(state.stale) &&
  state.stale <= state.iteration / WAVE_SIZE &&
  object(state.records);

export function migrateCheckpoint(state) {
  if (!validBase(state) || state.format !== 'trex-continuous-v4') {
    throw new Error('Invalid legacy checkpoint.');
  }
  const oldEntries = [state.best, ...Object.values(state.records)];
  if (
    !oldEntries.every(
      (entry) =>
        object(entry) &&
        count(entry.iteration) &&
        entry.iteration <= state.iteration &&
        validPolicy(entry.policy, 28),
    )
  ) {
    throw new Error('Invalid legacy policy.');
  }
  const evaluated = new Map();
  const entries = oldEntries.map(({ iteration, policy: oldPolicy }) => {
    const policy = [...oldPolicy, ...GAIT_DEFAULTS];
    const key = policy.join(',');
    if (!evaluated.has(key)) evaluated.set(key, assess(policy));
    return { iteration, policy, ...evaluated.get(key) };
  });
  const best = entries[0];
  const all = [best, ...entries.slice(1), seedEntry()];
  return {
    ...emptyCheckpoint(state.rng),
    iteration: state.iteration,
    best,
    population: selectPopulation(all, best),
    records: collectRecords(all),
  };
}

export function parseCheckpoint(source) {
  const state = JSON.parse(source);
  if (state?.format === 'trex-continuous-v4') return migrateCheckpoint(state);
  if (
    !validBase(state) ||
    state.format !== FORMAT ||
    !validEntry(state.best, state.iteration) ||
    !Number.isFinite(state.mutationScale) ||
    state.mutationScale < 0.005 ||
    state.mutationScale > 0.6 ||
    !Number.isFinite(state.successRate) ||
    state.successRate < 0 ||
    state.successRate > 1 ||
    !Array.isArray(state.population) ||
    !state.population.length ||
    state.population.length > POPULATION_SIZE ||
    !state.population.every((entry) => validEntry(entry, state.iteration)) ||
    !state.population.some(
      (entry) => entry.iteration === state.best.iteration && separation(entry, state.best) < 1e-9,
    ) ||
    !Object.entries(state.records).every(
      ([key, entry]) =>
        Object.hasOwn(MILESTONES, key) &&
        validEntry(entry, state.iteration) &&
        achievements(entry.metrics, entry.trials).includes(key),
    )
  ) {
    throw new Error('Invalid or incompatible locomotion checkpoint.');
  }
  return state;
}
