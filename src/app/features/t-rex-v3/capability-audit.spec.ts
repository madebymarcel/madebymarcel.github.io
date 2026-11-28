import { describe, expect, it } from 'vitest';
import { GRAVITY, MASS_KG, PassiveRig, STEP } from './passive-physics';
import { signedUnit } from './neuromuscular';
import type { Commands, ControlInput, SensorFrame } from './neuromuscular';
import type { Axis } from './rig';

const WEIGHT = MASS_KG * GRAVITY;
const SAMPLE_STEPS = 6;
const INTERVAL = SAMPLE_STEPS * STEP;
const AXES = ['pitch', 'yaw', 'roll'] as const;

interface Trial {
  name: string;
  height: number;
  tilt: number;
  duration: number;
  input: (sensors: SensorFrame, time: number) => ControlInput;
}

function passive(ligaments: boolean): ControlInput {
  return { ligaments, mode: 'off', commands: {} };
}

function reflex(ligaments: boolean): ControlInput {
  return { ligaments, mode: 'reflex', commands: {} };
}

// These are temporary diagnostic commands, not changes to the deployed controller.
function testController(sensors: SensorFrame, targets: Commands): ControlInput {
  const commands: Record<string, Partial<Record<Axis, number>>> = {};
  for (const joint of sensors.joints) {
    const result: Partial<Record<Axis, number>> = {};
    for (const axis of AXES) {
      const state = joint.axes[axis];
      const desired = targets[joint.id]?.[axis] ?? 0;
      result[axis] = state.locked ? 0 : signedUnit(5 * (desired - state.angle) - 0.4 * state.rate);
    }
    commands[joint.id] = result;
  }
  return { ligaments: true, mode: 'manual', commands };
}

function shift(sensors: SensorFrame, time: number, side: 'left' | 'right', sign: number) {
  const swing = side === 'left' ? 'right' : 'left';
  const yaw = time > 0.5 ? sign * 0.18 : 0;
  const lift = time > 1.2 ? 1 : 0;
  return testController(sensors, {
    [side + '-thigh']: { yaw },
    [swing + '-thigh']: { yaw, pitch: -0.2 * lift },
    [swing + '-lower-leg']: { pitch: 0.5 * lift },
    [swing + '-foot']: { pitch: -0.15 * lift },
  });
}

function push(sensors: SensorFrame, time: number, sign: number): ControlInput {
  const power = time > 0.5 && time < 1.5 ? sign : 0;
  return testController(sensors, {
    'left-thigh': { pitch: 0.3 * power },
    'right-thigh': { pitch: 0.3 * power },
    'left-foot': { pitch: -0.3 * power },
    'right-foot': { pitch: -0.3 * power },
  });
}

const trials: Trial[] = [
  { name: 'passive drop', height: 0.35, tilt: 5, duration: 8, input: () => passive(false) },
  { name: 'ligament drop', height: 0.35, tilt: 5, duration: 8, input: () => passive(true) },
  { name: 'passive stance', height: 0.02, tilt: 0, duration: 6, input: () => passive(false) },
  { name: 'ligament stance', height: 0.02, tilt: 0, duration: 6, input: () => passive(true) },
  { name: 'reflex stance', height: 0.02, tilt: 0, duration: 6, input: () => reflex(false) },
  { name: 'reflex and ligaments', height: 0.02, tilt: 0, duration: 6, input: () => reflex(true) },
  {
    name: 'stronger diagnostic neutral control',
    height: 0.02,
    tilt: 0,
    duration: 6,
    input: (sensors) => testController(sensors, {}),
  },
  ...(['left', 'right'] as const).flatMap((side) =>
    [-1, 1].map((sign) => ({
      name: 'shift and lift ' + side + ' ' + sign,
      height: 0.02,
      tilt: 0,
      duration: 5,
      input: (sensors: SensorFrame, time: number) => shift(sensors, time, side, sign),
    })),
  ),
  ...[-1, 1].map((sign) => ({
    name: 'push ' + sign,
    height: 0.02,
    tilt: 0,
    duration: 5,
    input: (sensors: SensorFrame, time: number) => push(sensors, time, sign),
  })),
];

