import { neutralPolicy, POLICY_SIZE } from './servo-rig.mjs';
import { evaluate } from './servo-learning.mjs';
import { STAGES, LABELS, SECONDS, trialChecks, qualifies } from './curriculum.mjs';

export { STAGES, LABELS, trialChecks };
export const FORMAT = 'trex-servo-v3';
export const STORAGE_KEY = 'made-by-marcel-trex-servo-v3';
export const LEGACY_KEY = 'made-by-marcel-trex-locomotion-v2';
export const DIRECTIONS = 6;
export const WAVE_SIZE = DIRECTIONS * 2;
const ELITES = 3;
const HISTORY_LIMIT = 40;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const optionsFor = (stage) => ({ stage, seconds: SECONDS[stage], friction: 0.85 });
export const assess = (stage, policy) => {
  const metrics = evaluate(policy, optionsFor(stage));
  return { metrics, passed: qualifies(stage, metrics) };
};

export function emptyCheckpoint(seed = 3) {
  return {
    format: FORMAT,
    rng: seed >>> 0 || 1,
    iteration: 0,
    physicsSteps: 0,
    stage: 'walk',
    skills: {},
  };
}

export function skillState(state, stage = state.stage) {
  return (
    state.skills[stage] ?? {
      weights: neutralPolicy(),
      attempts: 0,
      generations: 0,
      sinceImprovement: 0,
      best: null,
      history: [],
    }
  );
}

export function selectSkill(state, stage) {
  if (!STAGES.includes(stage)) throw new Error('Unknown skill.');
  return { ...state, stage };
}

function random(state) {
  let value = state.rng;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rng = value >>> 0;
  return state.rng / 4294967296;
}

// Same symmetric search principle as the proven biped: improve a centre policy
// using paired perturbations, not selection by pass count or qualification deficit.
export function propose(checkpoint) {
  if (checkpoint.iteration > Number.MAX_SAFE_INTEGER - WAVE_SIZE) {
    throw new Error('Candidate limit reached.');
  }
  const state = { ...checkpoint };
  const skill = skillState(state);
  const centre = skill.weights;
  const noise = skill.generations === 0 ? 0.25 : 0.08;
  const directions = [];
  const candidates = [];
  for (let i = 0; i < DIRECTIONS; i++) {
    const direction = centre.map(() => Math.sqrt(12) * (random(state) - 0.5));
    directions.push(direction);
    for (const sign of [1, -1]) {
      candidates.push({
        iteration: state.iteration + candidates.length + 1,
        policy: centre.map((w, j) => clamp(w + sign * noise * direction[j], -8, 8)),
      });
    }
  }
  return { rng: state.rng, directions, candidates };
}

export function better(candidate, best) {
  if (!best) return true;
  if (candidate.evaluation.passed !== best.evaluation.passed) return candidate.evaluation.passed;
  return candidate.evaluation.metrics.score > best.evaluation.metrics.score;
}

export function completeWave(state, wave, evaluations) {
  if (evaluations.length !== WAVE_SIZE) throw new Error('Incomplete search wave.');
  const previous = skillState(state);
  const skill = {
    ...previous,
    attempts: previous.attempts + WAVE_SIZE,
    generations: previous.generations + 1,
    history: [...previous.history],
  };
  let physicsSteps = state.physicsSteps;
  for (const [i, candidate] of wave.candidates.entries()) {
    const entry = {
      ...candidate,
      stage: state.stage,
      skillAttempt: previous.attempts + i + 1,
      evaluation: evaluations[i],
    };
    skill.sinceImprovement++;
    physicsSteps += entry.evaluation.metrics.ticks;
    if (better(entry, skill.best)) {
      skill.sinceImprovement = 0;
      skill.best = entry;
      skill.history.unshift(entry);
    }
  }
  skill.history.length = Math.min(skill.history.length, HISTORY_LIMIT);
  const ranked = wave.directions
    .map((direction, i) => ({
      direction,
      positive: evaluations[2 * i].metrics.score,
      negative: evaluations[2 * i + 1].metrics.score,
    }))
    .sort((a, b) => Math.max(b.positive, b.negative) - Math.max(a.positive, a.negative))
    .slice(0, ELITES);
  const scores = ranked.flatMap(({ positive, negative }) => [positive, negative]);
  const mean = scores.reduce((sum, x) => sum + x, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((sum, x) => sum + (x - mean) ** 2, 0) / scores.length);
  if (sd > 1e-8) {
    skill.weights = previous.weights.map((w, i) => {
      const update = ranked.reduce((sum, p) => sum + (p.positive - p.negative) * p.direction[i], 0);
      return clamp(w + (0.035 * update) / (ELITES * sd), -8, 8);
    });
  }
  return {
    ...state,
    rng: wave.rng,
    iteration: state.iteration + WAVE_SIZE,
    physicsSteps,
    skills: { ...state.skills, [state.stage]: skill },
  };
}

