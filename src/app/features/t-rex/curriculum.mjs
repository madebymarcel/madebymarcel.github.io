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
const MAX_ITERATION = Math.floor(Number.MAX_SAFE_INTEGER / WAVE_SIZE) * WAVE_SIZE;

export function scenarios(stage) {
  const disturbance = stage === 'balance' ? 0.015 : stage === 'recover' ? 0.12 : 0.05;
  return [
    { stage, seconds: SECONDS[stage], friction: 0.85 },
    { stage, seconds: SECONDS[stage], friction: 0.76, lateralVelocity: -disturbance },
    { stage, seconds: SECONDS[stage], friction: 0.94, lateralVelocity: disturbance },
  ];
}

function criterion(label, raw, threshold, operator, unit = '', scale = 1) {
  const lower = operator === '>=' || operator === '>';
  const inclusive = operator === '>=' || operator === '<=';
  const gap = lower ? threshold - raw : raw - threshold;
  const passed = inclusive ? gap <= 0 : gap < 0;
  const deficit = passed ? 0 : Math.max(0.000001, gap / Math.max(0.01, Math.abs(threshold)));
  return { label, value: raw * scale, limit: threshold * scale, operator, unit, passed, deficit };
}

// Qualification and the inspector share one source of truth. Scale only for display.
export function trialChecks(stage, m) {
  const total = SECONDS[stage] * 120;
  const checks = [
    criterion('Falls', Number(m.fell), 0, '<='),
    criterion('Duration', m.ticks, total, '>=', 's', 1 / 120),
    criterion('Upright time', m.stableTicks, total * 0.7, '>=', 's', 1 / 120),
  ];
  if (stage === 'balance' || stage === 'recover') {
    return [
      ...checks,
      criterion('Settled time', m.settledTicks, total * 0.65, '>=', 's', 1 / 120),
      criterion('Path distance', m.pathDistance, 0.35, '<', 'm'),
    ];
  }
  if (stage === 'shift') {
    return [
      ...checks,
      criterion('Weight transfer', m.shiftTicks, total * 0.35, '>', 's', 1 / 120),
      criterion('Foot slip', m.slip, 0.45, '<', 'm'),
    ];
  }
  checks.push(criterion('Foot slip', m.slip, Math.max(0.35, m.distance * 0.25), '<=', 'm'));
  if (stage === 'step') {
    return [
      ...checks,
      criterion('Alternating steps', m.steps, 3, '>='),
      criterion('Forward distance', m.distance, 0.45, '>=', 'm'),
    ];
  }
  if (stage === 'walk' || stage === 'run') {
    checks.push(
      criterion('Alternating steps', m.steps, 8, '>='),
      criterion('Forward distance', m.distance, stage === 'walk' ? 2.4 : 6, '>=', 'm'),
      criterion(
        'Airborne time',
        m.flightTicks,
        total * (stage === 'walk' ? 0.15 : 0.55),
        '<',
        's',
        1 / 120,
      ),
    );
    if (stage === 'run') {
      checks.push(
        criterion('Airborne strides', m.flights, 4, '>='),
        criterion('Average speed', m.averageSpeed, 0.75, '>=', 'm/s'),
      );
    }
    return checks;
  }
  return [
    ...checks,
    criterion('Alternating steps', m.steps, 4, '>='),
    criterion('Forward distance', m.distance, 1, '>', 'm'),
    criterion('Mean heading error', m.headingError / total, 0.3, '<', 'rad'),
    criterion('Final settled time', m.stoppingTicks, 120, '>=', 's', 1 / 120),
  ];
}

export function qualifies(stage, m) {
  return trialChecks(stage, m).every((check) => check.passed);
}

function trialDeficit(stage, metrics) {
  return trialChecks(stage, metrics).reduce((sum, check) => sum + check.deficit, 0);
}

export function evaluationDeficit(stage, evaluation) {
  const gaps = evaluation.trials.map((m) => trialDeficit(stage, m));
  return Math.max(...gaps) * 0.7 + gaps.reduce((sum, gap) => sum + gap, 0) * 0.1;
}

export const STAGNATION = 256;
const POPULATION_LIMIT = 12;

export function selectSkill(checkpoint, stage) {
  if (!STAGES.includes(stage)) throw new Error('Unknown skill.');
  return { ...checkpoint, stage };
}

