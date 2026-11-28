import { staticEquilibrium, torqueRequirements } from './biomechanics';
import type { MechanicsFrame } from './biomechanics';
import { nominalStrengthNm } from './neuromuscular';
import { GRAVITY, MASS_KG } from './physical-constants';
import type { Angles, Axis } from './rig';

export type MuscleProfile = ReadonlyMap<string, number>;
export const LOAD_RESERVE = 1.5;

const legPose: Readonly<Record<string, number>> = {
  thigh: -20,
  'lower-leg': 15,
  foot: 0,
  'inner-toe': -10,
  'middle-toe': -10,
  'outer-toe': -10,
};

// Measured candidate from the previous 180-pose static search. It is
// geometrically feasible, not yet dynamically validated.
export const BALANCED_STANCE: Readonly<Record<string, Angles>> = Object.fromEntries(
  ['left-', 'right-'].flatMap((side) =>
    Object.entries(legPose).map(([id, pitch]) => [side + id, { pitch, yaw: 0, roll: 0 }]),
  ),
);

export function muscleKey(id: string, axis: Axis): string {
  return id + ':' + axis;
}

// Sample both sides of the reference pose, straight toes, bent toes,
// and sagittal/lateral/axial variations. Capacities are fixed once,
// not increased on demand in response to the learner.
export function calibrationPoses(): { angles: Readonly<Record<string, Angles>>; tilt: number }[] {
  const poses = [{ angles: BALANCED_STANCE, tilt: 0 }, { angles: {}, tilt: 0 }];
  for (const delta of [-15, -7, 7, 15]) {
    for (const part of ['thigh', 'lower-leg', 'foot', 'inner-toe', 'middle-toe', 'outer-toe']) {
      const angles: Record<string, Angles> = { ...BALANCED_STANCE };
      for (const side of ['left-', 'right-']) {
        const id = side + part;
        angles[id] = { ...angles[id], pitch: angles[id].pitch + delta };
      }
      poses.push({ angles, tilt: 0 });
    }
  }
  for (const tilt of [-10, -5, 5, 10]) poses.push({ angles: BALANCED_STANCE, tilt });
  for (const pitch of [-10, 10]) {
    poses.push({ angles: { ...BALANCED_STANCE, 'neck-1': { pitch, yaw: 0, roll: 0 } }, tilt: 0 });
    poses.push({ angles: { ...BALANCED_STANCE, 'tail-1': { pitch, yaw: 0, roll: 0 } }, tilt: 0 });
  }
  return poses;
}

// Conservative engineering envelope, including gravity and independently
// loaded candidate contacts in each sampled pose. Not a biological estimate
// or a proof of feasibility across the entire range of movement.
export function calibrateMuscles(frames: readonly MechanicsFrame[]): MuscleProfile {
  if (!frames.length) throw new Error('Missing muscle calibration frames');
  const demand = new Map<string, number>();
  for (const frame of frames) {
    const estimate = staticEquilibrium(frame);
    const scenarios = [
      estimate.reactions,
      [],
      ...frame.candidates.map((point) => [{ ...point, loadN: MASS_KG * GRAVITY }]),
    ];
    for (const contacts of scenarios) {
      for (const requirement of torqueRequirements(frame, contacts)) {
        const key = muscleKey(requirement.id, requirement.axis);
        demand.set(key, Math.max(demand.get(key) ?? 0, Math.abs(requirement.requiredNm)));
      }
    }
  }
  const profile = new Map<string, number>();
  for (const joint of frames[0].joints) {
    for (const axis of ['pitch', 'yaw', 'roll'] as const) {
      const key = muscleKey(joint.id, axis);
      const baseline = nominalStrengthNm(joint.id);
      const capacity = Math.ceil(Math.max(baseline, LOAD_RESERVE * (demand.get(key) ?? 0)));
      profile.set(key, joint.locked[axis] ? 0 : capacity);
    }
  }
  return profile;
}
