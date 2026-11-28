import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTIONS, perturb, updateWeights } from '../src/app/features/t-rex/v2-ars.mjs';
import { createV2Rig, evaluate, passed, rewardDelta } from '../src/app/features/t-rex/v2-learning.mjs';
import { activeParameters, POLICY_SIZE } from '../src/app/features/t-rex/v2-policy.mjs';
import {
  advanceWeights,
  better,
  emptyCheckpoint,
  parseCheckpoint,
  propose,
  recordEvaluation,
} from '../src/app/features/t-rex/v2-search.mjs';

test('paired perturbations recover a simple reward gradient, not just a winning policy', () => {
  const weights = [0, 0];
  const wave = perturb(weights, [true, false], 3);
  assert.deepEqual(wave, perturb(weights, [true, false], 3));
  const rewards = wave.policies.map((policy) => policy[0]);
  const next = updateWeights(weights, wave.directions, rewards);
  assert.ok(next[0] > 0);
  assert.equal(next[1], 0);
  assert.deepEqual(updateWeights(weights, wave.directions, rewards.map(() => 0)), weights);
});

test('planar mode preserves anatomy, fixes lateral lanes, and masks inactive weights', () => {
  const rig = createV2Rig('planar');
  assert.equal(rig.bones.length, 17);
  assert.equal(rig.joints.length, 16);
  assert.equal(rig.motors.flatMap((motor) => motor.items).length, 26);
  const z = rig.bones.map((bone) => bone.body.position.z);
  for (let i = 0; i < 24; i++) rig.drive(Array(32).fill(0));
  rig.bones.forEach(({ body }, i) => {
    assert.ok(Math.abs(body.position.z - z[i]) < 1e-5);
  });
  const active = activeParameters('planar');
  assert.equal(active.length, POLICY_SIZE);
  assert.ok(active.some((value) => !value));
  const wave = propose(emptyCheckpoint('planar'));
  assert.ok(wave.policies.every((policy) => policy.every((value, i) => active[i] || value === 0)));
});

test('unrestricted neutral physics is finite and not falsely qualified as walking', () => {
  const m = evaluate(Array(POLICY_SIZE).fill(0), 'spatial');
  assert.ok(m.ticks > 0);
  assert.ok(Object.values(m).every((value) => typeof value === 'boolean' || Number.isFinite(value)));
  assert.equal(passed(m), false);
});

test('a lunge cannot earn more instantaneous progress than target speed; falling costs reward', () => {
  const sample = {
    dx: 0.0075,
    speed: 0.9,
    upright: 1,
    slip: 0,
    work: 0,
    air: 0,
    lateral: 0,
    fell: false,
    dt: 1 / 120,
  };
  const steady = rewardDelta(sample);
  assert.ok(rewardDelta({ ...sample, dx: 0.3, speed: 2 }) < steady);
  assert.ok(rewardDelta({ ...sample, fell: true }) < steady);
  assert.ok(rewardDelta({ ...sample, dx: 0, speed: 0 }) < steady);
});

test('qualification outranks a falling distance record and progress persists deterministically', () => {
  const state = emptyCheckpoint('spatial');
  const wave = propose(state);
  const next = advanceWeights(state, wave, wave.policies.map((p) => p[0]));
  assert.equal(next.iteration, 1);
  assert.equal(next.rollouts, 2 * DIRECTIONS);
  assert.deepEqual(parseCheckpoint(JSON.stringify(next), 'spatial'), next);
  assert.deepEqual(propose(next), propose(parseCheckpoint(JSON.stringify(next), 'spatial')));
  const passing = { passes: 1, medianScore: -1, medianDistance: 10, trials: [] };
  const lunge = { passes: 0, medianScore: 50, medianDistance: 20, trials: [] };
  assert.equal(better(passing, lunge), true);
  assert.equal(recordEvaluation(recordEvaluation(next, passing), lunge).best.evaluation, passing);
});
