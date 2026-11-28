import { Vec3 as Vector } from 'cannon-es';
import { describe, expect, it } from 'vitest';
import {
  allocateLoads,
  isFoot,
  massCenter,
  staticEquilibrium,
  supportHull,
  supportMargin,
} from './biomechanics';
import type { Point2, SupportPoint } from './biomechanics';
import { BALANCED_STANCE } from './muscle-profile';
import { ligamentTorque } from './neuromuscular';
import type { ControlInput } from './neuromuscular';
import { GRAVITY, MASS_KG, PassiveRig, STEP } from './passive-physics';
import type { PhysicsOptions } from './passive-physics';
import { poseRig } from './rig';
import type { Angles } from './rig';
import { standingControl } from './standing-controller';
import type { StandingTarget } from './standing-controller';

const WEIGHT = MASS_KG * GRAVITY;
const PASSIVE: ControlInput = { ligaments: false, mode: 'off', commands: {} };
const STANCE_HEIGHT = 2.4;

function report(name: string, value: unknown): void {
  const json = JSON.stringify(value, (_, entry: unknown) =>
    typeof entry === 'number' && Number.isFinite(entry) ? Math.round(entry * 10000) / 10000 : entry,
  );
  console.info('V3_BIOMECHANICS ' + name + ' ' + json);
}

function symmetricPose(thigh: number, knee: number, foot: number, toe: number) {
  const angles: Record<string, Angles> = {};
  for (const side of ['left-', 'right-']) {
    const values: Record<string, number> = {
      thigh,
      'lower-leg': knee,
      foot,
      'inner-toe': toe,
      'middle-toe': toe,
      'outer-toe': toe,
    };
    for (const [id, pitch] of Object.entries(values)) {
      angles[side + id] = { pitch, yaw: 0, roll: 0 };
    }
  }
  return angles;
}

function evaluate(angles: Readonly<Record<string, Angles>>, tolerance: number) {
  const rig = new PassiveRig(0, 0, { initialPose: angles });
  const frame = rig.mechanics(tolerance);
  const estimate = staticEquilibrium(frame);
  const height = rig.snapshot().pelvisHeight;
  return {
    angles,
    height,
    ...estimate,
    candidates: frame.candidates,
    totalReactionN: estimate.reactions.reduce((sum, point) => sum + point.loadN, 0),
    peakUtilization: estimate.worst[0]?.utilization ?? Infinity,
  };
}

function findStance() {
  const neutral = evaluate({}, 0.005);
  const relaxedNeutral = evaluate({}, 0.05);
  const candidates = [];
  for (const thigh of [-20, -10, 0, 10, 20]) {
    for (const knee of [-15, 0, 15, 30]) {
      for (const foot of [-15, 0, 15]) {
        for (const toe of [-10, 0, 10]) {
          candidates.push(evaluate(symmetricPose(thigh, knee, foot, toe), 0.005));
        }
      }
    }
  }
  const upright = candidates.filter(
    (candidate) => candidate.height > STANCE_HEIGHT && candidate.candidates.length > 0,
  );
  const feasible = upright.filter(
    (candidate) => candidate.margin >= 0.005 && candidate.peakUtilization <= 1,
  );
  const score = (candidate: typeof neutral) =>
    Math.max(0, 0.005 - candidate.margin) * 100 +
    Math.max(0, candidate.peakUtilization - 1) +
    0.1 * candidate.peakUtilization;
  const best =
    [...(feasible.length ? feasible : upright)].sort((a, b) => score(a) - score(b))[0] ?? neutral;
  return { neutral, relaxedNeutral, best, searched: candidates.length, feasible: feasible.length };
}

