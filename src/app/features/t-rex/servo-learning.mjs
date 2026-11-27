import { createServoRig } from './servo-rig.mjs';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const POLICY_SIZE = 32;
export const TRIAL_SECONDS = 12;
export const GAIT_DEFAULTS = [0.07, 0.025, 0.05, 0];
export const PARAMETER_SCALE = [
  0.18, 0.2, 0.2, 0.15, 0.25, 0.16, 1, 0.4, 0.5, 0.4, 0.6, 0.3, 0.3, 0.3, 0.25, 0.3, 0.3, 0.3, 0.25,
  0.16, 0.3, 0.3, 0.2, 0.08, 0.2, 0.2, 0.08, 0.2, 0.15, 0.06, 0.12, 0.25,
];

// Standing time is not locomotion. Reward net upright forward travel.
export function distanceScore({ distance, forwardUpright, steps, slip, lateralDistance, fell }) {
  const progress = Math.min(distance, forwardUpright);
  const credited = progress > 0 && steps === 0 ? 0.1 * progress : progress;
  return 10 * credited - 1.5 * slip - 0.8 * lateralDistance - (fell ? 0.25 : 0);
}

// Controller parameters describe feedback gains and joint target offsets, not poses or timings.
// The support/lift/swing/plant transitions are triggered by measured contacts and foot placement.
export function boundPolicy(policy) {
  return policy.map((value, i) => {
    if (i === 4) return clamp(value, 0.12, 0.9);
    if (i === 5) return clamp(value, 0.05, 0.3);
    if (i === 6) return clamp(value, 0, 4);
    if (i === 7) return clamp(value, 0, 2);
    if (i === 28) return clamp(value, 0.055, 0.45);
    if (i === 29) return clamp(value, 0.025, 0.16);
    if (i === 30) return clamp(value, 0.05, 0.35);
    if (i === 31) return clamp(value, -0.2, 0.35);
    return clamp(value, -3, 3);
  });
}

