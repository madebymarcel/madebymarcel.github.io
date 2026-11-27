import test from 'node:test';
import assert from 'node:assert/strict';
import { createRig } from '../src/app/features/t-rex/spatial-rig.mjs';
import {
  createServoRig,
  neutralPolicy,
  POLICY_SIZE,
  targetsFor,
} from '../src/app/features/t-rex/servo-rig.mjs';
import { rewardDelta } from '../src/app/features/t-rex/servo-learning.mjs';
import {
  assess,
  completeWave,
  emptyCheckpoint,
  parseCheckpoint,
  propose,
  selectSkill,
  skillState,
  WAVE_SIZE,
} from '../src/app/features/t-rex/servo-search.mjs';
import { qualifies } from '../src/app/features/t-rex/curriculum.mjs';

test('servo rig retains anatomy and drives a real joint in either direction', () => {
  const rig = createServoRig();
  const original = createRig();
  assert.deepEqual(
    rig.bones.map((b) => [b.name, b.length, b.width, b.depth, b.body.mass]),
    original.bones.map((b) => [b.name, b.length, b.width, b.depth, b.body.mass]),
  );
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
  assert.ok(
    targetsFor(rig, neutralPolicy(), [true, false], 0.65, 0, [1, 0]).every((x) => x === 0),
  );
  const a = targetsFor(rig, p, [true, false], 0.65, 0, [1, 0]);
  const b = targetsFor(rig, p, [false, true], 0.65, 0, [0, 1]);
  assert.equal(a[17], b[25]);
  assert.notEqual(a[17], a[25]);
});

test('reward makes a partial forward step valuable without qualifying a fall', () => {
  const sample = {
    dt: 1 / 120,
    dx: 0,
    dz: 0,
    slip: 0,
    air: 0,
    upright: 1,
    settled: false,
    lift: 0,
    step: 0,
    flight: 0,
    shift: 0,
    fell: false,
    work: 0,
    heading: 0,
    stopped: 0,
  };
  assert.ok(rewardDelta('walk', { ...sample, lift: 1, step: 1 }) > rewardDelta('walk', sample));
  assert.ok(rewardDelta('walk', { ...sample, clearanceProgress: 0.01 }) > rewardDelta('walk', sample));
  assert.equal(rewardDelta('walk', { ...sample, fell: true }) - rewardDelta('walk', sample), -0.8);
  assert.equal(
    qualifies('walk', {
      fell: true,
      ticks: 960,
      stableTicks: 960,
      steps: 8,
      distance: 3,
      slip: 0,
      flightTicks: 0,
    }),
    false,
  );
});

test('normal-ground evaluation, symmetric updates, independent skills and deterministic restore', () => {
  const state = emptyCheckpoint();
  const wave = propose(state);
  const result = assess('walk', wave.candidates[0].policy);
  assert.ok(
    Object.values(result.metrics).every((v) => typeof v === 'boolean' || Number.isFinite(v)),
  );
  const evaluations = wave.candidates.map((_, i) => ({
    ...result,
    metrics: { ...result.metrics, score: i % 2 === 0 ? 2 : 1 },
  }));
  const next = completeWave(state, wave, evaluations);
  assert.equal(next.iteration, WAVE_SIZE);
  assert.notDeepEqual(skillState(next).weights, neutralPolicy());
  assert.equal(skillState(next).attempts, WAVE_SIZE);
  const restored = parseCheckpoint(JSON.stringify(next));
  assert.deepEqual(propose(restored), propose(next));
  const balance = selectSkill(restored, 'balance');
  assert.deepEqual(skillState(balance).weights, neutralPolicy());
  assert.deepEqual(skillState(selectSkill(balance, 'walk')), skillState(next));
  assert.throws(
    () => parseCheckpoint(JSON.stringify({ ...next, format: 'trex-locomotion-v2' })),
    /different controller/,
  );
});

test('the asymmetric start preserves all physical joint anchors and ground clearance', () => {
  const rig = createServoRig({ startSplit: 0.045 });
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
  assert.ok(Math.abs(rig.observeJoints()[8].angle.z - 0.045) < 1e-9);
});

test('real servos can lift a foot while the opposite foot supports the rig', () => {
  const rig = createServoRig();
  const targets = Array(32).fill(0);
  const feet = rig.bones.filter((b) => b.name.startsWith('toes')).map((b) => b.body);
  let planted = false;
  let clearance = 0;
  let forward = 0;
  for (let i = 0; i < 100; i++) {
    // A diagnostic joint command, never used by the learned policy.
    if (i >= 16) {
      targets[17] = 0.5;
      targets[19] = -0.6;
      targets[21] = 0.4;
    }
    rig.drive(targets);
    const loaded = feet.map((foot) =>
      rig.world.contacts.some(
        (c) =>
          ((c.bi === rig.ground && c.bj === foot) || (c.bj === rig.ground && c.bi === foot)) &&
          c.multiplier > 0.01,
      ),
    );
    if (loaded[0]) planted = true;
    feet[0].updateAABB();
    const upright = rig.trunk.body.vectorToWorldFrame(rig.up).y;
    if (planted && !loaded[0] && loaded[1] && upright > 0.55 && rig.trunk.body.position.y > 0.6) {
      clearance = Math.max(clearance, feet[0].aabb.lowerBound.y);
      forward = Math.max(forward, feet[0].position.x - feet[1].position.x);
    }
    if (upright < 0.55 || rig.trunk.body.position.y < 0.6) break;
  }
  assert.ok(clearance > 0.025, 'one sole clears the ground while the other is loaded');
  assert.ok(forward > 0.05, 'the swinging foot can move ahead of the supporting foot');
});
