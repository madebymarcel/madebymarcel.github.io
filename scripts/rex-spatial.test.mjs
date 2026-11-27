import test from 'node:test';
import assert from 'node:assert/strict';
import { createRig } from '../src/app/features/t-rex/spatial-rig.mjs';
import { trainer } from '../src/app/features/t-rex/spatial-learning.mjs';

test('tail actuation bends multiple massive links and reacts on the free trunk', () => {
  const free = createRig(),
    locked = createRig({ locked: true });
  const pose = (rig) => rig.frame().filter((b) => b.name.startsWith('tail'));
  for (const rig of [free, locked]) {
    rig.world.gravity.setZero();
    const actions = Array(32).fill(0);
    actions[4] = 0.65;
    actions[8] = -0.6;
    for (let k = 0; k < 12; k++) rig.step(actions);
  }
  assert.equal(pose(free).length, 6);
  assert.deepEqual(
    free.bones.map((b) => b.body.mass),
    locked.bones.map((b) => b.body.mass),
  );
  const bend = (rig) => {
    const tail = pose(rig);
    const heading = (b) => Math.atan2(b.end.z - b.start.z, b.start.x - b.end.x);
    return Math.max(...tail.slice(1).map((b, i) => Math.abs(heading(b) - heading(tail[i]))));
  };
  assert.ok(bend(free) > bend(locked) + 0.01);
  assert.ok(
    Math.abs(free.trunk.body.angularVelocity.y - locked.trunk.body.angularVelocity.y) > 0.001,
  );
});

test('training repeats from the same seed and retains its best evaluation', () => {
  const a = trainer(321),
    b = trainer(321);
  const first = a();
  assert.deepEqual(first, b());
  assert.ok(a().score >= first.score);
});

import { readFileSync } from 'node:fs';
import { expandPolicy, sensorDimension } from '../src/app/features/t-rex/spatial-learning.mjs';
import {
  assess,
  completeWave,
  emptyCheckpoint,
  nextStage,
  parseCheckpoint,
  propose,
  qualifies,
  selectSkill,
  seedFromEntry,
  skillProgress,
  trialChecks,
  STAGNATION,
  WAVE_SIZE,
} from '../src/app/features/t-rex/curriculum.mjs';

const initial = JSON.parse(
  readFileSync(new URL('../src/app/features/t-rex/spatial-standing.json', import.meta.url)),
).policy;

test('expanded controller produces reproducible finite metrics in all three trials', () => {
  const policy = expandPolicy(initial);
  assert.equal(policy.length, sensorDimension);
  const a = assess('balance', policy);
  assert.deepEqual(a, assess('balance', policy));
  assert.equal(a.trials.length, 3);
  for (const m of a.trials) {
    assert.ok(Object.values(m).every((v) => typeof v === 'boolean' || Number.isFinite(v)));
    assert.ok(m.pathDistance >= m.maxDistance - 1e-9);
  }
});

test('checkpoint round trip preserves the random stream and all records', () => {
  const start = emptyCheckpoint();
  const wave = propose(start, initial);
  const evaluations = wave.candidates.map(({ policy }) => assess(start.stage, policy));
  const state = completeWave(start, wave, evaluations);
  assert.equal(state.iteration, WAVE_SIZE);
  assert.ok(state.physicsSteps > 0);
  const restored = parseCheckpoint(JSON.stringify(state));
  assert.deepEqual(restored, state);
  assert.deepEqual(propose(restored, initial), propose(state, initial));
  assert.equal(
    state.records.distance.value,
    Math.max(...evaluations.flatMap((e) => e.trials.map((m) => m.maxDistance))),
  );
  const record = state.records.distance;
  assert.equal(record.value, record.entry.evaluation.trials[record.trialIndex].maxDistance);
  assert.throws(() => parseCheckpoint(JSON.stringify({ ...state, format: 'wrong' })));
  assert.throws(() => parseCheckpoint(JSON.stringify({ ...state, rng: -1 })));
  const corrupted = JSON.parse(JSON.stringify(state));
  corrupted.history[0].policy[0] = null;
  assert.throws(() => parseCheckpoint(JSON.stringify(corrupted)));
});

