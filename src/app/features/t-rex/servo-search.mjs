import seed from './seed-policy.json' with { type: 'json' };
import {
  boundPolicy,
  distanceScore,
  evaluate,
  expandPolicy,
  GAIT_DEFAULTS,
  LEGACY_POLICY_SIZE,
  PARAMETER_SCALE,
  POLICY_SIZE,
  TRIAL_SECONDS,
} from './servo-learning.mjs';

export const FORMAT = 'trex-population-v7';
// Keep the storage key so existing browsers discover and migrate their checkpoints.
export const STORAGE_KEY = 'made-by-marcel-trex-continuous-v4';
export const WAVE_SIZE = 16;
export const POPULATION_SIZE = 8;
const LINEAGE_COUNT = 4;
const INITIAL_SCALE = 0.2;
const MIN_SCALE = 0.08;
const MAX_SCALE = 1.5;
const RESTART_AFTER = 8;
const MIN_SEPARATION = 0.35;
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
    policy: expandPolicy(seed.policy),
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
    mutationScale: INITIAL_SCALE,
    successRate: 0,
    best,
    population: [best],
    lineages: initializeLineages([best], best),
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

// Actual forward landings distinguish walking from sliding.
const progress = (m) => Math.max(0, Math.min(m.distance, m.forwardUpright));
const walkingDistance = (m) => (m.steps > 0 ? progress(m) : 0);
const precursor = (m) => (m.steps > 0 ? progress(m) : 0.1 * progress(m));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const robustProgress = (entry) => Math.min(...rates(entry, walkingDistance));
const objectives = [
  (entry) => walkingDistance(entry.metrics),
  robustProgress,
  (entry) => mean(rates(entry, precursor)),
  (entry) => precursor(entry.metrics) + 0.2 * mean(rates(entry, precursor)),
];

function lineageBetter(candidate, incumbent, index) {
  if (index === 0) return better(candidate, incumbent);
  const a = objectives[index](candidate);
  const b = objectives[index](incumbent);
  return a > b + 1e-8 || (Math.abs(a - b) <= 1e-8 && candidate.fitness > incumbent.fitness);
}

function distinct(entries) {
  return [...new Map(entries.map((entry) => [entry.policy.join(','), entry])).values()];
}

// Preserve distinct viable strategies, a robust leader and the distance champion.
export function selectPopulation(entries, champion) {
  const pool = distinct([champion, ...entries]);
  const selected = [champion];
  const robust = bestBy(pool, robustProgress);
  if (separation(robust, champion) >= 1e-9) selected.push(robust);
  const viable = pool.filter((entry) => entry.metrics.distance > 0 && entry.fitness >= 0);
  while (selected.length < POPULATION_SIZE) {
    const remaining = viable.filter((entry) =>
      selected.every((other) => separation(entry, other) >= MIN_SEPARATION),
    );
    if (!remaining.length) break;
    const novelty = (entry) => Math.min(...selected.map((other) => separation(entry, other)));
    selected.push(bestBy(remaining, (entry) => novelty(entry) + 0.1 * precursor(entry.metrics)));
  }
  return selected;
}

function initializeLineages(entries, champion) {
  const pool = selectPopulation(entries, champion);
  const used = [champion];
  return Array.from({ length: LINEAGE_COUNT }, (_, index) => {
    const alternatives = pool.filter((entry) =>
      used.every((other) => separation(entry, other) >= MIN_SEPARATION),
    );
    const entry =
      index === 0 || !alternatives.length ? champion : bestBy(alternatives, objectives[index]);
    if (index > 0) used.push(entry);
    return { entry, scale: INITIAL_SCALE, stale: 0 };
  });
}

// Overlapping groups allow coordinated changes to balance, propulsion, swing and tail.
const GROUPS = [
  [0, 1, 2, 3, 9, 10, 31, 32, 33, 34, 35, 36, 51],
  [4, 5, 6, 7, 8, 19, 20, 21, 41, 42, 43],
  [11, 12, 13, 14, 28, 29, 37, 38, 39, 40, 44],
  [15, 16, 17, 18, 28, 30, 44, 45, 46],
  [22, 23, 24, 25, 26, 27, 41, 47, 48, 49, 50],
];

