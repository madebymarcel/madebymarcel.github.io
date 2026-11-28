import test from 'node:test';
import assert from 'node:assert/strict';
import seed from '../src/app/features/t-rex/seed-policy.json' with { type: 'json' };
import { createServoRig } from '../src/app/features/t-rex/servo-rig.mjs';
import {
  distanceScore,
  evaluate,
  GAIT_DEFAULTS,
  ADAPTIVE_DEFAULTS,
  trial,
} from '../src/app/features/t-rex/servo-learning.mjs';
import {
  achievements,
  assess,
  better,
  completeWave,
  emptyCheckpoint,
  parseCheckpoint,
  propose,
  robustFitness,
  selectPopulation,
  WAVE_SIZE,
} from '../src/app/features/t-rex/servo-search.mjs';

// Replay metrics must agree across JS engines. Discrete physical events stay exact;
// only continuous quantities permit insignificant floating-point rounding.
function assertReplayMetrics(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  const continuous = new Set([
    'distance',
    'maxClearance',
    'maxForward',
    'slip',
    'work',
    'score',
    'lateralDistance',
    'forwardUpright',
  ]);
  for (const [key, value] of Object.entries(expected)) {
    if (continuous.has(key)) {
      const tolerance = 1e-8 * Math.max(1, Math.abs(value));
      assert.ok(Math.abs(actual[key] - value) <= tolerance, key + ' differs from reference');
    } else {
      assert.equal(actual[key], value, key + ' differs from reference');
    }
  }
}

function assertReplayTrials(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((metrics, i) => assertReplayMetrics(metrics, expected[i]));
}

test('physical skeleton retains all 17 bodies and 16 articulated joints', () => {
  const rig = createServoRig({ startSplit: 0.045 });
  assert.equal(rig.bones.length, 17);
  assert.equal(rig.joints.length, 16);
  assert.equal(rig.bones.filter((b) => b.name.startsWith('tail-')).length, 6);
  for (const c of rig.world.constraints) {
    if (!c.pivotA || !c.pivotB) continue;
    const a = c.bodyA.pointToWorldFrame(c.pivotA);
    const b = c.bodyB.pointToWorldFrame(c.pivotB);
    assert.ok(a.distanceTo(b) < 1e-9);
  }
  for (const { body, name } of rig.bones) {
    if (!name.startsWith('toes')) continue;
    body.updateAABB();
    assert.ok(body.aabb.lowerBound.y >= 0.0049);
  }
});

test('loaded locomotion replay completes real alternating steps on unrestricted 3D ground', () => {
  const run = trial(seed.policy);
  let maxLoad = 0;
  const { rig } = run;
  const feet = rig.bones.filter((bone) => bone.name.startsWith('toes')).map((bone) => bone.body);
  while (!run.done) {
    run.advance();
    for (const c of rig.world.contacts) {
      const body = c.bi === rig.ground ? c.bj : c.bj === rig.ground ? c.bi : null;
      if (feet.includes(body)) maxLoad = Math.max(maxLoad, c.multiplier);
    }
  }
  const m = run.metrics();
  assert.ok(maxLoad > 10);
  assert.ok(m.steps >= 4, 'actual alternating forward landings, not a synthetic score');
  assert.ok(m.distance > 0.4);
  assert.ok(m.maxClearance > 0.025);
  assert.ok(m.stableTicks > 240);
  assert.deepEqual(evaluate(seed.policy), m);
  assert.equal(m.steps, seed.metrics.steps);
  assert.equal(m.fell, seed.metrics.fell);
});

test('axial motors can actively bend the massive tail in either direction', () => {
  for (const sign of [-1, 1]) {
    const rig = createServoRig();
    rig.world.gravity.setZero();
    const target = Array(32).fill(0);
    target[4] = sign * 0.15;
    target[6] = sign * 0.15;
    for (let i = 0; i < 60; i++) rig.drive(target);
    assert.ok(sign * rig.observeJoints()[2].angle.y > 0.04);
    assert.ok(sign * rig.observeJoints()[3].angle.y > 0.04);
  }
});