export function skillProgress(checkpoint) {
  return checkpoint.search?.[checkpoint.stage] ?? {
    attempts: 0,
    sinceImprovement: 0,
    restarts: 0,
    population: [],
  };
}

export function seedFromEntry(checkpoint, entry) {
  const selected = selectSkill(checkpoint, entry.stage);
  return {
    ...selected,
    search: {
      ...selected.search,
      [entry.stage]: { ...skillProgress(selected), focus: entry },
    },
  };
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
    task = (4 * m.shiftTicks) / total - m.pathDistance;
  } else {
    const progress = Math.max(-1, Math.min(m.distance, 0.3 * m.steps));
    task = 0.4 * Math.min(m.steps, 16) + progress;
    if (stage === 'run') task += 0.6 * Math.min(m.flights, 12) + m.averageSpeed;
    if (stage === 'walk') task -= (2 * m.flightTicks) / total;
    if (stage === 'maneuver') task += (3 * m.stoppingTicks) / total - m.headingError / total;
    task *= time * time;
  }
  return 8 * time + 4 * stable + task - penalty + (qualifies(stage, m) ? 8 : 0);
}

export function assess(stage, policy) {
  const trials = scenarios(stage).map((options) => evaluate(policy, options));
  const scores = trials.map((m) => fitness(stage, m));
  return {
    score:
      Math.min(...scores) * 0.6 + (scores.reduce((sum, x) => sum + x, 0) / scores.length) * 0.4,
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
    search: {},
    autoAdvance: false,
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
export function legacyPropose(checkpoint, initial) {
  if (checkpoint.iteration >= MAX_ITERATION) throw new Error('Iteration limit reached.');
  const state = { ...checkpoint };
  const best = state.best[state.stage];
  const parents = state.history.filter((item) => item.stage === state.stage);
  const candidates = [];
  for (let i = 0; i < WAVE_SIZE; i++) {
    const archive =
      parents.length && random(state) < 0.15
        ? parents[Math.floor(random(state) * parents.length)]
        : null;
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
        )
          continue;
        policy[k] = Math.max(-24, Math.min(24, policy[k] + (random(state) - 0.5) * scale));
      }
    }
    candidates.push({ iteration: state.iteration + i + 1, policy });
  }
  return { rng: state.rng, candidates };
}

function transferPolicy(state, initial, gaitSeed) {
  const index = STAGES.indexOf(state.stage);
  for (let i = index - 1; i >= 0; i--) {
    const parent = state.best[STAGES[i]];
    if (parent) return parent.policy.slice();
  }
  return expandPolicy(index >= 3 ? gaitSeed : initial);
}

function mutate(state, policy, strength, probability) {
  for (let k = 0; k < sensorDimension; k++) {
    const axis = Math.floor(k / sensorCount);
    const feature = k % sensorCount;
    if (k < sensorDimension - 1 && axis >= 18 && axis % 2 === 0) continue;
    if (
      k < sensorDimension - 1 &&
      (state.stage === 'balance' || state.stage === 'recover') &&
      (feature === 7 || feature === 8)
    ) continue;
    if (random(state) < probability) {
      policy[k] = Math.max(-24, Math.min(24, policy[k] + (random(state) - 0.5) * strength));
    }
  }
  return policy;
}

// Eight deterministic proposals, alternating exploitation, competing parents and exploration.
export function propose(checkpoint, initial, gaitSeed = initial) {
  if (checkpoint.iteration >= MAX_ITERATION) throw new Error('Iteration limit reached.');
  const state = { ...checkpoint };
  const progress = skillProgress(state);
  const best = state.best[state.stage];
  const pool = progress.population;
  const stagnating = progress.sinceImprovement >= STAGNATION;
  const restart = stagnating && progress.sinceImprovement % STAGNATION < WAVE_SIZE;
  const transfer = transferPolicy(state, initial, gaitSeed);
  const candidates = [];
  for (let i = 0; i < WAVE_SIZE; i++) {
    const explorer = i >= (stagnating ? 5 : 7);
    const alternative = pool.length ? pool[Math.floor(random(state) * pool.length)] : best;
    const parent = progress.focus && i < 3 ? progress.focus : i < 3 ? best : alternative;
    let policy = (explorer ? transfer : parent?.policy ?? transfer).slice();
    const first = !best && i === 0 && !progress.focus;
    const focused = progress.focus && i === 0;
    if (!first && !focused) {
      if (!explorer && i === 4 && best && alternative && alternative !== best) {
        policy = policy.map((w, k) => (random(state) < 0.25 ? best.policy[k] : w));
      }
      const strength = explorer
        ? restart ? 3.2 : stagnating ? 1.8 : 0.8
        : [0.06, 0.18, 0.55, 0.24, 0.5, 0.9, 1.4, 1.8][i] *
          (stagnating ? 1.6 : 1);
      const probability = explorer ? (stagnating ? 0.35 : 0.18) : i < 2 ? 0.06 : 0.13;
      policy = mutate(state, policy, strength, probability);
    }
    candidates.push({ iteration: state.iteration + i + 1, policy });
  }
  return { rng: state.rng, candidates, restart };
}