export function seedFromEntry(state, entry) {
  const selected = selectSkill(state, entry.stage);
  return {
    ...selected,
    skills: {
      ...selected.skills,
      [entry.stage]: { ...skillState(selected), weights: entry.policy.slice() },
    },
  };
}

const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const count = (x) => Number.isSafeInteger(x) && x >= 0;
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const validPolicy = (p) =>
  Array.isArray(p) && p.length === POLICY_SIZE && p.every((x) => finite(x) && Math.abs(x) <= 8);
const metricsKeys = [
  'ticks',
  'distance',
  'steps',
  'lifts',
  'maxClearance',
  'maxDistance',
  'pathDistance',
  'stableTicks',
  'settledTicks',
  'supportedTicks',
  'bothFeetTicks',
  'shiftTicks',
  'flights',
  'flightTicks',
  'slip',
  'headingError',
  'stoppingTicks',
  'averageSpeed',
  'score',
];
function validEntry(entry, stage, max) {
  if (
    !object(entry) ||
    entry.stage !== stage ||
    !count(entry.iteration) ||
    entry.iteration === 0 ||
    entry.iteration > max ||
    !count(entry.skillAttempt) ||
    entry.skillAttempt === 0 ||
    entry.skillAttempt > entry.iteration ||
    !validPolicy(entry.policy) ||
    !object(entry.evaluation) ||
    typeof entry.evaluation.passed !== 'boolean' ||
    !object(entry.evaluation.metrics)
  )
    return false;
  const m = entry.evaluation.metrics;
  return (
    typeof m.fell === 'boolean' &&
    metricsKeys.every((key) => finite(m[key])) &&
    count(m.ticks) &&
    m.ticks <= SECONDS[stage] * 120 &&
    [
      'steps',
      'lifts',
      'stableTicks',
      'settledTicks',
      'supportedTicks',
      'bothFeetTicks',
      'shiftTicks',
      'flights',
      'flightTicks',
      'stoppingTicks',
    ].every((key) => count(m[key]) && m[key] <= m.ticks) &&
    ['maxClearance', 'maxDistance', 'pathDistance', 'slip', 'headingError'].every(
      (key) => m[key] >= 0,
    ) &&
    entry.evaluation.passed === qualifies(stage, m)
  );
}

export function parseCheckpoint(source) {
  if (source.length > 4_000_000) throw new Error('Checkpoint exceeds 4 MB.');
  const s = JSON.parse(source);
  if (s?.format !== FORMAT) {
    throw new Error(
      'This checkpoint uses a different controller. Legacy training cannot be replayed as servo training.',
    );
  }
  if (
    !count(s.rng) ||
    s.rng < 1 ||
    s.rng > 0xffffffff ||
    !count(s.iteration) ||
    s.iteration % WAVE_SIZE !== 0 ||
    !count(s.physicsSteps) ||
    !STAGES.includes(s.stage) ||
    !object(s.skills) ||
    !Object.entries(s.skills).every(
      ([stage, skill]) =>
        STAGES.includes(stage) &&
        object(skill) &&
        validPolicy(skill.weights) &&
        count(skill.attempts) &&
        count(skill.generations) &&
        count(skill.sinceImprovement) &&
        skill.sinceImprovement <= skill.attempts &&
        skill.attempts === skill.generations * WAVE_SIZE &&
        (skill.best === null || validEntry(skill.best, stage, s.iteration)) &&
        Array.isArray(skill.history) &&
        skill.history.length <= HISTORY_LIMIT &&
        skill.history.every((e) => validEntry(e, stage, s.iteration)) &&
        (skill.attempts === 0 ? skill.best === null : skill.best !== null),
    ) ||
    Object.values(s.skills).reduce((sum, skill) => sum + skill.attempts, 0) !== s.iteration
  )
    throw new Error('Invalid servo checkpoint.');
  return s;
}
