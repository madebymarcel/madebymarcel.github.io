import { staticEquilibrium, torqueRequirements } from './biomechanics';
import type { MechanicsFrame } from './biomechanics';
import { nominalStrengthNm } from './neuromuscular';
import { GRAVITY, MASS_KG } from './physical-constants';
import type { Angles, Axis } from './rig';

export type MuscleModel = 'legacy' | 'calibrated';
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

// Fixed design-time capacity for this anatomy. Use the candidate's balanced
// load distribution, gravity alone, and the conservative envelope of the
// entire body weight carried at each eligible contact point independently.
// The latter is a load case, not a claim of single-point static equilibrium.
export function calibrateMuscles(frame: MechanicsFrame): MuscleProfile {
  const estimate = staticEquilibrium(frame);
  if (estimate.margin <= 0 || !estimate.reactions.length) {
    throw new Error('Muscle calibration requires a geometrically supported reference stance');
  }
  const scenarios = [
    estimate.reactions,
    [],
    ...frame.candidates.map((point) => [{ ...point, loadN: MASS_KG * GRAVITY }]),
  ];
  const demand = new Map<string, number>();
  for (const contacts of scenarios) {
    for (const requirement of torqueRequirements(frame, contacts)) {
      const key = muscleKey(requirement.id, requirement.axis);
      demand.set(key, Math.max(demand.get(key) ?? 0, Math.abs(requirement.requiredNm)));
    }
  }
  const profile = new Map<string, number>();
  for (const joint of frame.joints) {
    for (const axis of ['pitch', 'yaw', 'roll'] as const) {
      const key = muscleKey(joint.id, axis);
      const baseline = nominalStrengthNm(joint.id);
      const capacity = Math.ceil(Math.max(baseline, LOAD_RESERVE * (demand.get(key) ?? 0)));
      profile.set(key, joint.locked[axis] ? 0 : capacity);
    }
  }
  return profile;
}
