import test from 'node:test';
import assert from 'node:assert/strict';
import seed from '../src/app/features/t-rex/seed-policy.json' with { type: 'json' };
import { createServoRig } from '../src/app/features/t-rex/servo-rig.mjs';
import { evaluate, trial } from '../src/app/features/t-rex/servo-learning.mjs';
import {
  achievements,
  completeWave,
  emptyCheckpoint,
  parseCheckpoint,
  propose,
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

test('one cumulative search preserves the physical checkpoint and deterministic random stream', () => {
  const state = emptyCheckpoint();
  const wave = propose(state);
  // Pure state-management test: deliberately inferior scores must not replace the real seed.
  const bad = { ...state.best.metrics, steps: 0, score: -10, distance: 0, stableTicks: 0 };
  const next = completeWave(state, wave, Array(WAVE_SIZE).fill(bad));
  assert.deepEqual(next.best, state.best);
  assert.deepEqual(next.records, state.records);
  assert.equal(next.stale, 1);
  assert.equal(next.iteration, WAVE_SIZE);
  assert.notDeepEqual(propose(next), wave);
  const restored = parseCheckpoint(JSON.stringify(next));
  assert.deepEqual(propose(restored), propose(next));
  assert.throws(() => parseCheckpoint(JSON.stringify({ ...next, format: 'trex-servo-v3' })));
});

test('milestones distinguish real forward steps from sustained walking', () => {
  const m = evaluate(seed.policy);
  assert.ok(achievements(m).includes('step'));
  assert.ok(achievements(m).includes('alternate'));
  assert.equal(achievements(m).includes('walk'), false);
  const walking = {
    ...m,
    ticks: 960,
    steps: 8,
    distance: 3,
    slip: 0.2,
    flightTicks: 0,
    fell: false,
  };
  assert.ok(achievements(walking).includes('walk'));
  assert.equal(achievements({ ...walking, fell: true }).includes('walk'), false);
});
