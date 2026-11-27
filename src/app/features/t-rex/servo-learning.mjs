import { CONTROL_STEPS, createServoRig, POLICY_SIZE, targetsFor } from './servo-rig.mjs';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function command(stage, time) {
  if (stage === 'maneuver') return { speed: time < 6 ? 0.55 : 0, heading: time < 2 ? 0 : 0.6 };
  return { speed: stage === 'run' ? 1.4 : stage === 'walk' ? 0.65 : stage === 'step' ? 0.3 : 0, heading: 0 };
}

// Strict pass conditions are separate from this dense learning reward. In particular,
// an incomplete physical step can be useful, and a fall is not a 100-point penalty.
export function rewardDelta(stage, sample) {
  const { dt, dx, dz, slip, air, upright, settled, lift, step, flight, shift, fell, work, heading, stopped } = sample;
  const cost = 0.8 * slip + 0.00025 * work + 1.2 * air;
  if (stage === 'balance' || stage === 'recover') {
    return dt * (0.4 * upright + 0.8 * Number(settled)) - 1.5 * Math.hypot(dx, dz) - cost - (fell ? 0.8 : 0);
  }
  if (stage === 'shift') {
    return 0.4 * upright * dt + 0.7 * shift + 0.08 * lift - cost - Math.abs(dx) - (fell ? 0.8 : 0);
  }
  const maxSpeed = stage === 'run' ? 1.7 : 0.85;
  let reward =
    clamp(dx, -maxSpeed * dt, maxSpeed * dt) +
    0.24 * step +
    0.06 * lift +
    0.035 * upright * dt -
    cost -
    (fell ? 0.8 : 0);
  if (stage === 'run') reward += 0.35 * flight + 0.9 * air;
  if (stage === 'maneuver') reward += 0.5 * stopped - 0.2 * heading * dt;
  return reward;
}