function direction(state, broad) {
  const group = GROUPS[Math.floor(random(state) * GROUPS.length)];
  const second = GROUPS[Math.floor(random(state) * GROUPS.length)];
  const indices = broad ? new Set([...group, ...second]) : new Set(group);
  const shared = 2 * random(state) - 1;
  return PARAMETER_SCALE.map((scale, index) => {
    if (!indices.has(index)) return 0;
    return scale * (0.35 * shared + 0.65 * (2 * random(state) - 1));
  });
}

export function propose(checkpoint) {
  if (checkpoint.iteration > Number.MAX_SAFE_INTEGER - WAVE_SIZE) {
    throw new Error('Candidate limit reached.');
  }
  const state = { ...checkpoint };
  const candidates = [];
  for (const [lineage, island] of state.lineages.entries()) {
    const parent = island.entry;
    const stalled = Math.max(island.stale, lineage === 0 ? state.stale : 0);
    const restart = lineage !== 0 && island.stale >= RESTART_AFTER;
    for (let pair = 0; pair < 2; pair++) {
      const broad = pair === 1 || stalled >= 4;
      const delta = direction(state, broad);
      const scale = broad
        ? Math.max(0.45, island.scale, Math.min(MAX_SCALE, 0.15 * stalled))
        : island.scale * 0.5;
      let centre = parent.policy;
      if (restart && pair === 1) {
        const archive = distinct([
          ...state.population,
          ...state.lineages.map((item) => item.entry),
        ]);
        const alternatives = archive.filter((entry) => separation(entry, parent) >= MIN_SEPARATION);
        const other = alternatives.length
          ? alternatives[Math.floor(random(state) * alternatives.length)]
          : seedEntry();
        centre = other.policy;
      } else if (pair === 1 && lineage !== 0 && random(state) < 0.35) {
        const other = state.lineages[Math.floor(random(state) * LINEAGE_COUNT)].entry;
        const mix = 0.2 + 0.5 * random(state);
        centre = centre.map((value, index) => value + mix * (other.policy[index] - value));
      }
      for (const sign of [1, -1]) {
        candidates.push({
          iteration: checkpoint.iteration + candidates.length + 1,
          policy: boundPolicy(centre.map((value, index) => value + sign * scale * delta[index])),
          parent: parent.iteration,
          local: !broad,
          lineage,
        });
      }
    }
  }
  return { rng: state.rng, candidates };
}

// Replay the furthest physically walking policy, regardless of shaped score.
// Robust performance remains a separate archive objective.
export function better(candidate, incumbent) {
  const a = walkingDistance(candidate.metrics);
  const b = walkingDistance(incumbent.metrics);
  if (Math.abs(a - b) > 1e-8) return a > b;
  const walkA = achievements(candidate.metrics, candidate.trials).includes('walk');
  const walkB = achievements(incumbent.metrics, incumbent.trials).includes('walk');
  if (walkA !== walkB) return walkA;
  if (a === 0 && b === 0) {
    const delta = precursor(candidate.metrics) - precursor(incumbent.metrics);
    if (Math.abs(delta) > 1e-8) return delta > 0;
  }
  return candidate.fitness > incumbent.fitness;
}

