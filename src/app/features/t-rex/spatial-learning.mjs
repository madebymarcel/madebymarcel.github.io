import { createRig } from './spatial-rig.mjs';
const weightsPerAxis = 7;
export const dimension = 16 * 2 * weightsPerAxis;
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
    const features = [
      1,
      vertical.x,
      vertical.z,
      trunk.angularVelocity.x * 0.2,
      trunk.angularVelocity.z * 0.2,
      Number(contact[0]),
      Number(contact[1]),
    ];
    const actions = [];
    for (const [i, { a, b }] of rig.joints.entries()) {
      const target = a.quaternion.mult(rests[i]);
      const displacement = a.quaternion
        .inverse()
        .mult(b.quaternion.mult(target.inverse()))
        .mult(a.quaternion);
      const rate = a.vectorToLocalFrame(b.angularVelocity.vsub(a.angularVelocity));
      for (const axis of ['y', 'z']) {
        const offset = actions.length * weightsPerAxis;
        const active = features.reduce((sum, value, j) => sum + value * policy[offset + j], 0);
        actions.push(
          Math.tanh(active) -
            4 * displacement[axis] * Math.sign(displacement.w) -
            0.018 * rate[axis],
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
    return { ticks, fell, distance, steps, score: (ticks + upright) / 120 + steps + distance };
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
  let best = Array.from({ length: dimension }, () => (random() - 0.5) * 0.4);
  let score = -Infinity,
    iteration = 0;
  return () => {
    const candidate = iteration
      ? best.map((w) => (random() < 0.18 ? w + (random() - 0.5) * 0.7 : w))
      : best;
    const result = evaluate(candidate, {});
    if (result.score > score) {
      best = candidate;
      score = result.score;
    }
    return { iteration: ++iteration, policy: best, score };
  };
}

// Fine-tune the newly trained checkpoint against starts excluded from the test pairs.
export function refine(initial, objective, seed, candidates) {
  const random = generator(seed);
  const starts = [
    {},
    { lateralVelocity: -0.075, friction: 0.8 },
    { lateralVelocity: 0.065, friction: 0.9 },
  ];
  function fitness(policy) {
    const scores = starts.map((start) => {
      const m = evaluate(policy, start);
      if (objective === 'stand') return m.ticks / 120 - Math.abs(m.distance);
      return m.ticks / 120 + Math.min(m.steps, 8) * 0.75 + m.distance;
    });
    return Math.min(...scores) * 0.65 + (scores.reduce((a, b) => a + b, 0) / scores.length) * 0.35;
  }
  let policy = initial.slice(),
    score = fitness(policy);
  for (let i = 0; i < candidates; i++) {
    const magnitude = [0.01, 0.04, 0.12, 0.4][i % 4];
    const candidate = policy.map((w) => (random() < 0.08 ? w + (random() - 0.5) * magnitude : w));
    const value = fitness(candidate);
    if (value > score) {
      score = value;
      policy = candidate;
    }
  }
  return { policy, score };
}
