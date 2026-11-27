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
