import { createRig } from './spatial-rig.mjs';
const weightsPerAxis = 9;
export const dimension = 12 * 2 * weightsPerAxis + 1;
export const sensorCount = 22;
export const sensorDimension = 12 * 2 * sensorCount + 1;

export function expandPolicy(policy) {
  if (policy.length === sensorDimension) return [...policy];
  if (policy.length !== dimension) throw new Error('Unknown T. rex policy size.');
  const expanded = Array(sensorDimension).fill(0);
  for (let axis = 0; axis < 24; axis++) {
    for (let i = 0; i < weightsPerAxis; i++) {
      expanded[axis * sensorCount + i] = policy[axis * weightsPerAxis + i];
    }
  }
  expanded[sensorDimension - 1] = policy[dimension - 1];
  return expanded;
}
export function generator(seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
export function trial(policy, options = {}) {
  const enhanced = policy.length === sensorDimension;
  const stage = options.stage ?? 'walk';
  const rig = createRig({ ...options, selfCollision: enhanced && options.selfCollision !== false });
  const width = enhanced ? sensorCount : weightsPerAxis;
  const duration = options.seconds ?? 5;
  const limit = Math.round(duration / rig.dt);
  const totalMass = rig.bones.reduce((sum, bone) => sum + bone.body.mass, 0);
  const forbidden = new Set(
    rig.bones.filter((b) => /^(skull|neck|trunk|tail)/.test(b.name)).map((b) => b.body),
  );
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
  let maxDistance = 0;
  let pathDistance = 0;
  let lastX = start;
  let lastZ = rig.trunk.body.position.z;
  let stableTicks = 0;
  let settledTicks = 0;
  let supportedTicks = 0;
  let bothFeetTicks = 0;
  let shiftTicks = 0;
  let flights = 0;
  let flightTicks = 0;
  let air = 0;
  let takeoff = -1;
  let lastFlight = -1;
  let slip = 0;
  let headingError = 0;
  let stoppingTicks = 0;
  const loads = [0, 0];
  const footX = feet.map((foot) => foot.position.x);
  const footZ = feet.map((foot) => foot.position.z);
  const actions = Array(rig.joints.length * 2).fill(0);
  const features = Array(width).fill(0);
  function command(time) {
    if (!enhanced) return { speed: 1, heading: 0, cyclic: true };
    if (stage === 'balance' || stage === 'recover') {
      return { speed: 0, heading: 0, cyclic: false };
    }
    if (stage === 'maneuver') {
      return { speed: time < 6 ? 0.55 : 0, heading: time < 2 ? 0 : 0.6, cyclic: time < 6 };
    }
    const speed = stage === 'run' ? 1.4 : stage === 'walk' ? 0.65 : stage === 'step' ? 0.3 : 0;
    return { speed, heading: 0, cyclic: true };
  }
  function advance() {
    const trunk = rig.trunk.body,
      vertical = trunk.vectorToWorldFrame(rig.up);
    const time = ticks * rig.dt;
    const targetCommand = command(time);
    const frequency = enhanced && stage === 'run' ? 11 : 5;
    const phase = time * (frequency + 3 * Math.tanh(policy[policy.length - 1]));
    const supportTarget = Math.sin(phase);
    const heading = Math.atan2(
      2 * (trunk.quaternion.x * trunk.quaternion.z - trunk.quaternion.w * trunk.quaternion.y),
      1 - 2 * (trunk.quaternion.y ** 2 + trunk.quaternion.z ** 2),
    );
    let comX = 0;
    let comZ = 0;
    if (enhanced) {
      for (const { body } of rig.bones) {
        comX += body.position.x * body.mass;
        comZ += body.position.z * body.mass;
      }
      comX /= totalMass;
      comZ /= totalMass;
    }
    const supportCount = Number(contact[0]) + Number(contact[1]);
    const supportX = supportCount
      ? (feet[0].position.x * Number(contact[0]) + feet[1].position.x * Number(contact[1])) /
        supportCount
      : (feet[0].position.x + feet[1].position.x) / 2;
    const supportZ = supportCount
      ? (feet[0].position.z * Number(contact[0]) + feet[1].position.z * Number(contact[1])) /
        supportCount
      : (feet[0].position.z + feet[1].position.z) / 2;
    features[0] = 1;
    features[1] = vertical.x;
    features[4] = trunk.angularVelocity.z * 0.2;
    for (const [i, { a, b }] of rig.joints.entries()) {
      features[7] = i >= 8 && targetCommand.cyclic ? Math.sin(phase) : 0;
      features[8] = i >= 8 && targetCommand.cyclic ? Math.cos(phase) : 0;
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
        const offset = ((right ? i - 4 : i) * 2 + Number(axis === 'z')) * width;
        const cyclic = features[7] * policy[offset + 7] + features[8] * policy[offset + 8];
        let active = 0;
        for (let j = 0; j < 7; j++) active += features[j] * policy[offset + j];
        if (enhanced) {
          const foot = feet[right ? 1 : 0];
          const axisMirror = axis === 'z' ? 1 : mirror;
          features[9] = displacement[axis] * Math.sign(displacement.w) * axisMirror;
          features[10] = rate[axis] * 0.2 * axisMirror;
          features[11] = (comX - supportX) * 2;
          features[12] = (comZ - supportZ) * 2 * mirror;
          features[13] = trunk.velocity.x * 0.5;
          features[14] = trunk.velocity.z * 0.5 * mirror;
          features[15] = foot.position.x - trunk.position.x;
          features[16] = foot.position.y;
          features[17] = loads[right ? 1 : 0];
          features[18] = targetCommand.speed;
          features[19] = Math.sin(targetCommand.heading - heading) * mirror;
          features[20] = stage === 'shift' ? supportTarget * mirror : 0;
          features[21] = trunk.position.y - 1;
          for (let j = 9; j < width; j++) active += features[j] * policy[offset + j];
        }
        actions[2 * i + Number(axis === 'z')] =
          (Math.tanh(active) + 3 * Math.tanh(cyclic)) * (axis === 'z' ? 1 : mirror) -
          (i >= 2 && i < 8 ? 36 : 10) * displacement[axis] * Math.sign(displacement.w) -
          (i < 8 ? 0.018 : 0.08) * rate[axis];
      }
    }
    rig.step(actions, enhanced);
    ticks++;
    const previousSupport = Number(contact[0]) + Number(contact[1]);
    const previousFoot = contact[0] ? 0 : contact[1] ? 1 : -1;
    const nextContact = [false, false];
    loads.fill(0);
    let bodyContact = false;
    for (const c of rig.world.contacts) {
      const body = c.bi === rig.ground ? c.bj : c.bj === rig.ground ? c.bi : null;
      if (!body) continue;
      const index = feet.indexOf(body);
      if (index >= 0) {
        nextContact[index] = true;
        loads[index] += Math.max(0, c.multiplier || 0) / (totalMass * 9.81);
      }
      if (forbidden.has(body) && (enhanced || body !== rig.bones[1].body)) bodyContact = true;
    }
    for (const [i, foot] of feet.entries()) {
      if (contact[i] && nextContact[i]) {
        slip += Math.hypot(foot.position.x - footX[i], foot.position.z - footZ[i]);
      }
      footX[i] = foot.position.x;
      footZ[i] = foot.position.z;
      contact[i] = nextContact[i];
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
    fell ||= trunk.position.y < 0.6 || vertical.y < 0.55 || bodyContact;
    if (fell) return;
    const support = Number(contact[0]) + Number(contact[1]);
    if (support) {
      supportedTicks++;
      if (support === 2) bothFeetTicks++;
      if (air >= 3 && takeoff >= 0 && support === 1) {
        const land = contact[0] ? 0 : 1;
        if (land !== takeoff && land !== lastFlight) {
          flights++;
          lastFlight = land;
        }
      }
      air = 0;
      if (support === 1 && contact[supportTarget >= 0 ? 0 : 1]) shiftTicks++;
    } else {
      if (previousSupport) takeoff = previousSupport === 1 ? previousFoot : -1;
      air++;
      flightTicks++;
    }
    if (vertical.y > 0.9 && trunk.position.y > 0.8) stableTicks++;
    if (
      support === 2 &&
      vertical.y > 0.94 &&
      trunk.position.y > 0.85 &&
      trunk.velocity.length() < 0.18 &&
      trunk.angularVelocity.length() < 0.8
    ) {
      settledTicks++;
    }
    if (time >= 6 && trunk.velocity.length() < 0.2 && support === 2) stoppingTicks++;
    maxDistance = Math.max(maxDistance, trunk.position.x - start);
    pathDistance += Math.hypot(trunk.position.x - lastX, trunk.position.z - lastZ);
    lastX = trunk.position.x;
    lastZ = trunk.position.z;
    headingError += Math.abs(Math.sin(targetCommand.heading - heading));
  }
  function metrics() {
    const distance = rig.trunk.body.position.x - start;
    return {
      ticks,
      fell,
      distance,
      steps,
      maxDistance,
      pathDistance,
      stableTicks,
      settledTicks,
      supportedTicks,
      bothFeetTicks,
      shiftTicks,
      flights,
      flightTicks,
      slip,
      headingError,
      stoppingTicks,
      averageSpeed: ticks ? (lastX - start) / (ticks * rig.dt) : 0,
      score: (ticks + upright) / 400 + 4 * Math.min(steps, 8) + 2 * distance,
    };
  }
  return {
    rig,
    advance,
    metrics,
    get done() {
      return fell || ticks >= limit;
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
