import { createRig } from './spatial-rig.mjs';
const weightsPerAxis = 9;
export const dimension = 12 * 2 * weightsPerAxis + 1;
export function generator(seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
export function trial(policy, options = {}) {
  const rig = createRig(options);
  const rests = rig.joints.map(({ a, b }) => a.quaternion.inverse().mult(b.quaternion));
  const feet = rig.bones.filter((b) => b.name.startsWith('toes')).map((b) => b.body);
  const airborne = [0, 0],
    contact = [false, false];
  let last = -1,
    landing = -Infinity,
    steps = 0,
    ticks = 0,
    fell = false;
  const start = rig.trunk.body.position.x;
  let upright = 0;
  function advance() {
    const trunk = rig.trunk.body,
      vertical = trunk.vectorToWorldFrame(rig.up);
    const phase = ticks * rig.dt * (5 + 3 * Math.tanh(policy[dimension - 1]));
    const features = [
      1,
      vertical.x,
      vertical.z,
      trunk.angularVelocity.x * 0.2,
      trunk.angularVelocity.z * 0.2,
      Number(contact[0]),
      Number(contact[1]),
      0,
      0,
    ];
    const actions = [];
    for (const [i, { a, b }] of rig.joints.entries()) {
      features[7] = i >= 8 ? Math.sin(phase) : 0;
      features[8] = i >= 8 ? Math.cos(phase) : 0;
      const target = a.quaternion.mult(rests[i]);
      const displacement = a.quaternion
        .inverse()
        .mult(b.quaternion.mult(target.inverse()))
        .mult(a.quaternion);
      const rate = a.vectorToLocalFrame(b.angularVelocity.vsub(a.angularVelocity));
      const right = i >= 12,
        mirror = right ? -1 : 1;
      features[2] = vertical.z * mirror;
      features[3] = trunk.angularVelocity.x * 0.2 * mirror;
      features[5] = Number(contact[right ? 1 : 0]);
      features[6] = Number(contact[right ? 0 : 1]);
      features[7] *= mirror;
      features[8] *= mirror;
      const hip = i === 8 || i === 12;
      for (const axis of [hip ? 'x' : 'y', 'z']) {
        const offset = ((right ? i - 4 : i) * 2 + Number(axis === 'z')) * weightsPerAxis;
        const cyclic = features[7] * policy[offset + 7] + features[8] * policy[offset + 8];
        const active = features
          .slice(0, 7)
          .reduce((sum, value, j) => sum + value * policy[offset + j], 0);
        actions.push(
          (Math.tanh(active) + 3 * Math.tanh(cyclic)) * (axis === 'z' ? 1 : mirror) -
            (i >= 2 && i < 8 ? 36 : 10) * displacement[axis] * Math.sign(displacement.w) -
            (i < 8 ? 0.018 : 0.08) * rate[axis],
        );
      }
    }
    rig.step(actions);
    ticks++;
    for (const [i, foot] of feet.entries()) {
      contact[i] = rig.world.contacts.some(
        (c) => (c.bi === foot && c.bj === rig.ground) || (c.bj === foot && c.bi === rig.ground),
      );
      if (contact[i]) {
        if (airborne[i] >= 6 && i !== last && foot.position.x > landing + 0.05) {
          if (last >= 0) steps++;
          last = i;
          landing = foot.position.x;
        }
        airborne[i] = 0;
      } else airborne[i]++;
    }
    upright += Math.max(0, vertical.y);
    fell ||=
      trunk.position.y < 0.6 ||
      vertical.y < 0.55 ||
      rig.world.contacts.some(
        (c) =>
          [c.bi, c.bj].includes(rig.ground) &&
          rig.bones.some(
            (b) => /^(skull|trunk|tail)/.test(b.name) && [c.bi, c.bj].includes(b.body),
          ),
      );
  }
  function metrics() {
    const distance = rig.trunk.body.position.x - start;
    return {
      ticks,
      fell,
      distance,
      steps,
      score: (ticks + upright) / 400 + 4 * Math.min(steps, 8) + 2 * distance,
    };
  }
  return {
    rig,
    advance,
    metrics,
    get done() {
      return fell || ticks >= 600;
    },
  };
}
export function evaluate(policy, options) {
  const run = trial(policy, options);
  while (!run.done) run.advance();
  return run.metrics();
}
export function trainer(seed) {
  const random = generator(seed);
  let best = Array.from({ length: dimension }, () => (random() - 0.5) * 0.08);
  let score = -Infinity,
    iteration = 0;
  return () => {
    const candidate = iteration
      ? best.map((w) =>
          random() < 0.18 ? w + (random() - 0.5) * [0.04, 0.15, 0.5, 1.2][iteration % 4] : w,
        )
      : best;
    const result = evaluate(candidate, {});
    if (result.score > score) {
      best = candidate;
      score = result.score;
    }
    return { iteration: ++iteration, policy: best, score };
  };
}