test('population search retains its champion, explores alternatives, and adapts its scale', () => {
  const state = emptyCheckpoint();
  const wave = propose(state);
  const bad = {
    ...state.best.metrics,
    steps: 0,
    score: -10,
    distance: 0,
    forwardUpright: 0,
    stableTicks: 0,
  };
  const trials = state.best.trials.map((m) => ({
    ...m,
    score: -10,
    distance: 0,
    forwardUpright: 0,
    steps: 0,
  }));
  const evaluation = { metrics: bad, trials, fitness: robustFitness(bad, trials) };
  const next = completeWave(state, wave, Array(WAVE_SIZE).fill(evaluation));
  assert.deepEqual(next.best, state.best);
  assert.deepEqual(next.records, state.records);
  assert.equal(next.stale, 1);
  assert.equal(next.iteration, WAVE_SIZE);
  assert.ok(next.mutationScale > state.mutationScale);
  assert.equal(next.population.length, 1);
  assert.ok(next.population.some((entry) => entry.iteration === state.best.iteration));
  const viable = {
    ...state.best.metrics,
    score: state.best.metrics.score - 0.01,
    distance: state.best.metrics.distance - 0.1,
    forwardUpright: state.best.metrics.forwardUpright - 0.1,
  };
  const alternatives = {
    metrics: viable,
    trials: state.best.trials,
    fitness: robustFitness(viable, state.best.trials),
  };
  const explored = completeWave(next, propose(next), Array(WAVE_SIZE).fill(alternatives));
  assert.equal(explored.lineages.length, 4);
  const following = propose(explored);
  assert.equal(new Set(following.candidates.map((candidate) => candidate.lineage)).size, 4);
  const restored = parseCheckpoint(JSON.stringify(explored));
  assert.deepEqual(propose(restored), following);
  assert.throws(() => parseCheckpoint(JSON.stringify({ ...next, format: 'trex-servo-v3' })));
});

test('legacy checkpoint migration preserves weights, count and behavior, and rescores trials', () => {
  const old = {
    format: 'trex-continuous-v4',
    rng: 1105691708,
    iteration: 38144,
    stale: 31,
    best: { iteration: 37637, policy: seed.policy.slice(0, 28), metrics: { score: 97 } },
    records: {},
  };
  const state = parseCheckpoint(JSON.stringify(old));
  assert.equal(state.iteration, old.iteration);
  assert.equal(state.rng, old.rng);
  assert.equal(state.best.iteration, old.best.iteration);
  assert.deepEqual(state.best.policy, [...old.best.policy, ...GAIT_DEFAULTS, ...ADAPTIVE_DEFAULTS]);
  assertReplayMetrics(state.best.metrics, seed.metrics);
  assertReplayTrials(state.best.trials, seed.trials);
  assert.equal(state.best.fitness, robustFitness(state.best.metrics, state.best.trials));
  assert.deepEqual(parseCheckpoint(JSON.stringify(state)), state);
});

test('the seed has reproducible nominal and disturbed evaluations', () => {
  const result = assess(seed.policy);
  assertReplayMetrics(result.metrics, seed.metrics);
  assertReplayTrials(result.trials, seed.trials);
});

test('extra steps alone cannot replace effective forward motion', () => {
  const state = emptyCheckpoint();
  const old = state.best;
  const metrics = { ...old.metrics, steps: 100, distance: old.metrics.distance - 0.3, score: 100 };
  assert.equal(better({ ...old, metrics }, old), false);
});

test('milestones require sustained walking under all evaluation conditions', () => {
  const m = evaluate(seed.policy);
  assert.ok(achievements(m).includes('step'));
  assert.ok(achievements(m).includes('alternate'));
  assert.equal(achievements(m).includes('walk'), false);
  const walking = {
    ...m,
    ticks: 1440,
    stableTicks: 1440,
    steps: 12,
    distance: 4,
    slip: 0.2,
    flightTicks: 0,
    fell: false,
  };
  const varied = { ...walking, ticks: 720, stableTicks: 720, steps: 6, distance: 2 };
  assert.ok(achievements(walking, [varied, varied]).includes('walk'));
  assert.equal(achievements(walking).includes('walk'), false);
  assert.equal(achievements(walking, [varied, { ...varied, fell: true }]).includes('walk'), false);
});

test('distance first: a longer walk beats standing even if it ends in a fall', () => {
  const old = emptyCheckpoint().best;
  const standing = {
    ...old.metrics,
    distance: 0,
    forwardUpright: 0,
    steps: 0,
    stableTicks: 1440,
    fell: false,
    slip: 0,
    lateralDistance: 0,
  };
  const walking = {
    ...standing,
    distance: 2,
    forwardUpright: 2,
    steps: 6,
    stableTicks: 600,
    fell: true,
    slip: 0.2,
  };
  const entry = (m) => ({ ...old, metrics: { ...m, score: distanceScore(m) } });
  assert.equal(distanceScore(standing), 0);
  assert.ok(better(entry(walking), entry(standing)));
  assert.equal(better(entry(standing), entry(walking)), false);
  assert.ok(distanceScore(walking) > distanceScore({ ...walking, steps: 0, slip: 2 }));
});