export function completeWave(state, wave, evaluations) {
  if (wave.candidates.length !== WAVE_SIZE || evaluations.length !== WAVE_SIZE) {
    throw new Error('Incomplete search wave.');
  }
  const entries = wave.candidates.map(({ iteration, policy }, index) => ({
    iteration,
    policy,
    ...evaluations[index],
  }));
  const best = entries.reduce(
    (champion, entry) => (better(entry, champion) ? entry : champion),
    state.best,
  );
  const progressed = walkingDistance(best.metrics) > walkingDistance(state.best.metrics) + 1e-8;
  const stale = progressed ? 0 : state.stale + 1;
  let successes = 0;
  const lineages = state.lineages.map((island, index) => {
    const offspring = entries.filter((_, i) => wave.candidates[i].lineage === index);
    successes += offspring.filter((entry) => lineageBetter(entry, island.entry, index)).length;
    let entry =
      index === 0
        ? best
        : offspring.reduce(
            (leader, candidate) => (lineageBetter(candidate, leader, index) ? candidate : leader),
            island.entry,
          );
    const improved = objectives[index](entry) > objectives[index](island.entry) + 1e-8;
    let age = improved ? 0 : island.stale + 1;
    if (index > 0 && island.stale >= RESTART_AFTER && !improved) {
      // Only exploratory islands may accept a worse but genuinely different strategy.
      const viable = offspring.filter(
        (candidate) =>
          candidate.metrics.distance > 0 &&
          candidate.fitness >= 0 &&
          separation(candidate, best) >= MIN_SEPARATION &&
          state.lineages.every(
            (other, i) => i === index || separation(candidate, other.entry) >= MIN_SEPARATION,
          ),
      );
      if (viable.length) {
        entry = bestBy(viable, objectives[index]);
        age = 0;
      }
    }
    const scale = clamp(island.scale * (improved ? 0.9 : 1.18), MIN_SCALE, MAX_SCALE);
    return { entry, scale, stale: age };
  });
  const population = selectPopulation(
    [...state.population, ...state.lineages.map((item) => item.entry), ...entries],
    best,
  );
  return {
    ...state,
    rng: wave.rng,
    iteration: state.iteration + WAVE_SIZE,
    stale,
    mutationScale: lineages[0].scale,
    successRate: successes / WAVE_SIZE,
    best,
    population,
    lineages,
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
    const policy = expandPolicy([...oldPolicy, ...GAIT_DEFAULTS]);
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
    lineages: initializeLineages(all, best),
    records: collectRecords(all),
  };
}

function migratePopulation(state) {
  if (!validBase(state) || !Array.isArray(state.population)) {
    throw new Error('Invalid population checkpoint.');
  }
  const old = [state.best, ...state.population, ...Object.values(state.records)];
  if (
    !old.every(
      (entry) =>
        object(entry) &&
        count(entry.iteration) &&
        entry.iteration <= state.iteration &&
        validPolicy(entry.policy, LEGACY_POLICY_SIZE) &&
        validMetrics(entry.metrics, TRIAL_SECONDS) &&
        Array.isArray(entry.trials) &&
        entry.trials.length === VARIATIONS.length &&
        entry.trials.every((m, i) => validMetrics(m, VARIATIONS[i].seconds)),
    )
  ) {
    throw new Error('Invalid population policy.');
  }
  const rescore = (m) => ({ ...m, score: distanceScore(m) });
  const entries = old.map((entry) => {
    const metrics = rescore(entry.metrics);
    const trials = entry.trials.map(rescore);
    return {
      iteration: entry.iteration,
      policy: expandPolicy(entry.policy),
      metrics,
      trials,
      fitness: robustFitness(metrics, trials),
    };
  });
  const all = [...entries, seedEntry()];
  const best = all.reduce((champion, entry) => (better(entry, champion) ? entry : champion));
  return {
    ...emptyCheckpoint(state.rng),
    iteration: state.iteration,
    best,
    population: selectPopulation(all, best),
    lineages: initializeLineages(all, best),
    records: collectRecords(all),
  };
}

export function parseCheckpoint(source) {
  const state = JSON.parse(source);
  if (state?.format === 'trex-continuous-v4') return migrateCheckpoint(state);
  if (['trex-population-v5', 'trex-population-v6'].includes(state?.format)) {
    return migratePopulation(state);
  }
  if (
    !validBase(state) ||
    state.format !== FORMAT ||
    !validEntry(state.best, state.iteration) ||
    !Number.isFinite(state.mutationScale) ||
    state.mutationScale < MIN_SCALE ||
    state.mutationScale > MAX_SCALE ||
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
    !Array.isArray(state.lineages) ||
    state.lineages.length !== LINEAGE_COUNT ||
    !state.lineages.every(
      (island) =>
        object(island) &&
        validEntry(island.entry, state.iteration) &&
        Number.isFinite(island.scale) &&
        island.scale >= MIN_SCALE &&
        island.scale <= MAX_SCALE &&
        count(island.stale) &&
        island.stale <= state.iteration / WAVE_SIZE,
    ) ||
    state.lineages[0].entry.iteration !== state.best.iteration ||
    separation(state.lineages[0].entry, state.best) >= 1e-9 ||
    state.lineages[0].scale !== state.mutationScale ||
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