function compare(a, b) {
  const passes = b.evaluation.passes - a.evaluation.passes;
  if (passes) return passes;
  if (a.evaluation.passes !== 3) {
    const deficit = evaluationDeficit(a.stage, a.evaluation) - evaluationDeficit(b.stage, b.evaluation);
    if (Math.abs(deficit) > 1e-9) return deficit;
  }
  return b.evaluation.score - a.evaluation.score;
}

function population(entries, champion) {
  const unique = [...new Map(entries.map((entry) => [entry.iteration, entry])).values()];
  const selected = new Map();
  const add = (items) => {
    for (const entry of items) selected.set(entry.iteration, entry);
  };
  if (champion) add([champion]);
  add([...unique].sort(compare).slice(0, 4));
  for (let index = 0; index < 3; index++) {
    add(
      [...unique]
        .sort((a, b) =>
          trialDeficit(a.stage, a.evaluation.trials[index]) -
          trialDeficit(b.stage, b.evaluation.trials[index]) || compare(a, b),
        )
        .slice(0, 2),
    );
  }
  const diversity = (entry) => entry.policy.reduce(
    (sum, weight, index) => sum + (weight - (champion?.policy[index] ?? 0)) ** 2,
    0,
  );
  add([...unique].sort((a, b) => diversity(b) - diversity(a)).slice(0, 2));
  return [...selected.values()].slice(0, POPULATION_LIMIT);
}

function better(a, b) {
  return (
    !b ||
    a.evaluation.passes > b.evaluation.passes ||
    (a.evaluation.passes === b.evaluation.passes && a.evaluation.score > b.evaluation.score)
  );
}

export function completeWave(checkpoint, wave, evaluations, legacy = false) {
  const state = {
    ...checkpoint,
    rng: wave.rng,
    best: { ...checkpoint.best },
    records: { ...checkpoint.records },
    history: [...checkpoint.history],
    search: { ...checkpoint.search },
  };
  const prior = skillProgress(checkpoint);
  const progress = {
    ...prior,
    attempts: prior.attempts,
    sinceImprovement: prior.sinceImprovement,
    restarts: prior.restarts + Number(Boolean(wave.restart)),
  };
  delete progress.focus;
  const entries = wave.restart ? [] : [...prior.population];
  for (const [index, candidate] of wave.candidates.entries()) {
    progress.attempts++;
    progress.sinceImprovement++;
    const evaluation = evaluations[index];
    const entry = { ...candidate, stage: state.stage, evaluation };
    state.iteration = candidate.iteration;
    state.physicsSteps += evaluation.trials.reduce((sum, m) => sum + m.ticks, 0);
    entries.push(entry);
    const champion = state.best[state.stage];
    if (legacy ? better(entry, champion) : !champion || compare(entry, champion) < 0) {
      progress.sinceImprovement = 0;
      state.best[state.stage] = entry;
      state.history.unshift(entry);
      state.history.length = Math.min(state.history.length, HISTORY_LIMIT);
    }
    for (const [trialIndex, metrics] of evaluation.trials.entries()) {
      for (const [key, value] of Object.entries(recordValues(metrics))) {
        if (!state.records[key] || value > state.records[key].value) {
          state.records[key] = { value, entry, trialIndex };
        }
      }
    }
  }
  progress.population = legacy ? [] : population(entries, state.best[state.stage]);
  state.search[state.stage] = progress;
  return state;
}

function recordValues(m) {
  return {
    distance: m.maxDistance,
    path: m.pathDistance,
    upright: (m.ticks - Number(m.fell)) / 120,
    steps: m.steps,
    speed: m.fell ? 0 : Math.max(0, m.averageSpeed),
    flights: m.flights,
  };
}

