import { evaluate, expandPolicy, sensorCount, sensorDimension } from './spatial-learning.mjs';

export const STAGES = ['balance', 'recover', 'shift', 'step', 'walk', 'run', 'maneuver'];
export const LABELS = {
  balance: 'Balance',
  recover: 'Counterbalance',
  shift: 'Weight transfer',
  step: 'Stepping',
  walk: 'Walking',
  run: 'Running',
  maneuver: 'Turning and stopping',
};
export const SECONDS = { balance: 5, recover: 5, shift: 5, step: 6, walk: 8, run: 8, maneuver: 9 };
export const FORMAT = 'trex-locomotion-v2';
export const STORAGE_KEY = 'made-by-marcel-trex-locomotion-v2';
export const WAVE_SIZE = 8;
const HISTORY_LIMIT = 40;
const MAX_ITERATION = Number.MAX_SAFE_INTEGER - WAVE_SIZE;

export function scenarios(stage) {
  const disturbance = stage === 'balance' ? 0.015 : stage === 'recover' ? 0.12 : 0.05;
  return [
    { stage, seconds: SECONDS[stage], friction: 0.85 },
    { stage, seconds: SECONDS[stage], friction: 0.76, lateralVelocity: -disturbance },
    { stage, seconds: SECONDS[stage], friction: 0.94, lateralVelocity: disturbance },
  ];
}

export function qualifies(stage, m) {
  const total = SECONDS[stage] * 120;
  if (m.fell || m.ticks < total || m.stableTicks < total * 0.7) return false;
  if (stage === 'balance' || stage === 'recover') {
    return m.settledTicks >= total * 0.65 && m.pathDistance < 0.35;
  }
  if (stage === 'shift') return m.shiftTicks > total * 0.35 && m.slip < 0.45;
  if (m.slip > Math.max(0.35, m.distance * 0.25)) return false;
  if (stage === 'step') return m.steps >= 3 && m.distance >= 0.45;
  if (stage === 'walk') {
    return m.steps >= 8 && m.distance >= 2.4 && m.flightTicks < total * 0.15;
  }
  if (stage === 'run') {
    return (
      m.steps >= 8 &&
      m.distance >= 6 &&
      m.flights >= 4 &&
      m.flightTicks < total * 0.55 &&
      m.averageSpeed >= 0.75
    );
  }
  return m.steps >= 4 && m.distance > 1 && m.headingError / total < 0.3 &&
    m.stoppingTicks > 120;
}

function fitness(stage, m) {
  const total = SECONDS[stage] * 120;
  const time = m.ticks / total;
  const stable = m.stableTicks / total;
  const settled = m.settledTicks / total;
  const penalty = (m.fell ? 3 : 0) + 0.7 * m.slip;
  // Survival dominates; partial locomotion credit is scaled by survival.
  let task = 0;
  if (stage === 'balance' || stage === 'recover') {
    task = 3 * settled - 2 * m.pathDistance;
  } else if (stage === 'shift') {
    task = 4 * m.shiftTicks / total - m.pathDistance;
  } else {
    const progress = Math.max(-1, Math.min(m.distance, 0.3 * m.steps));
    task = 0.4 * Math.min(m.steps, 16) + progress;
    if (stage === 'run') task += 0.6 * Math.min(m.flights, 12) + m.averageSpeed;
    if (stage === 'walk') task -= 2 * m.flightTicks / total;
    if (stage === 'maneuver') task += 3 * m.stoppingTicks / total - m.headingError / total;
    task *= time * time;
  }
  return 8 * time + 4 * stable + task - penalty + (qualifies(stage, m) ? 8 : 0);
}

export function assess(stage, policy) {
  const trials = scenarios(stage).map((options) => evaluate(policy, options));
  const scores = trials.map((m) => fitness(stage, m));
  return {
    score: Math.min(...scores) * 0.6 + scores.reduce((sum, x) => sum + x, 0) / scores.length * 0.4,
    passes: trials.filter((m) => qualifies(stage, m)).length,
    trials,
  };
}

export function emptyCheckpoint(seed = 536) {
  return {
    format: FORMAT,
    rng: seed >>> 0,
    iteration: 0,
    physicsSteps: 0,
    stage: 'balance',
    best: {},
    records: {},
    history: [],
  };
}

function random(state) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

function seedPolicy(state, initial) {
  const index = STAGES.indexOf(state.stage);
  const previous = index > 0 ? state.best[STAGES[index - 1]] : null;
  if (previous) return previous.policy.slice();
  return expandPolicy(initial);
}

// A wave uses the same parent throughout. Completion order and worker count do not alter learning.
export function propose(checkpoint, initial) {
  if (checkpoint.iteration >= MAX_ITERATION) throw new Error('Iteration limit reached.');
  const state = { ...checkpoint };
  const best = state.best[state.stage];
  const parents = state.history.filter((item) => item.stage === state.stage);
  const candidates = [];
  for (let i = 0; i < WAVE_SIZE; i++) {
    const archive = parents.length && random(state) < 0.15 ? parents[parents.length - 1] : null;
    const parent = archive ?? best;
    const policy = parent ? parent.policy.slice() : seedPolicy(state, initial);
    if (i > 0 || best) {
      const index = state.iteration + i;
      const scale = [0.035, 0.12, 0.4, 1.1][index % 4];
      const probability = [0.035, 0.09, 0.18][index % 3];
      for (let k = 0; k < sensorDimension; k++) {
        if (random(state) >= probability) continue;
        // Hinge motors only use the sagittal axis. Static skills do not use clock inputs.
        const axis = Math.floor(k / sensorCount);
        const feature = k % sensorCount;
        if (k < sensorDimension - 1 && axis >= 18 && axis % 2 === 0) continue;
        if (
          k < sensorDimension - 1 &&
          (state.stage === 'balance' || state.stage === 'recover') &&
          (feature === 7 || feature === 8)
        ) continue;
        policy[k] = Math.max(-24, Math.min(24, policy[k] + (random(state) - 0.5) * scale));
      }
    }
    candidates.push({ iteration: state.iteration + i + 1, policy });
  }
  return { rng: state.rng, candidates };
}