function drop(timestep: number, iterations: number, ligaments: boolean) {
  const rig = new PassiveRig(0.35, 5, { timestep, iterations });
  let peakGapM = 0;
  let peakExcessDeg = 0;
  let peakPenetrationM = 0;
  let continuousQuiet = 0;
  let longestQuiet = 0;
  let initialContact = false;
  for (let i = 1; i <= Math.round(10 / timestep); i++) {
    rig.step({ ...PASSIVE, ligaments });
    if (i % Math.round(0.05 / timestep) !== 0) continue;
    const state = rig.snapshot();
    const frame = rig.mechanics();
    expect(state.valid).toBe(true);
    initialContact ||= state.groundContacts > 0;
    peakGapM = Math.max(peakGapM, state.jointGap);
    peakExcessDeg = Math.max(peakExcessDeg, state.angleExcess);
    peakPenetrationM = Math.max(peakPenetrationM, state.penetration);
    const quiet =
      initialContact &&
      frame.bodies.every((body) => Math.hypot(...body.velocity) < 0.05 && body.angularSpeed < 0.1);
    continuousQuiet = quiet ? continuousQuiet + 0.05 : 0;
    longestQuiet = Math.max(longestQuiet, continuousQuiet);
  }
  const final = rig.snapshot();
  return {
    timestep,
    iterations,
    ligaments,
    peakGapM,
    peakExcessDeg,
    peakPenetrationM,
    finalGapM: final.jointGap,
    finalExcessDeg: final.angleExcess,
    finalPenetrationM: final.penetration,
    longestQuiet,
    finalQuietSeconds: continuousQuiet,
    settled: continuousQuiet >= 1 && final.jointGap < 0.01 && final.penetration < 0.01,
  };
}

function isolatedLigament(timestep: number, enabled: boolean) {
  const inertia = 10;
  let angle = 0.3;
  let rate = 0;
  const energy = () => {
    const excess = Math.max(0, Math.abs(angle) - 0.125);
    return (
      0.5 * inertia * rate * rate + 100 * inertia * (0.5 * excess ** 2 + excess ** 3 / (3 * 0.375))
    );
  };
  const initial = energy();
  let maximum = initial;
  for (let i = 0; i < Math.round(2 / timestep); i++) {
    const torque = enabled ? ligamentTorque(angle, rate, -0.5, 0.5, inertia) : 0;
    rate += (torque / inertia) * timestep;
    angle += rate * timestep;
    maximum = Math.max(maximum, energy());
  }
  return { timestep, enabled, initial, final: energy(), maximum, angle, rate };
}

function freeAir(ligaments: boolean) {
  const initialPose = { 'neck-1': { pitch: 10, yaw: 0, roll: 0 } };
  const rig = new PassiveRig(100, 0, { initialPose });
  const read = () => rig.sense().joints.find((joint) => joint.id === 'neck-1')!.axes.pitch;
  const initial = read();
  let maxRate = 0;
  let maxGap = 0;
  for (let i = 1; i <= 240; i++) {
    rig.step({ ...PASSIVE, ligaments });
    if (i % 6 !== 0) continue;
    maxRate = Math.max(maxRate, Math.abs(read().rate));
    maxGap = Math.max(maxGap, rig.snapshot().jointGap);
  }
  return {
    ligaments,
    startAngleDeg: (initial.angle * 180) / Math.PI,
    endAngleDeg: (read().angle * 180) / Math.PI,
    endRate: read().rate,
    maxRate,
    maxGap,
    groundContacts: rig.snapshot().groundContacts,
  };
}

interface TrialResult {
  name: string;
  standingSeconds: number;
  maxSupportedSeconds: number;
  finalHeight: number;
  minMarginM: number;
  peakGapM: number;
  peakExcessDeg: number;
  peakPenetrationM: number;
  saturatedShare: number;
  recovery: string;
  transfer: string;
  lift: string;
  pushOff: string;
  recoverySeconds: number;
  transferSeconds: number;
  liftSeconds: number;
  pushDeltaVMps: number;
}