test('falling, sliding and hopping cannot qualify as a stable walk or run', () => {
  const base = {
    fell: false,
    ticks: 960,
    stableTicks: 960,
    distance: 7,
    steps: 12,
    slip: 0.1,
    flightTicks: 180,
    flights: 5,
    averageSpeed: 0.875,
  };
  assert.equal(qualifies('run', base), true);
  assert.equal(qualifies('run', { ...base, fell: true }), false);
  assert.equal(qualifies('run', { ...base, flights: 0 }), false);
  assert.equal(qualifies('run', { ...base, slip: 4 }), false);
  assert.equal(qualifies('walk', base), false);
  assert.equal(qualifies('walk', { ...base, flightTicks: 0 }), true);
  assert.equal(qualifies('walk', { ...base, ticks: 500, flightTicks: 0 }), false);
});

test('curriculum advances only after every balance trial passes', () => {
  const state = emptyCheckpoint();
  assert.equal(nextStage(state).stage, 'balance');
  state.best.balance = { evaluation: { passes: 2 } };
  assert.equal(nextStage(state).stage, 'balance');
  state.best.balance.evaluation.passes = 3;
  assert.equal(nextStage(state).stage, 'recover');
});

test('manual skill selection and historical seeds preserve champions and old checkpoints', () => {
  const walk = selectSkill(emptyCheckpoint(), 'walk');
  const wave = propose(walk, initial);
  const result = assess('walk', wave.candidates[0].policy);
  const trained = completeWave(walk, wave, wave.candidates.map(() => result));
  const champion = trained.best.walk;
  assert.equal(skillProgress(trained).attempts, WAVE_SIZE);
  assert.ok(skillProgress(trained).population.length > 1);
  const selected = selectSkill(trained, 'balance');
  assert.deepEqual(selected.best.walk, champion);
  assert.deepEqual(parseCheckpoint(JSON.stringify(selected)), selected);
  const focused = seedFromEntry(selected, champion);
  assert.deepEqual(propose(focused, initial).candidates[0].policy, champion.policy);
  assert.deepEqual(focused.best.walk, champion);
  const legacy = { ...selected };
  delete legacy.search;
  delete legacy.autoAdvance;
  assert.equal(skillProgress(parseCheckpoint(JSON.stringify(legacy))).attempts, 0);
});

test('stagnation restarts exploration deterministically without discarding a champion', () => {
  const start = emptyCheckpoint();
  const wave = propose(start, initial);
  const result = assess('balance', wave.candidates[0].policy);
  const state = completeWave(start, wave, wave.candidates.map(() => result));
  state.iteration = STAGNATION;
  state.search.balance.attempts = STAGNATION;
  state.search.balance.sinceImprovement = STAGNATION;
  const restart = propose(state, initial);
  assert.equal(restart.restart, true);
  assert.deepEqual(restart, propose(parseCheckpoint(JSON.stringify(state)), initial));
  const updated = completeWave(state, restart, restart.candidates.map(() => result));
  assert.deepEqual(updated.best.balance, state.best.balance);
  assert.equal(skillProgress(updated).restarts, 1);
});

test('diagnostics use exactly the qualification limits, including strict boundaries', () => {
  const balance = {
    fell: false,
    ticks: 600,
    stableTicks: 420,
    settledTicks: 390,
    pathDistance: 0.349,
  };
  assert.equal(qualifies('balance', balance), true);
  const checks = trialChecks('balance', { ...balance, pathDistance: 0.35 });
  assert.deepEqual(checks.filter((check) => !check.passed).map((check) => check.label), [
    'Path distance',
  ]);
  assert.equal(qualifies('balance', { ...balance, pathDistance: 0.35 }), false);
  assert.equal(qualifies('balance', { ...balance, settledTicks: 389 }), false);
});
