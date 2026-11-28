import { isFoot, massCenter } from './biomechanics';
import { BALANCED_STANCE } from './muscle-profile';
import { GRAVITY, MASS_KG, PassiveRig, STEP } from './passive-physics';
import type { PhysicsSnapshot } from './passive-physics';
import type { Commands } from './neuromuscular';
import { AXES, BONES, clampAngles } from './rig';
import type { Angles, Axis, Vec3 } from './rig';

export const ACTION_HZ = 30;
export const SUBSTEPS = Math.round(1 / (STEP * ACTION_HZ));
const WEIGHT = GRAVITY * MASS_KG;

export const ACTIONS = BONES.filter((bone) => bone.parent !== null && bone.parent !== 'root')
  .flatMap((bone) =>
    AXES.filter((axis) => bone.limits[axis][0] !== bone.limits[axis][1]).map((axis) => ({
      id: bone.id,
      axis,
    })),
  );

export const OBSERVATIONS: readonly string[] = [
  ...ACTIONS.flatMap(({ id, axis }) =>
    ['angle', 'rate', 'activation', 'torque'].map((field) => id + ':' + axis + ':' + field),
  ),
  ...BONES.filter((bone) => bone.id !== 'root').flatMap((bone) => [
    bone.id + ':ground-contact',
    bone.id + ':ground-load',
  ]),
  'gravity:x', 'gravity:y', 'gravity:z',
  'angular-velocity:x', 'angular-velocity:y', 'angular-velocity:z',
  'specific-force:x', 'specific-force:y', 'specific-force:z',
  'com-velocity:x', 'com-velocity:y', 'com-velocity:z',
  'pelvis-height', 'com-height', 'left-clearance', 'right-clearance',
];

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function decodeActions(action: readonly number[]): Commands {
  if (action.length !== ACTIONS.length || action.some((value) =>
    !Number.isFinite(value) || Math.abs(value) > 1,
  )) throw new Error('Invalid action vector');
  const commands: Record<string, Partial<Record<Axis, number>>> = {};
  ACTIONS.forEach(({ id, axis }, i) => {
    (commands[id] ??= {})[axis] = action[i];
  });
  return commands;
}

export function observe(state: PhysicsSnapshot, velocity: Vec3): number[] {
  const joints = new Map(state.sensors.joints.map((joint) => [joint.id, joint.axes]));
  return [
    ...ACTIONS.flatMap(({ id, axis }) => {
      const s = joints.get(id)?.[axis];
      if (!s) throw new Error('Missing action receptor: ' + id + ':' + axis);
      return [s.angle / Math.PI, s.rate / 8, s.activation, s.muscleNm / s.maximumNm];
    }),
    ...BONES.filter((bone) => bone.id !== 'root').flatMap((bone) => {
      const contact = state.sensors.contacts[bone.id];
      return [Number(contact.groundTouching), contact.normalLoadN / WEIGHT];
    }),
    ...state.sensors.gravityDirection,
    ...state.sensors.angularVelocity.map((value) => value / 8),
    ...state.sensors.specificForce.map((value) => value / GRAVITY),
    ...velocity.map((value) => value / 3),
    state.pelvisHeight / 3,
    state.centerHeight / 3,
    state.sensors.leftFootClearanceM,
    state.sensors.rightFootClearanceM,
  ];
}

export interface SupportMetrics {
  readonly footLoadN: number;
  readonly otherLoadN: number;
  readonly upright: boolean;
  readonly supported: boolean;
  readonly stable: boolean;
}

// Use actual normal reactions, never the mere absence of non-foot contact.
export function measureSupport(
  state: PhysicsSnapshot,
  velocity: Vec3,
  footLoadN: number,
  otherLoadN: number,
): SupportMetrics {
  const upright = state.pelvisHeight > 2.4 && -state.sensors.gravityDirection[2] > 0.9;
  const supported =
    state.valid && upright && footLoadN >= 0.75 * WEIGHT && otherLoadN <= 0.05 * WEIGHT;
  const stable =
    supported && footLoadN <= 1.25 * WEIGHT && Math.hypot(...velocity) < 0.15;
  return { footLoadN, otherLoadN, upright, supported, stable };
}

export type EndReason = 'running' | 'fall' | 'invalid' | 'time-limit';