function stand(
  name: string,
  angles: Readonly<Record<string, Angles>>,
  controller: boolean,
  options: PhysicsOptions = {},
): TrialResult {
  const rig = new PassiveRig(0.002, 0, { ...options, initialPose: angles });
  const dt = rig.timestep;
  const sampleSteps = Math.round(0.05 / dt);
  const start = massCenter(rig.mechanics().bodies).position;
  let target: StandingTarget = { angles, center: [start[0], start[1]] };
  let command: ControlInput = PASSIVE;
  let current = 0;
  let longest = 0;
  let supported = 0;
  let minMargin = Infinity;
  let peakGapM = 0;
  let peakExcessDeg = 0;
  let peakPenetrationM = 0;
  let saturated = 0;
  let active = 0;
  let phase: 'stand' | 'recovery' | 'transfer' | 'lift' | 'push' = 'stand';
  let phaseStart = 0;
  let recoverySeconds = 0;
  let transferSeconds = 0;
  let liftSeconds = 0;
  let pushDeltaVMps = 0;
  let pushStartV = 0;
  let forwardImpulseNs = 0;
  let left = 0;
  let right = 0;
  let other = 0;
  let recovery = 'blocked by standing';
  let transfer = 'blocked by recovery';
  let lift = 'blocked by transfer';
  let pushOff = 'blocked by lift';
  let completedStanding = false;
  for (let i = 1; i <= 30 / dt; i++) {
    const time = i * dt;
    if (controller && (i - 1) % sampleSteps === 0) {
      command = standingControl(rig.mechanics(), rig.sense(), target);
    }
    rig.step(command);
    const sensors = rig.sense();
    left += sensors.leftFootLoadN / sampleSteps;
    right += sensors.rightFootLoadN / sampleSteps;
    const normalLoad = Object.values(sensors.contacts).reduce(
      (sum, contact) => sum + contact.normalLoadN,
      0,
    );
    other += Math.max(0, normalLoad - sensors.leftFootLoadN - sensors.rightFootLoadN) / sampleSteps;
    if (phase === 'push') {
      for (const equation of rig['world'].frictionEquations) {
        if (!equation.enabled) continue;
        const sign = equation.bi === rig['ground'] ? 1 : equation.bj === rig['ground'] ? -1 : 0;
        forwardImpulseNs += sign * equation.t.x * equation.multiplier * 100 * dt;
      }
    }
    if (i % sampleSteps !== 0) continue;
    const state = rig.snapshot();
    expect(state.valid).toBe(true);
    const frame = rig.mechanics();
    const center = massCenter(frame.bodies);
    const footPoints = frame.contacts.filter((point) => isFoot(point.id) && point.loadN > 0);
    const hull = supportHull(footPoints);
    const margin = supportMargin(hull, [center.position[0], center.position[1]]).margin;
    if (Number.isFinite(margin)) minMargin = Math.min(minMargin, margin);
    peakGapM = Math.max(peakGapM, state.jointGap);
    peakExcessDeg = Math.max(peakExcessDeg, state.angleExcess);
    peakPenetrationM = Math.max(peakPenetrationM, state.penetration);
    for (const joint of sensors.joints) {
      for (const axis of ['pitch', 'yaw', 'roll'] as const) {
        if (joint.axes[axis].locked) continue;
        active++;
        if (Math.abs(command.commands[joint.id]?.[axis] ?? 0) > 0.99) saturated++;
      }
    }
    const safe = state.jointGap < 0.05 && state.angleExcess < 5 && state.penetration < 0.05;
    const upright = state.pelvisHeight > STANCE_HEIGHT && -sensors.gravityDirection[2] > 0.9;
    const onFeet = safe && upright && other < 0.05 * WEIGHT;
    const stable =
      onFeet &&
      Math.hypot(...center.velocity) < 0.15 &&
      left + right > 0.85 * WEIGHT &&
      left + right < 1.15 * WEIGHT;
    current = stable ? current + 0.05 : 0;
    longest = Math.max(longest, current);
    if (onFeet) supported += 0.05;
    if (phase === 'stand' && current >= 10) {
      completedStanding = true;
      if (!controller) break;
      phase = 'recovery';
      phaseStart = time;
      recovery = 'failed';
      // A finite, known external perturbation, never a supporting force.
      rig['pelvis'].body.applyImpulse(new Vector(0, (MASS_KG * 0.1) / 100, 0));
      current = 0;
    } else if (phase === 'stand' && time >= 12) {
      break;
    } else if (phase === 'recovery') {
      recoverySeconds = Math.max(recoverySeconds, current);
      if (current >= 2) {
        recovery = 'passed';
        phase = 'transfer';
        phaseStart = time;
        transfer = 'failed';
        const leftPoints = footPoints.filter((point) => point.id.startsWith('left-'));
        const leftHull = supportHull(leftPoints);
        if (!leftHull.length) break;
        const mean = (axis: number) =>
          leftHull.reduce((sum, p) => sum + p[axis], 0) / leftHull.length;
        const leftCenter: Point2 = [mean(0), mean(1)];
        target = { angles, center: leftCenter };
      } else if (time - phaseStart > 4) break;
    } else if (phase === 'transfer') {
      const transferred = stable && left > 0.85 * WEIGHT && right < 0.1 * WEIGHT;
      transferSeconds = transferred ? transferSeconds + 0.05 : 0;
      if (transferSeconds >= 0.5) {
        transfer = 'passed';
        phase = 'lift';
        phaseStart = time;
        lift = 'failed';
        const leg = angles['right-lower-leg'] ?? { pitch: 0, yaw: 0, roll: 0 };
        target = {
          ...target,
          angles: { ...angles, 'right-lower-leg': { ...leg, pitch: Math.min(60, leg.pitch + 25) } },
        };
      } else if (time - phaseStart > 4) break;
    } else if (phase === 'lift') {
      const lifted = stable && left > 0.85 * WEIGHT && sensors.rightFootClearanceM > 0.1;
      liftSeconds = lifted ? liftSeconds + 0.05 : 0;
      if (liftSeconds >= 0.5) {
        lift = 'passed';
        phase = 'push';
        phaseStart = time;
        pushOff = 'failed';
        pushStartV = center.velocity[0];
        target = { ...target, center: [target.center[0] + 0.35, target.center[1]] };
      } else if (time - phaseStart > 4) break;
    } else if (phase === 'push') {
      pushDeltaVMps = center.velocity[0] - pushStartV;
      if (onFeet && pushDeltaVMps > 0.15 && forwardImpulseNs > 0.1 * MASS_KG) {
        pushOff = 'passed';
        break;
      }
      if (time - phaseStart > 2) break;
    }
    left = 0;
    right = 0;
    other = 0;
  }
  return {
    name,
    standingSeconds: completedStanding ? Math.max(10, longest) : longest,
    maxSupportedSeconds: supported,
    finalHeight: rig.snapshot().pelvisHeight,
    minMarginM: minMargin,
    peakGapM,
    peakExcessDeg,
    peakPenetrationM,
    saturatedShare: active ? saturated / active : 0,
    recovery,
    transfer,
    lift,
    pushOff,
    recoverySeconds,
    transferSeconds,
    liftSeconds,
    pushDeltaVMps,
  };
}

