import test from 'node:test';
import assert from 'node:assert/strict';
import seed from '../src/app/features/t-rex/seed-policy.json' with { type: 'json' };
import { createServoRig } from '../src/app/features/t-rex/servo-rig.mjs';
import { evaluate, GAIT_DEFAULTS, trial } from '../src/app/features/t-rex/servo-learning.mjs';
import {
  achievements,
  assess,
  better,
  completeWave,
  emptyCheckpoint,
  parseCheckpoint,
  propose,
  robustFitness,
  WAVE_SIZE,
} from '../src/app/features/t-rex/servo-search.mjs';

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
  const bad = { ...state.best.metrics, steps: 0, score: -10, distance: 0, stableTicks: 0 };
  const trials = state.best.trials.map((m) => ({ ...m, score: -10 }));
  const evaluation = { metrics: bad, trials, fitness: robustFitness(bad, trials) };
  const next = completeWave(state, wave, Array(WAVE_SIZE).fill(evaluation));
  assert.deepEqual(next.best, state.best);
  assert.deepEqual(next.records, state.records);
  assert.equal(next.stale, 1);
  assert.equal(next.iteration, WAVE_SIZE);
  assert.ok(next.mutationScale < state.mutationScale);
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
  assert.ok(explored.population.length > 1);
  const following = propose(explored);
  assert.ok(new Set(following.candidates.map((candidate) => candidate.parent)).size > 1);
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
  assert.deepEqual(state.best.policy, [...old.best.policy, ...GAIT_DEFAULTS]);
  assert.deepEqual(state.best.metrics, seed.metrics);
  assert.deepEqual(state.best.trials, seed.trials);
  assert.equal(state.best.fitness, robustFitness(seed.metrics, seed.trials));
  assert.deepEqual(parseCheckpoint(JSON.stringify(state)), state);
});

test('the seed has reproducible nominal and disturbed evaluations', () => {
  const result = assess(seed.policy);
  assert.deepEqual(result.metrics, seed.metrics);
  assert.deepEqual(result.trials, seed.trials);
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