function mechanics(rig: PassiveRig) {
  // Test-only access to engine state for COM velocity and tangential contact force.
  const segments = rig['segments'];
  const ground = rig['ground'];
  const world = rig['world'];
  let mass = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  let maxSpeed = 0;
  let maxSpin = 0;
  for (const { body } of segments) {
    mass += body.mass;
    vx += body.velocity.x * body.mass;
    vy += body.velocity.y * body.mass;
    vz += body.velocity.z * body.mass;
    maxSpeed = Math.max(maxSpeed, body.velocity.length());
    maxSpin = Math.max(maxSpin, body.angularVelocity.length());
  }
  let frictionX = 0;
  for (const equation of world.frictionEquations) {
    if (!equation.enabled) continue;
    const sign = equation.bi === ground ? 1 : equation.bj === ground ? -1 : 0;
    frictionX += sign * equation.t.x * equation.multiplier * 100;
  }
  return { vx: vx / mass, vy: vy / mass, vz: vz / mass, maxSpeed, maxSpin, frictionX };
}

interface Sample {
  upright: boolean;
  safe: boolean;
  vx: number;
  impulseX: number;
  footLoad: number;
  otherLoad: number;
}

function audit(trial: Trial) {
  const rig = new PassiveRig(trial.height, trial.tilt);
  let sensors = rig.sense();
  const initial = rig.snapshot();
  let landed = false;
  let valid = true;
  let peakGap = 0;
  let peakExcess = 0;
  let peakPenetration = 0;
  let maxFootLoad = 0;
  let peakOneFoot = 0;
  let supportedClearance = 0;
  let support = 0;
  let shiftDuration = 0;
  let lift = 0;
  let settled = 0;
  let bestSupport = 0;
  let bestShift = 0;
  let bestLift = 0;
  let bestSettle = 0;
  let bestImpulse = 0;
  let bestDeltaV = 0;
  let peakUprightImpulse = 0;
  let peakUprightDeltaV = 0;
  let left = 0;
  let right = 0;
  let other = 0;
  let impulse = 0;
  const recent: Sample[] = [];
  for (let i = 1; i <= Math.round(trial.duration / STEP); i++) {
    rig.step(trial.input(sensors, (i - 1) * STEP));
    sensors = rig.sense();
    const m = mechanics(rig);
    left += sensors.leftFootLoadN / SAMPLE_STEPS;
    right += sensors.rightFootLoadN / SAMPLE_STEPS;
    const total = Object.values(sensors.contacts).reduce((sum, c) => sum + c.normalLoadN, 0);
    other += Math.max(0, total - sensors.leftFootLoadN - sensors.rightFootLoadN) / SAMPLE_STEPS;
    impulse += m.frictionX * STEP;
    if (i % SAMPLE_STEPS !== 0) continue;
    const state = rig.snapshot();
    valid &&= state.valid && Number.isFinite(m.frictionX);
    if (!valid) break;
    landed ||= state.groundContacts > 0 || left + right + other > 0;
    peakGap = Math.max(peakGap, state.jointGap);
    peakExcess = Math.max(peakExcess, state.angleExcess);
    peakPenetration = Math.max(peakPenetration, state.penetration);
    const safe = state.jointGap < 0.1 && state.angleExcess < 10 && state.penetration < 0.1;
    const upright = state.pelvisHeight > 2.4 && -sensors.gravityDirection[2] > 0.85;
    const footLoad = left + right;
    const quiet = Math.hypot(m.vx, m.vy) < 0.35 && Math.abs(m.vz) < 0.25;
    const onFeet = upright && safe && other < 0.1 * WEIGHT;
    const holding = onFeet && quiet && footLoad > 0.75 * WEIGHT && footLoad < 1.25 * WEIGHT;
    maxFootLoad = Math.max(maxFootLoad, footLoad / WEIGHT);
    const stronger = Math.max(left, right);
    const weaker = Math.min(left, right);
    const clearance = left > right ? sensors.rightFootClearanceM : sensors.leftFootClearanceM;
    const transferring = onFeet && quiet && stronger > 0.75 * WEIGHT && weaker < 0.15 * WEIGHT;
    if (onFeet && footLoad > 0.5 * WEIGHT) {
      peakOneFoot = Math.max(peakOneFoot, stronger / Math.max(footLoad, 1));
    }
    if (transferring) supportedClearance = Math.max(supportedClearance, clearance);
    support = holding ? support + INTERVAL : 0;
    shiftDuration = transferring ? shiftDuration + INTERVAL : 0;
    lift = transferring && clearance > 0.1 ? lift + INTERVAL : 0;
    const still = landed && safe && m.maxSpeed < 0.05 && m.maxSpin < 0.1;
    settled = still ? settled + INTERVAL : 0;
    bestSupport = Math.max(bestSupport, support);
    bestShift = Math.max(bestShift, shiftDuration);
    bestLift = Math.max(bestLift, lift);
    bestSettle = Math.max(bestSettle, settled);
    recent.push({ upright, safe, vx: m.vx, impulseX: impulse, footLoad, otherLoad: other });
    if (recent.length > 6) recent.shift();
    if (recent.length === 6) {
      const window = recent.slice(1);
      const meanLoad = window.reduce((sum, s) => sum + s.footLoad, 0) / window.length;
      const meanOther = window.reduce((sum, s) => sum + s.otherLoad, 0) / window.length;
      if (recent.every((s) => s.upright && s.safe) && meanOther < 0.1 * WEIGHT) {
        const dx = m.vx - recent[0].vx;
        const jx = window.reduce((sum, s) => sum + s.impulseX, 0);
        peakUprightImpulse = Math.max(peakUprightImpulse, jx);
        peakUprightDeltaV = Math.max(peakUprightDeltaV, dx);
        if (meanLoad > 0.5 * WEIGHT && jx > 0 && dx > 0) {
          bestImpulse = Math.max(bestImpulse, jx);
          bestDeltaV = Math.max(bestDeltaV, dx);
        }
      }
    }
    left = 0;
    right = 0;
    other = 0;
    impulse = 0;
  }
  const final = rig.snapshot();
  const motion = mechanics(rig);
  return {
    name: trial.name,
    valid,
    landed,
    fallM: initial.centerHeight - final.centerHeight,
    finalPelvisM: final.pelvisHeight,
    peakGapM: peakGap,
    peakExcessDeg: peakExcess,
    peakPenetrationM: peakPenetration,
    finalGapM: final.jointGap,
    finalExcessDeg: final.angleExcess,
    finalPenetrationM: final.penetration,
    finalMaxSpeedMps: motion.maxSpeed,
    finalMaxSpinRadps: motion.maxSpin,
    settledSeconds: bestSettle,
    finalSettledSeconds: settled,
    supportSeconds: bestSupport,
    shiftSeconds: bestShift,
    liftSeconds: bestLift,
    peakFootLoadBodyweights: maxFootLoad,
    peakOneFootShare: peakOneFoot,
    supportedClearanceM: supportedClearance,
    forwardImpulseNs: bestImpulse,
    forwardDeltaVMps: bestDeltaV,
    peakUprightImpulseNs: peakUprightImpulse,
    peakUprightDeltaVMps: peakUprightDeltaV,
  };
}

describe('V3 capability audit (diagnostics only)', () => {
  for (const trial of trials) {
    it(
      trial.name,
      () => {
        const result = audit(trial);
        const json = JSON.stringify(result, (_, value: unknown) =>
          typeof value === 'number' ? Math.round(value * 10000) / 10000 : value,
        );
        console.info('V3_AUDIT ' + json);
        // Failed capability targets are reported, not hidden by assertions or retries.
        expect(result.valid).toBe(true);
      },
      60000,
    );
  }
});