export function trial(policy, options = {}) {
  if (policy.length !== POLICY_SIZE || !policy.every(Number.isFinite)) {
    throw new Error('Invalid locomotion policy.');
  }
  const p = boundPolicy(policy);
  const rig = createServoRig({ ...options, startSplit: options.startSplit ?? 0.045 });
  const { bones, world, ground, dt } = rig;
  const trunk = rig.trunk.body;
  const feet = bones.filter((b) => b.name.startsWith('toes')).map((b) => b.body);
  const forbidden = new Set(
    bones.filter((b) => /^(trunk|skull|neck|tail)/.test(b.name)).map((b) => b.body),
  );
  const mass = bones.reduce((sum, b) => sum + b.body.mass, 0);
  const limit = Math.round((options.seconds ?? TRIAL_SECONDS) / dt);
  const origin = trunk.position.x;
  const loads = [0, 0];
  const contacts = [false, false];
  let phase = 0;
  let swing = options.startSplit < 0 ? 0 : 1;
  let start = feet[swing].position.x;
  let prevComZ = 0;
  let ticks = 0;
  let steps = 0;
  let lifts = 0;
  let fell = false;
  let distance = 0;
  let maxClearance = 0;
  let maxForward = 0;
  let settledTicks = 0;
  let settled = 0;
  let supportTicks = 0;
  let supported = 0;
  let stableTicks = 0;
  let slip = 0;
  let work = 0;
  let flightTicks = 0;
  let phaseProgress = 0;
  let lateralDistance = 0;
  let supportTotal = 0;
  let forwardUpright = 0;
  let previousX = origin;
  const originZ = trunk.position.z;

  function advance() {
    if (fell || ticks >= limit) return;
    let comX = 0;
    let comZ = 0;
    for (const { body } of bones) {
      comX += body.position.x * body.mass;
      comZ += body.position.z * body.mass;
    }
    comX /= mass;
    comZ /= mass;
    const comVz = (comZ - prevComZ) / dt;
    prevComZ = comZ;
    const vertical = trunk.vectorToWorldFrame(rig.up);
    const roll = vertical.z;
    const pitch = vertical.x;
    const support = 1 - swing;
    const desiredZ = feet[support].position.z;
    const desiredX = (feet[support].position.x + feet[swing].position.x) / 2;
    feet[swing].updateAABB();
    const h = feet[swing].aabb.lowerBound.y;
    const ahead = feet[swing].position.x - feet[support].position.x;
    const travel = feet[swing].position.x - start;
    if (phase === 0 && contacts[0] && contacts[1] && loads[support] > 0.25) {
      phase = 1;
      start = feet[swing].position.x;
    }
    if (phase === 1 && loads[support] > p[4] && Math.abs(desiredZ - comZ) < p[5]) {
      phase = 2;
    }
    if (phase === 2 && !contacts[swing] && contacts[support] && h > p[29]) {
      phase = 3;
      lifts++;
    }
    if (phase === 3 && ahead > p[28] && travel > p[28]) phase = 4;
    if (phase === 4 && contacts[swing] && h < 0.025) {
      if (contacts[support] && ahead > p[30] && travel > p[30] && vertical.y > 0.9) {
        steps++;
        swing = support;
      }
      phase = 1;
      start = feet[swing].position.x;
    } else if (phase === 3 && contacts[swing]) {
      phase = 1;
      start = feet[swing].position.x;
    }
    phaseProgress = Math.max(phaseProgress, phase);
    const goalZ = phase === 0 ? 0 : desiredZ;
    const lateral = clamp(p[6] * (goalZ - comZ) - p[7] * comVz + p[8] * roll, -0.32, 0.32);
    const targets = Array(32).fill(0);
    for (let side = 0; side < 2; side++) {
      const j = 16 + 8 * side;
      targets[j] = lateral;
      targets[j + 1] = p[0] + p[9] * pitch + p[10] * (comX - desiredX + p[31]);
      targets[j + 3] = p[1];
      targets[j + 5] = p[2];
      targets[j + 7] = p[3];
      if (side === swing && phase >= 2) {
        targets[j] += p[19] * (side === 0 ? -1 : 1) + p[20] * comVz + p[21] * roll;
        const offset = phase === 4 ? 15 : 11;
        for (let k = 0; k < 4; k++) targets[j + 1 + 2 * k] += p[offset + k];
      }
    }
    // Each axial joint uses physical feedback; the tail remains a massive, freely moving chain.
    for (let i = 0; i < 8; i++) {
      const scale = i < 2 ? 0.35 : 1 - (i - 2) * 0.1;
      targets[2 * i] = scale * (p[22] * roll + p[23] * trunk.angularVelocity.x + p[24] * comVz);
      targets[2 * i + 1] =
        scale * (p[25] * pitch + p[26] * trunk.angularVelocity.z + p[27] * trunk.velocity.x);
    }
    rig.drive(targets);
    ticks++;
    loads.fill(0);
    let bodyContact = false;
    let slipSpeed = 0;
    for (const c of world.contacts) {
      const body = c.bi === ground ? c.bj : c.bj === ground ? c.bi : null;
      if (!body || c.multiplier <= 0.01) continue;
      const index = feet.indexOf(body);
      if (index >= 0) {
        loads[index] += c.multiplier / (mass * 9.81);
        const offset = body === c.bi ? c.ri : c.rj;
        const point = body.position.vadd(offset);
        const velocity = body.velocity.vadd(body.angularVelocity.cross(point.vsub(body.position)));
        slipSpeed = Math.max(slipSpeed, Math.hypot(velocity.x, velocity.z));
      }
      if (forbidden.has(body)) bodyContact = true;
    }
    for (let i = 0; i < 2; i++) contacts[i] = loads[i] > 0.01;
    const up = trunk.vectorToWorldFrame(rig.up).y;
    fell = trunk.position.y < 0.6 || up < 0.55 || bodyContact;
    if (fell) return;
    slip += slipSpeed * dt;
    distance = trunk.position.x - origin;
    lateralDistance = Math.abs(trunk.position.z - originZ);
    const dx = trunk.position.x - previousX;
    previousX = trunk.position.x;
    forwardUpright += dx < 0 ? dx : dx * clamp((up - 0.55) / 0.35, 0, 1);
    if (contacts[0] !== contacts[1] && Math.max(...loads) > 0.45 && up > 0.9) supportTotal++;
    if (up > 0.9 && trunk.position.y > 0.8) stableTicks++;
    if (contacts[0] && contacts[1] && up > 0.94 && trunk.velocity.length() < 0.18) {
      settled++;
      settledTicks = Math.max(settledTicks, settled);
    } else settled = 0;
    if (!contacts[swing] && contacts[1 - swing]) {
      feet[swing].updateAABB();
      const clearance = feet[swing].aabb.lowerBound.y;
      if (clearance > 0.025) {
        maxClearance = Math.max(maxClearance, clearance);
        maxForward = Math.max(maxForward, feet[swing].position.x - feet[1 - swing].position.x);
        if (loads[1 - swing] > 0.45 && up > 0.9) {
          supported++;
          supportTicks = Math.max(supportTicks, supported);
        } else supported = 0;
      } else supported = 0;
    } else supported = 0;
    if (!contacts[0] && !contacts[1]) flightTicks++;
    for (const { joint, items } of rig.motors) {
      const relative = joint.a.angularVelocity.vsub(joint.b.angularVelocity);
      for (const { motor } of items) {
        work += Math.abs(motor.multiplier * relative.dot(motor.axisA)) * dt;
      }
    }
  }

  function metrics() {
    const score = distanceScore({ distance, forwardUpright, steps, slip, lateralDistance, fell });
    return {
      ticks,
      fell,
      distance,
      steps,
      lifts,
      maxClearance,
      maxForward,
      stableTicks,
      settledTicks,
      supportTicks,
      slip,
      work,
      flightTicks,
      phaseProgress,
      score,
      lateralDistance,
      supportTotal,
      forwardUpright,
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
