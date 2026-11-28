import type { Axis, Vec3 } from './rig';

export type ControlMode = 'off' | 'manual' | 'reflex';
export type Commands = Readonly<Partial<Record<string, Partial<Record<Axis, number>>>>>;

export interface AxisSense {
  readonly angle: number;
  readonly rate: number;
  readonly activation: number;
  readonly ligamentNm: number;
  readonly muscleNm: number;
  readonly maximumNm: number;
  readonly locked: boolean;
}

export interface JointSense {
  readonly id: string;
  readonly axes: Readonly<Record<Axis, AxisSense>>;
}

export interface ContactSense {
  readonly touching: boolean;
  readonly normalLoadN: number;
}

export interface SensorFrame {
  readonly joints: readonly JointSense[];
  readonly contacts: Readonly<Record<string, ContactSense>>;
  readonly gravityDirection: Vec3;
  readonly angularVelocity: Vec3;
  readonly specificForce: Vec3;
  readonly leftFootLoadN: number;
  readonly rightFootLoadN: number;
}

export interface ControlInput {
  readonly ligaments: boolean;
  readonly mode: ControlMode;
  readonly commands: Commands;
}

export const PASSIVE: ControlInput = { ligaments: false, mode: 'off', commands: {} };

export function signedUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

// The activation state is continuous. Power-off is a separate safety override.
export function activationStep(current: number, target: number, dt: number): number {
  const alpha = 1 - Math.exp(-dt / 0.06);
  return signedUnit(current + alpha * (signedUnit(target) - current));
}

// A slack region, progressive elastic resistance and velocity damping.
// All angles/rates are in radians and rad/s; inertia is in kg*m^2.
export function ligamentTorque(
  angle: number,
  rate: number,
  min: number,
  max: number,
  inertia: number,
): number {
  if (min === max) return 0;
  const slack = 0.25 * (angle < 0 ? Math.abs(min) : Math.abs(max));
  const range = Math.max(0.01, (angle < 0 ? Math.abs(min) : Math.abs(max)) - slack);
  const excess = Math.max(0, Math.abs(angle) - slack);
  const spring = -Math.sign(angle) * 100 * excess * (1 + Math.min(2, excess / range));
  const torque = inertia * (spring - 5 * rate);
  const cap = 100 * inertia;
  return Math.max(-cap, Math.min(cap, torque));
}

// Opposing signed muscle groups with a bounded torque-speed relationship.
export function muscleTorque(activation: number, rate: number, limit: number): number {
  const command = signedUnit(activation);
  const speed = Math.max(0, Math.sign(command) * rate);
  return command * limit * Math.max(0, 1 - speed / 8);
}

// Provisional engineering estimates, not reconstructed biological strengths.
export function nominalStrengthNm(id: string): number {
  if (id.endsWith('-thigh')) return 24000;
  if (id.endsWith('-lower-leg')) return 18000;
  if (id.endsWith('-foot')) return 10000;
  if (id.endsWith('-toe')) return 600;
  if (id.startsWith('spine-')) return 12000;
  if (id.startsWith('neck-')) return 3500;
  if (id.startsWith('tail-')) return 10000 / Number(id.slice(5)) ** 2;
  if (id === 'head') return 3500;
  if (id === 'jaw') return 1800;
  return 120;
}

// A replaceable sensor-to-command controller. This is a postural reflex,
// not a locomotion policy. It never writes to body transforms.
export function reflexCommands(sensors: SensorFrame): Commands {
  const commands: Partial<Record<string, Partial<Record<Axis, number>>>> = {};
  const upright = Math.max(0, -sensors.gravityDirection[2]);
  const supportGain = Math.min(1, (sensors.leftFootLoadN + sensors.rightFootLoadN) / 40000);
  const damping = 0.16 + 0.12 * supportGain;
  for (const joint of sensors.joints) {
    const target: Partial<Record<Axis, number>> = {};
    for (const axis of ['pitch', 'yaw', 'roll'] as const) {
      const sense = joint.axes[axis];
      target[axis] = sense.locked
        ? 0
        : signedUnit(-(0.8 + upright) * sense.angle - damping * sense.rate);
    }
    commands[joint.id] = target;
  }
  return commands;
}