test('v5 checkpoints retain policies but discard stale scores and mutation scale', () => {
  const state = emptyCheckpoint();
  const entry = {
    ...state.best,
    policy: seed.policy,
    metrics: { ...state.best.metrics, score: 999 },
    trials: state.best.trials.map((m) => ({ ...m, score: 999 })),
    fitness: 999,
  };
  const old = {
    ...state,
    format: 'trex-population-v5',
    mutationScale: 0.005,
    best: entry,
    population: [entry],
    records: {},
  };
  const restored = parseCheckpoint(JSON.stringify(old));
  assert.equal(restored.format, 'trex-population-v7');
  assert.deepEqual(restored.best.policy, [...entry.policy, ...ADAPTIVE_DEFAULTS]);
  assert.equal(restored.best.metrics.score, distanceScore(entry.metrics));
  assert.equal(restored.mutationScale, 0.2);
  assert.deepEqual(parseCheckpoint(JSON.stringify(restored)), restored);
});

test('distance leader cannot be vetoed by slip, drift or a lower robust score', () => {
  const old = emptyCheckpoint().best;
  const farther = {
    ...old,
    metrics: {
      ...old.metrics,
      distance: old.metrics.distance + 0.03,
      forwardUpright: old.metrics.forwardUpright + 0.005,
      steps: old.metrics.steps + 1,
      score: old.metrics.score - 1,
    },
    fitness: old.fitness - 2,
  };
  assert.ok(better(farther, old));
  assert.ok(!better(old, farther));
});

test('stagnation escalates exploration and never discards the distance champion', () => {
  let state = emptyCheckpoint();
  const initial = state;
  const bad = {
    ...state.best.metrics,
    distance: 0,
    forwardUpright: 0,
    steps: 0,
    score: -10,
  };
  const evaluation = { metrics: bad, trials: [bad, bad], fitness: -10 };
  for (let i = 0; i < 12; i++) {
    state = completeWave(state, propose(state), Array(WAVE_SIZE).fill(evaluation));
  }
  assert.deepEqual(state.best, initial.best);
  assert.equal(state.stale, 12);
  assert.ok(state.mutationScale > initial.mutationScale);
  const wave = propose(state);
  assert.ok(wave.candidates.every((candidate) => !candidate.local));
  assert.equal(new Set(wave.candidates.map((candidate) => candidate.lineage)).size, 4);
  assert.ok(
    wave.candidates.some(
      (candidate) =>
        candidate.policy.filter((value, i) => value !== state.best.policy[i]).length > 6,
    ),
  );
});

test('near-identical policies do not fill the archive', () => {
  const champion = emptyCheckpoint().best;
  const clones = Array.from({ length: 10 }, (_, i) => ({
    ...champion,
    iteration: i + 1,
    policy: champion.policy.map((value, j) => (j === 0 ? value + i * 0.000001 : value)),
  }));
  assert.ok(selectPopulation(clones, champion).length <= 2);
});

test('v6 migration preserves the physical replay and iteration counter', () => {
  const state = emptyCheckpoint();
  const entry = { ...state.best, policy: seed.policy };
  const old = {
    ...state,
    format: 'trex-population-v6',
    iteration: 2048,
    best: entry,
    population: [entry],
    records: {},
  };
  const restored = parseCheckpoint(JSON.stringify(old));
  assert.equal(restored.iteration, 2048);
  assertReplayMetrics(evaluate(restored.best.policy), seed.metrics);
  assert.deepEqual(parseCheckpoint(JSON.stringify(restored)), restored);
});

test('nonzero adaptive feedback runs through real physics with bounded motors', () => {
  const policy = [...seed.policy, ...ADAPTIVE_DEFAULTS];
  policy[33] = 0.1;
  policy[41] = 0.1;
  policy[45] = 0.5;
  policy[47] = 0.1;
  const metrics = evaluate(policy);
  assert.ok(metrics.ticks > 0);
  assert.ok(
    Object.values(metrics).every((value) => typeof value === 'boolean' || Number.isFinite(value)),
  );
});