describe('V3 biomechanics acceptance suite', () => {
  it('allocates nonnegative ground forces with the correct total and centre of pressure', () => {
    const points: SupportPoint[] = [
      { id: 'a', position: [0, 0, 0], loadN: 0 },
      { id: 'b', position: [2, 0, 0], loadN: 0 },
      { id: 'c', position: [2, 2, 0], loadN: 0 },
      { id: 'd', position: [0, 2, 0], loadN: 0 },
    ];
    const hull = supportHull(points);
    expect(supportMargin(hull, [1, 1]).margin).toBeCloseTo(1);
    expect(supportMargin(hull, [3, 1]).margin).toBeCloseTo(-1);
    const loads = allocateLoads(points, [0.5, 1], 100);
    expect(loads.every((point) => point.loadN >= 0)).toBe(true);
    expect(loads.reduce((sum, point) => sum + point.loadN, 0)).toBeCloseTo(100);
    expect(loads.reduce((sum, point) => sum + point.loadN * point.position[0], 0)).toBeCloseTo(50);
    expect(loads.reduce((sum, point) => sum + point.loadN * point.position[1], 0)).toBeCloseTo(100);
  });

  it('initializes a non-neutral physical pose without joint separation', () => {
    const angles = symmetricPose(-10, 15, 5, -10);
    const rig = new PassiveRig(0.02, 0, { initialPose: angles });
    const state = rig.snapshot();
    const expected = poseRig(angles);
    expect(state.jointGap).toBeLessThan(1e-7);
    expect(state.angleExcess).toBeLessThan(1e-6);
    for (const actual of state.pose) {
      const target = expected.find((p) => p.bone.id === actual.bone.id)!;
      for (let i = 0; i < 3; i++) {
        expect(actual.end[i] - actual.start[i]).toBeCloseTo(target.end[i] - target.start[i], 6);
      }
    }
  });

  it('measures neutral and candidate static stance geometry and torque reserves', () => {
    const { neutral, relaxedNeutral, best, searched, feasible } = findStance();
    const compact = (entry: typeof neutral) => ({
      angles: entry.angles,
      height: entry.height,
      center: entry.center,
      hull: entry.hull,
      margin: entry.margin,
      residualMomentNm: entry.residualMomentNm,
      totalReactionN: entry.totalReactionN,
      peakUtilization: entry.peakUtilization,
      requirements: entry.requirements,
    });
    report('static', {
      searched,
      feasible,
      neutral: compact(neutral),
      relaxedNeutral: compact(relaxedNeutral),
      best: compact(best),
    });
    expect(neutral.totalReactionN).toBeCloseTo(WEIGHT);
    expect(best.height).toBeGreaterThan(STANCE_HEIGHT);
  }, 60000);

  it('compares smaller timesteps and higher iteration counts without tuning away failures', () => {
    const results = [
      drop(STEP, 100, false),
      drop(STEP / 2, 100, false),
      drop(STEP / 4, 100, false),
      drop(STEP / 2, 200, false),
      drop(STEP, 100, true),
      drop(STEP / 2, 200, true),
    ];
    report('solver', results);
    expect(results.every((entry) => Number.isFinite(entry.peakGapM))).toBe(true);
  }, 120000);

  it('separates ligament elasticity and damping from full-rig impact behavior', () => {
    const isolated = [
      isolatedLigament(STEP, false),
      isolatedLigament(STEP, true),
      isolatedLigament(STEP / 4, true),
    ];
    const air = [freeAir(false), freeAir(true)];
    report('ligaments', { isolated, air });
    expect(isolated[1].final).toBeLessThan(isolated[1].initial);
    expect(isolated[2].final).toBeLessThan(isolated[2].initial);
    expect(air.every((entry) => entry.groundContacts === 0)).toBe(true);
  });

  it('attempts the gated physical acceptance sequence with the new controller', () => {
    const { best } = findStance();
    const trials = [
      stand('neutral passive', {}, false),
      stand('legacy balanced controller', BALANCED_STANCE, true, { muscleModel: 'legacy' }),
      stand('calibrated balanced controller', BALANCED_STANCE, true),
      stand('calibrated best candidate controller', best.angles, true),
      stand('calibrated balanced controller at 480 Hz', BALANCED_STANCE, true, {
        timestep: STEP / 4,
      }),
    ];
    report('acceptance', trials);
    // Results deliberately remain diagnostic. No failed capability is marked
    // passed merely because its numerical integration remained finite.
    expect(trials.every((trial) => Number.isFinite(trial.finalHeight))).toBe(true);
  }, 120000);
});
