import { Vec3 } from 'cannon-es';
import { createServoRig } from './servo-rig.mjs';
import { POLICY_SIZE, targetsFor } from './v2-policy.mjs';

export const SECONDS = 12;
export const TARGET_SPEED = 0.9;
export const DT = 1 / 120;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const blankContact = () => ({ heel: false, toe: false, load: 0 });
const touching = (contact) => contact.heel || contact.toe;

// The planar ablation constrains each body to its original sagittal lane.
// It changes degrees of freedom, not masses, motors, joints or ground friction.
export function createV2Rig(mode, options = {}) {
  const rig = createServoRig({
    ...options,
    startSplit: options.startSplit ?? 0.045,
    lateralVelocity: mode === 'planar' ? 0 : options.lateralVelocity,
  });
  if (mode === 'planar') {
    for (const { body } of rig.bones) {
      body.linearFactor.set(1, 1, 0);
      body.angularFactor.set(0, 0, 1);
    }
  }
  return rig;
}

export function rewardDelta({ dx, speed, upright, slip, work, air, lateral, fell, dt }) {
  // No survival bonus at rest, no distance jackpot from a single lunge.
  const progress = Math.min(dx, TARGET_SPEED * dt) * (dx > 0 ? upright : 1);
  const error = Math.abs(clamp(speed, -2, 2) - TARGET_SPEED);
  return (
    progress -
    0.2 * error * dt -
    0.8 * slip -
    0.00025 * work -
    0.8 * air -
    0.5 * lateral -
    (fell ? 0.8 : 0)
  );
}

export function trial(weights, mode = 'spatial', options = {}) {
  if (weights.length !== POLICY_SIZE || !weights.every(Number.isFinite)) {
    throw new Error('Invalid V2 policy.');
  }
  const rig = createV2Rig(mode, options);
  const { world, ground, dt } = rig;
  const trunk = rig.trunk.body;
  const feet = rig.bones.filter((bone) => bone.name.startsWith('toes')).map((bone) => bone.body);
  const forbidden = new Set(
    rig.bones.filter((bone) => /^(trunk|skull|neck|tail)/.test(bone.name)).map((bone) => bone.body),
  );
  const mass = rig.bones.reduce((sum, bone) => sum + bone.body.mass, 0);
  const origin = trunk.position.clone();
  const limit = Math.round((options.seconds ?? SECONDS) / dt);
  const up = new Vec3(0, 1, 0);
  let contacts = [blankContact(), blankContact()];
  let targets = Array(32).fill(0);
  let lastLanded = -1;
  const lifted = [false, false];
  let ticks = 0;
  let fell = false;
  let distance = 0;
  let steps = 0;
  let slip = 0;
  let work = 0;
  let flightTicks = 0;
  let stableTicks = 0;
  let lateralDistance = 0;
  let score = 0;

  function advance() {
    if (fell || ticks >= limit) return;
    if (ticks % 4 === 0) targets = targetsFor(rig, weights, contacts, mode);
    const before = trunk.position.clone();
    rig.drive(targets);
    ticks++;
    const next = [blankContact(), blankContact()];
    let slipSpeed = 0;
    let bodyContact = false;
    for (const c of world.contacts) {
      const body = c.bi === ground ? c.bj : c.bj === ground ? c.bi : null;
      if (!body || c.multiplier <= 0.01) continue;
      if (forbidden.has(body)) bodyContact = true;
      const side = feet.indexOf(body);
      if (side < 0) continue;
      const offset = body === c.bi ? c.ri : c.rj;
      const point = body.position.vadd(offset);
      const local = body.pointToLocalFrame(point);
      if (local.x < 0) next[side].heel = true;
      else next[side].toe = true;
      next[side].load += c.multiplier / (mass * 9.81);
      const velocity = body.velocity.vadd(body.angularVelocity.cross(offset));
      slipSpeed = Math.max(slipSpeed, Math.hypot(velocity.x, velocity.z));
    }
    const upright = trunk.vectorToWorldFrame(up).y;
    fell = trunk.position.y < 0.6 || upright < 0.55 || bodyContact;
    const dx = trunk.position.x - before.x;
    const dz = Math.abs(trunk.position.z - before.z);
    // Step detection is independent of the policy and uses fixed thresholds.
    for (let side = 0; side < 2; side++) {
      const foot = feet[side];
      if (!touching(next[side])) {
        foot.updateAABB();
        if (foot.aabb.lowerBound.y > 0.028) lifted[side] = true;
        continue;
      }
      const landing = lifted[side] && !touching(contacts[side]);
      lifted[side] = false;
      if (lastLanded < 0) lastLanded = side;
      else if (
        !fell &&
        upright > 0.9 &&
        landing &&
        side !== lastLanded &&
        foot.position.x > feet[lastLanded].position.x + 0.1
      ) {
        steps++;
        lastLanded = side;
      }
    }
    contacts = next;
    let effort = 0;
    for (const { joint, items } of rig.motors) {
      const rate = joint.a.angularVelocity.vsub(joint.b.angularVelocity);
      for (const { motor } of items) {
        effort += Math.abs(motor.multiplier * rate.dot(motor.axisA)) * dt;
      }
    }
    const airborne = !contacts.some(touching);
    const slipDelta = slipSpeed * dt;
    slip += slipDelta;
    work += effort;
    if (airborne) flightTicks++;
    if (!fell && upright > 0.9) stableTicks++;
    distance = trunk.position.x - origin.x;
    lateralDistance = Math.abs(trunk.position.z - origin.z);
    score += rewardDelta({
      dx,
      speed: trunk.velocity.x,
      upright: fell ? 0 : clamp((upright - 0.55) / 0.35, 0, 1),
      slip: slipDelta,
      work: effort,
      air: airborne ? dt : 0,
      lateral: dz,
      fell,
      dt,
    });
  }

  return {
    rig,
    advance,
    metrics: () => ({
      ticks,
      fell,
      distance,
      steps,
      slip,
      work,
      flightTicks,
      stableTicks,
      lateralDistance,
      score,
    }),
    get done() {
      return fell || ticks >= limit;
    },
  };
}

export function evaluate(weights, mode, options) {
  const run = trial(weights, mode, options);
  while (!run.done) run.advance();
  return run.metrics();
}

// Qualification is deliberately separate from the reward.
export function passed(m) {
  return (
    !m.fell &&
    m.ticks >= SECONDS / DT &&
    m.distance >= 10 &&
    m.steps >= 8 &&
    m.stableTicks >= m.ticks * 0.85 &&
    m.flightTicks <= m.ticks * 0.15 &&
    m.slip <= m.distance * 0.25 &&
    m.lateralDistance <= 0.5
  );
}