export interface Transition {
  readonly observation: readonly number[];
  readonly elapsed: number;
  readonly terminated: boolean;
  readonly truncated: boolean;
  readonly reason: EndReason;
  readonly support: SupportMetrics;
  readonly supportedSeconds: number;
  readonly stableSeconds: number;
  readonly longestStableSeconds: number;
}

export function invalidPhysics(state: PhysicsSnapshot): boolean {
  return !state.valid || state.jointGap > 0.03 || state.angleExcess > 3 || state.penetration > 0.03;
}

// One fixed-rate environment, with no renderer, reward, policy or hidden reflex.
// The physics body is reset only between episodes. Time and seed are explicit.
export class BalanceEnvironment {
  private rig = new PassiveRig(0.002, 0, { initialPose: BALANCED_STANCE });
  private reason: EndReason = 'running';
  private supportedSeconds = 0;
  private stableSeconds = 0;
  private longestStableSeconds = 0;

  constructor(readonly duration = 10, readonly ligaments = true) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid episode duration');
  }

  reset(seed: number, perturbationDegrees = 1): Transition {
    if (!Number.isSafeInteger(seed) || !Number.isFinite(perturbationDegrees)
      || perturbationDegrees < 0 || perturbationDegrees > 5) {
      throw new Error('Invalid reset options');
    }
    const random = seededRandom(seed);
    const perturb = () => (2 * random() - 1) * perturbationDegrees;
    const pose: Record<string, Angles> = { ...BALANCED_STANCE };
    for (const id of ['left-thigh', 'right-thigh', 'left-lower-leg', 'right-lower-leg']) {
      const bone = BONES.find((candidate) => candidate.id === id)!;
      pose[id] = clampAngles(bone, { ...pose[id], pitch: pose[id].pitch + perturb() });
    }
    this.rig = new PassiveRig(0.002, perturb(), { initialPose: pose });
    this.reason = 'running';
    this.supportedSeconds = 0;
    this.stableSeconds = 0;
    this.longestStableSeconds = 0;
    return this.transition(this.rig.snapshot(), 0, 0, 0);
  }

  step(action: readonly number[]): Transition {
    if (this.reason !== 'running') throw new Error('Reset a completed episode before stepping');
    const commands = decodeActions(action);
    let state = this.rig.snapshot();
    let foot = 0;
    let other = 0;
    let steps = 0;
    for (let i = 0; i < SUBSTEPS; i++) {
      this.rig.step({ ligaments: this.ligaments, mode: 'manual', commands });
      state = this.rig.snapshot();
      steps++;
      const sensors = state.sensors;
      foot += sensors.leftFootLoadN + sensors.rightFootLoadN;
      const nonFootLoad = Object.entries(sensors.contacts)
        .filter(([id]) => !isFoot(id))
        .reduce((sum, [, contact]) => sum + contact.normalLoadN, 0);
      other += nonFootLoad;
      if (invalidPhysics(state)) this.reason = 'invalid';
      else if (state.pelvisHeight < 2 || -sensors.gravityDirection[2] < 0.65
        || nonFootLoad > 0.25 * WEIGHT) this.reason = 'fall';
      else if (state.seconds >= this.duration) this.reason = 'time-limit';
      if (this.reason !== 'running') break;
    }
    return this.transition(state, foot / steps, other / steps, steps * STEP);
  }

  snapshot(): PhysicsSnapshot {
    return this.rig.snapshot();
  }

  private transition(
    state: PhysicsSnapshot,
    foot: number,
    other: number,
    elapsed: number,
  ): Transition {
    const velocity = massCenter(this.rig.mechanics().bodies).velocity;
    const observation = observe(state, velocity);
    if (!observation.every(Number.isFinite)) this.reason = 'invalid';
    const support = measureSupport(state, velocity, foot, other);
    if (support.supported && this.reason !== 'invalid') this.supportedSeconds += elapsed;
    this.stableSeconds = support.stable && this.reason !== 'invalid' ? this.stableSeconds + elapsed : 0;
    this.longestStableSeconds = Math.max(this.longestStableSeconds, this.stableSeconds);
    return {
      observation,
      elapsed: state.seconds,
      terminated: this.reason === 'fall' || this.reason === 'invalid',
      truncated: this.reason === 'time-limit',
      reason: this.reason,
      support,
      supportedSeconds: this.supportedSeconds,
      stableSeconds: this.stableSeconds,
      longestStableSeconds: this.longestStableSeconds,
    };
  }
}