export function trial(policy, options = {}) {
  if (policy.length !== POLICY_SIZE) throw new Error('Invalid servo policy.');
  const stage = options.stage ?? 'walk';
  const rig = createServoRig(options);
  const { dt } = rig;
  const duration = options.seconds ?? 8;
  const limit = Math.round(duration / dt);
  const trunk = rig.trunk.body;
  const feet = rig.bones.filter((bone) => bone.name.startsWith('toes')).map((bone) => bone.body);
  const forbidden = new Set(rig.bones.filter((b) => /^(skull|neck|trunk|tail)/.test(b.name)).map((b) => b.body));
  const mass = rig.bones.reduce((sum, b) => sum + b.body.mass, 0);
  const origin = trunk.position.x;
  let x = origin;
  let z = trunk.position.z;
  let targets = Array(32).fill(0);
  let ticks = 0;
  let fell = false;
  let score = 0;
  let steps = 0;
  let lifts = 0;
  let maxClearance = 0;
  let maxDistance = 0;
  let pathDistance = 0;
  let stableTicks = 0;
  let settledTicks = 0;
  let supportedTicks = 0;
  let bothFeetTicks = 0;
  let shiftTicks = 0;
  let flightTicks = 0;
  let flights = 0;
  let slip = 0;
  let headingError = 0;
  let stoppingTicks = 0;
  let lastLanded = -1;
  let lastFlight = -1;
  let airTicks = 0;
  let takeoff = -1;
  const contacts = [false, false];
  const loads = [0, 0];
  const next = [false, false];
  const lifted = [false, false];
  const established = [false, false];
  const footX = feet.map((f) => f.position.x);
  const footZ = feet.map((f) => f.position.z);
  const landingX = feet.map((f) => f.position.x);

  function advance() {
    if (fell || ticks >= limit) return;
    const target = command(stage, ticks * dt);
    if (ticks % CONTROL_STEPS === 0) targets = targetsFor(rig, policy, contacts, target.speed, target.heading, loads);
    const beforeSupport = Number(contacts[0]) + Number(contacts[1]);
    const beforeFoot = contacts[0] ? 0 : contacts[1] ? 1 : -1;
    rig.drive(targets);
    ticks++;
    next.fill(false);
    loads.fill(0);
    let bodyContact = false;
    for (const c of rig.world.contacts) {
      const body = c.bi === rig.ground ? c.bj : c.bj === rig.ground ? c.bi : null;
      if (!body || c.multiplier <= 0.01) continue;
      const index = feet.indexOf(body);
      if (index >= 0) {
        next[index] = true;
        loads[index] += c.multiplier / (mass * 9.81);
      }
      if (forbidden.has(body)) bodyContact = true;
    }
    const vertical = trunk.vectorToWorldFrame(rig.up);
    fell = trunk.position.y < 0.6 || vertical.y < 0.55 || bodyContact;
    let gainedLift = 0;
    let gainedStep = 0;
    let gainedFlight = 0;
    let gainedSlip = 0;
    for (const [i, foot] of feet.entries()) {
      const other = 1 - i;
      if (contacts[i] && next[i]) gainedSlip += Math.hypot(foot.position.x - footX[i], foot.position.z - footZ[i]);
      foot.updateAABB();
      const clearance = Math.max(0, foot.aabb.lowerBound.y);
      if (!fell && established[i] && !next[i] && next[other]) {
        maxClearance = Math.max(maxClearance, clearance);
        if (clearance >= 0.025 && !lifted[i]) {
          lifted[i] = true;
          gainedLift++;
        }
      }
      if (next[i]) {
        const forward = foot.position.x > landingX[other] + 0.05;
        if (!fell && lifted[i] && !contacts[i] && i !== lastLanded && forward) {
          gainedStep++;
          lastLanded = i;
        } else if (lastLanded === -1) {
          lastLanded = i;
        }
        lifted[i] = false;
        established[i] = true;
        landingX[i] = foot.position.x;
      }
      footX[i] = foot.position.x;
      footZ[i] = foot.position.z;
    }
    const support = Number(next[0]) + Number(next[1]);
    if (!fell) {
      if (support) {
        supportedTicks++;
        if (support === 2) bothFeetTicks++;
        if (airTicks >= 4 && takeoff >= 0 && support === 1) {
          const land = next[0] ? 0 : 1;
          if (land !== takeoff && land !== lastFlight) {
            gainedFlight++;
            lastFlight = land;
          }
        }
        airTicks = 0;
      } else {
        if (beforeSupport) takeoff = beforeSupport === 1 ? beforeFoot : -1;
        airTicks++;
        flightTicks++;
      }
    }
    contacts[0] = next[0];
    contacts[1] = next[1];
    const stable = !fell && vertical.y > 0.9 && trunk.position.y > 0.8;
    const settled = stable && support === 2 && vertical.y > 0.94 && trunk.position.y > 0.85 && trunk.velocity.length() < 0.18 && trunk.angularVelocity.length() < 0.8;
    if (stable) stableTicks++;
    if (settled) settledTicks++;
    const shifted = !fell && support === 1;
    if (shifted) shiftTicks++;
    const yaw = Math.atan2(
      2 * (trunk.quaternion.x * trunk.quaternion.z - trunk.quaternion.w * trunk.quaternion.y),
      1 - 2 * (trunk.quaternion.y ** 2 + trunk.quaternion.z ** 2),
    );
    const error = Math.abs(Math.atan2(Math.sin(target.heading - yaw), Math.cos(target.heading - yaw)));
    const stopped = ticks * dt >= 6 && settled;
    stoppingTicks = stopped ? stoppingTicks + 1 : 0;
    headingError += error;
    const dx = fell ? 0 : trunk.position.x - x;
    const dz = fell ? 0 : trunk.position.z - z;
    pathDistance += Math.hypot(dx, dz);
    x += dx;
    z += dz;
    maxDistance = Math.max(maxDistance, x - origin);
    steps += gainedStep;
    lifts += gainedLift;
    flights += gainedFlight;
    slip += gainedSlip;
    let work = 0;
    for (const { joint, items } of rig.motors) {
      const relative = joint.a.angularVelocity.vsub(joint.b.angularVelocity);
      for (const { motor } of items) work += Math.abs(motor.multiplier * relative.dot(motor.axisA)) * dt;
    }
    score += rewardDelta(stage, {
      dt, dx, dz, slip: gainedSlip, air: !support && !fell ? dt : 0,
      upright: fell ? 0 : Math.max(0, vertical.y), settled, lift: gainedLift,
      step: gainedStep, flight: gainedFlight, shift: shifted ? dt : 0, fell, work,
      heading: error, stopped: stopped ? dt : 0,
    });
  }

  function metrics() {
    return {
      ticks, fell, distance: x - origin, steps, lifts, maxClearance, maxDistance,
      pathDistance, stableTicks, settledTicks, supportedTicks, bothFeetTicks, shiftTicks,
      flights, flightTicks, slip, headingError, stoppingTicks,
      averageSpeed: ticks ? (x - origin) / (ticks * dt) : 0, score,
    };
  }
  return { rig, advance, metrics, get done() { return fell || ticks >= limit; } };
}

export function evaluate(policy, options) {
  const run = trial(policy, options);
  while (!run.done) run.advance();
  return run.metrics();
}
