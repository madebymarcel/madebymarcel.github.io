import test from 'node:test';
import assert from 'node:assert/strict';
import { createRig } from '../src/app/features/t-rex/spatial-rig.mjs';
import { createServoRig, neutralPolicy, POLICY_SIZE, targetsFor } from '../src/app/features/t-rex/servo-rig.mjs';
import { rewardDelta } from '../src/app/features/t-rex/servo-learning.mjs';
import { assess, completeWave, emptyCheckpoint, parseCheckpoint, propose, selectSkill, skillState, WAVE_SIZE } from '../src/app/features/t-rex/servo-search.mjs';
import { qualifies } from '../src/app/features/t-rex/curriculum.mjs';

test('servo rig retains anatomy and drives a real joint in either direction', () => {
  const rig = createServoRig();
  const original = createRig();
  assert.deepEqual(rig.bones.map(b => [b.name, b.length, b.width, b.depth, b.body.mass]), original.bones.map(b => [b.name, b.length, b.width, b.depth, b.body.mass]));
  assert.equal(rig.world.constraints.length, original.world.constraints.length);
  rig.world.gravity.setZero();
  const target = Array(32).fill(0);
  for (const angle of [0.5, -0.5]) {
    target[17] = angle;
    for (let i = 0; i < 60; i++) rig.drive(target);
    assert.ok(Math.abs(rig.observeJoints()[8].angle.z - angle) < 0.1);
  }
});

test('feedback controller has no clock and responds to asymmetric foot contact', () => {
  const rig = createServoRig();
  const p = neutralPolicy();
  assert.equal(p.length, POLICY_SIZE);
  p[12] = 1;
  assert.deepEqual(targetsFor(rig, neutralPolicy(), [true, false], 0.65, 0, [1, 0]), Array(32).fill(0));
  const a = targetsFor(rig, p, [true, false], 0.65, 0, [1, 0]);
  const b = targetsFor(rig, p, [false, true], 0.65, 0, [0, 1]);
  assert.equal(a[17], b[25]);
  assert.notEqual(a[17], a[25]);
});

test('reward makes a partial forward step valuable without qualifying a fall', () => {
  const sample = { dt: 1/120, dx: 0, dz: 0, slip: 0, air: 0, upright: 1, settled: false, lift: 0, step: 0, flight: 0, shift: 0, fell: false, work: 0, heading: 0, stopped: 0 };
  assert.ok(rewardDelta('walk', { ...sample, lift: 1, step: 1 }) > rewardDelta('walk', sample));
  assert.equal(rewardDelta('walk', { ...sample, fell: true }) - rewardDelta('walk', sample), -0.8);
  assert.equal(qualifies('walk', { fell: true, ticks: 960, stableTicks: 960, steps: 8, distance: 3, slip: 0, flightTicks: 0 }), false);
});

test('normal-ground evaluation, symmetric updates, independent skills and deterministic restore', () => {
  const state = emptyCheckpoint();
  const wave = propose(state);
  const result = assess('walk', wave.candidates[0].policy);
  assert.ok(Object.values(result.metrics).every(v => typeof v === 'boolean' || Number.isFinite(v)));
  const evaluations = wave.candidates.map((_, i) => ({ ...result, metrics: { ...result.metrics, score: i % 2 === 0 ? 2 : 1 } }));
  const next = completeWave(state, wave, evaluations);
  assert.equal(next.iteration, WAVE_SIZE);
  assert.notDeepEqual(skillState(next).weights, neutralPolicy());
  assert.equal(skillState(next).attempts, WAVE_SIZE);
  const restored = parseCheckpoint(JSON.stringify(next));
  assert.deepEqual(propose(restored), propose(next));
  const balance = selectSkill(restored, 'balance');
  assert.deepEqual(skillState(balance).weights, neutralPolicy());
  assert.deepEqual(skillState(selectSkill(balance, 'walk')), skillState(next));
  assert.throws(() => parseCheckpoint(JSON.stringify({ ...next, format: 'trex-locomotion-v2' })), /different controller/);
});