function better(a, b) {
  return !b || a.evaluation.passes > b.evaluation.passes ||
    (a.evaluation.passes === b.evaluation.passes && a.evaluation.score > b.evaluation.score);
}

export function completeWave(checkpoint, wave, evaluations) {
  const state = {
    ...checkpoint,
    rng: wave.rng,
    best: { ...checkpoint.best },
    records: { ...checkpoint.records },
    history: [...checkpoint.history],
  };
  for (const [index, candidate] of wave.candidates.entries()) {
    const evaluation = evaluations[index];
    const entry = { ...candidate, stage: state.stage, evaluation };
    state.iteration = candidate.iteration;
    state.physicsSteps += evaluation.trials.reduce((sum, m) => sum + m.ticks, 0);
    if (better(entry, state.best[state.stage])) {
      state.best[state.stage] = entry;
      state.history.unshift(entry);
      state.history.length = Math.min(state.history.length, HISTORY_LIMIT);
    }
    const nominal = evaluation.trials[0];
    const metrics = {
      distance: nominal.maxDistance,
      path: nominal.pathDistance,
      upright: (nominal.ticks - Number(nominal.fell)) / 120,
      steps: nominal.steps,
      speed: nominal.fell ? 0 : Math.max(0, nominal.averageSpeed),
      flights: nominal.flights,
    };
    for (const [key, value] of Object.entries(metrics)) {
      if (!state.records[key] || value > state.records[key].value) {
        state.records[key] = { value, entry };
      }
    }
  }
  return state;
}

export function nextStage(checkpoint) {
  const index = STAGES.indexOf(checkpoint.stage);
  if (index === STAGES.length - 1 || checkpoint.best[checkpoint.stage]?.evaluation.passes !== 3) {
    return checkpoint;
  }
  return { ...checkpoint, stage: STAGES[index + 1] };
}

const count = (x) => Number.isSafeInteger(x) && x >= 0;
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const metricKeys = [
  'ticks', 'distance', 'steps', 'maxDistance', 'pathDistance', 'stableTicks', 'settledTicks',
  'supportedTicks', 'bothFeetTicks', 'shiftTicks', 'flights', 'flightTicks', 'slip',
  'headingError', 'stoppingTicks', 'averageSpeed', 'score',
];
function validEntry(entry, iteration) {
  return object(entry) && count(entry.iteration) && entry.iteration > 0 &&
    entry.iteration <= iteration && STAGES.includes(entry.stage) &&
    Array.isArray(entry.policy) && entry.policy.length === sensorDimension &&
    entry.policy.every((x) => finite(x) && Math.abs(x) <= 24) &&
    object(entry.evaluation) && finite(entry.evaluation.score) &&
    count(entry.evaluation.passes) && entry.evaluation.passes <= 3 &&
    Array.isArray(entry.evaluation.trials) && entry.evaluation.trials.length === 3 &&
    entry.evaluation.trials.every((m) => object(m) && typeof m.fell === 'boolean' &&
      metricKeys.every((key) => finite(m[key])) &&
      count(m.ticks) && m.ticks <= SECONDS[entry.stage] * 120 &&
      ['steps', 'stableTicks', 'settledTicks', 'supportedTicks', 'bothFeetTicks',
        'shiftTicks', 'flights', 'flightTicks', 'stoppingTicks'].every(
        (key) => count(m[key]) && m[key] <= m.ticks,
      ) && ['maxDistance', 'pathDistance', 'slip', 'headingError'].every((key) => m[key] >= 0)) &&
    entry.evaluation.trials.filter((m) => qualifies(entry.stage, m)).length === entry.evaluation.passes;
}

export function parseCheckpoint(source) {
  if (source.length > 4_000_000) throw new Error('Checkpoint exceeds 4 MB.');
  const s = JSON.parse(source);
  if (!object(s) || s.format !== FORMAT || !count(s.rng) || s.rng > 0xffffffff ||
      !count(s.iteration) || s.iteration > MAX_ITERATION || s.iteration % WAVE_SIZE !== 0 ||
      !count(s.physicsSteps) || !STAGES.includes(s.stage) ||
      !object(s.best) || !object(s.records) ||
      !Array.isArray(s.history) || s.history.length > HISTORY_LIMIT ||
      !Object.entries(s.best).every(([key, entry]) =>
        key === entry?.stage && validEntry(entry, s.iteration)) ||
      !s.history.every((entry) => validEntry(entry, s.iteration)) ||
      !Object.entries(s.records).every(([key, record]) =>
        ['distance', 'path', 'upright', 'steps', 'speed', 'flights'].includes(key) &&
        object(record) && finite(record.value) && record.value >= 0 &&
        validEntry(record.entry, s.iteration))) {
    throw new Error('Invalid or incompatible T. rex checkpoint.');
  }
  return s;
}