export function nextStage(checkpoint) {
  if (checkpoint.best[checkpoint.stage]?.evaluation.passes !== 3) return checkpoint;
  const next = STAGES.slice(STAGES.indexOf(checkpoint.stage) + 1).find(
    (stage) => checkpoint.best[stage]?.evaluation.passes !== 3,
  );
  return next ? selectSkill(checkpoint, next) : checkpoint;
}

const count = (x) => Number.isSafeInteger(x) && x >= 0;
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const metricKeys = [
  'ticks',
  'distance',
  'steps',
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
function validEntry(entry, iteration) {
  return (
    object(entry) &&
    count(entry.iteration) &&
    entry.iteration > 0 &&
    entry.iteration <= iteration &&
    STAGES.includes(entry.stage) &&
    Array.isArray(entry.policy) &&
    entry.policy.length === sensorDimension &&
    entry.policy.every((x) => finite(x) && Math.abs(x) <= 24) &&
    object(entry.evaluation) &&
    finite(entry.evaluation.score) &&
    count(entry.evaluation.passes) &&
    entry.evaluation.passes <= 3 &&
    Array.isArray(entry.evaluation.trials) &&
    entry.evaluation.trials.length === 3 &&
    entry.evaluation.trials.every(
      (m) =>
        object(m) &&
        typeof m.fell === 'boolean' &&
        metricKeys.every((key) => finite(m[key])) &&
        count(m.ticks) &&
        m.ticks <= SECONDS[entry.stage] * 120 &&
        [
          'steps',
          'stableTicks',
          'settledTicks',
          'supportedTicks',
          'bothFeetTicks',
          'shiftTicks',
          'flights',
          'flightTicks',
          'stoppingTicks',
        ].every((key) => count(m[key]) && m[key] <= m.ticks) &&
        ['maxDistance', 'pathDistance', 'slip', 'headingError'].every((key) => m[key] >= 0),
    ) &&
    entry.evaluation.trials.filter((m) => qualifies(entry.stage, m)).length ===
      entry.evaluation.passes
  );
}

export function parseCheckpoint(source) {
  if (source.length > 4_000_000) throw new Error('Checkpoint exceeds 4 MB.');
  const s = JSON.parse(source);
  if (
    !object(s) ||
    s.format !== FORMAT ||
    !count(s.rng) ||
    s.rng > 0xffffffff ||
    !count(s.iteration) ||
    s.iteration > MAX_ITERATION ||
    s.iteration % WAVE_SIZE !== 0 ||
    !count(s.physicsSteps) ||
    !STAGES.includes(s.stage) ||
    !object(s.best) ||
    !object(s.records) ||
    !Array.isArray(s.history) ||
    s.history.length > HISTORY_LIMIT ||
    !Object.entries(s.best).every(
      ([key, entry]) => key === entry?.stage && validEntry(entry, s.iteration),
    ) ||
    !s.history.every((entry) => validEntry(entry, s.iteration)) ||
    !Object.entries(s.records).every(
      ([key, record]) =>
        ['distance', 'path', 'upright', 'steps', 'speed', 'flights'].includes(key) &&
        object(record) &&
        finite(record.value) &&
        record.value >= 0 &&
        validEntry(record.entry, s.iteration) &&
        count(record.trialIndex) &&
        record.trialIndex < 3 &&
        record.value === recordValues(record.entry.evaluation.trials[record.trialIndex])[key],
    ) ||
    (s.autoAdvance !== undefined && typeof s.autoAdvance !== 'boolean') ||
    (s.search !== undefined &&
      (!object(s.search) ||
        !Object.entries(s.search).every(
          ([stage, p]) =>
            STAGES.includes(stage) &&
            object(p) &&
            count(p.attempts) &&
            p.attempts <= s.iteration &&
            count(p.sinceImprovement) &&
            p.sinceImprovement <= p.attempts &&
            count(p.restarts) &&
            p.restarts <= p.attempts &&
            Array.isArray(p.population) &&
            p.population.length <= POPULATION_LIMIT &&
            p.population.every((e) => e?.stage === stage && validEntry(e, s.iteration)) &&
            (p.focus === undefined || (p.focus?.stage === stage && validEntry(p.focus, s.iteration))),
        ) ||
        Object.values(s.search).reduce((sum, p) => sum + p.attempts, 0) > s.iteration)) ||
    new Set(s.history.map((entry) => entry.iteration)).size !== s.history.length
  ) {
    throw new Error('Invalid or incompatible T. rex checkpoint.');
  }
  return s;
}
