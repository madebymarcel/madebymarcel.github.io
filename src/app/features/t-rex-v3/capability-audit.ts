import { ACTION_HZ, ACTIONS, BalanceEnvironment } from './balance-environment';
import type { Transition } from './balance-environment';
import { GRAVITY, MASS_KG } from './passive-physics';
import type { PhysicsSnapshot } from './passive-physics';

const WEIGHT = MASS_KG * GRAVITY;
const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];

export interface CapabilityReport {
  readonly supportedSeconds: number;
  readonly longestStableSeconds: number;
  readonly longestSupportedSeconds: number;
  readonly leftLifts: number;
  readonly rightLifts: number;
  readonly weightTransfers: number;
  readonly leftSteps: number;
  readonly rightSteps: number;
  readonly alternatingSteps: number;
  readonly maxTailPitchDegrees: number;
  readonly maxTorsoPitchDegrees: number;
}

interface FootState {
  plantedX: number | null;
  liftedFrom: number | null;
  liftSeconds: number;
  liftCounted: boolean;
  lifts: number;
  steps: number;
}

function footX(snapshot: PhysicsSnapshot, side: Side): number {
  const foot = snapshot.pose.find((item) => item.bone.id === side + '-foot');
  if (!foot) throw new Error('Missing foot in V3 physics snapshot');
  return foot.end[0];
}

function emptyFoot(): FootState {
  return { plantedX: null, liftedFrom: null, liftSeconds: 0, liftCounted: false, lifts: 0, steps: 0 };
}

// Diagnostics, never reward shaping. A lift needs the other foot to carry
// actual body weight; a step needs a qualified lift followed by a loaded,
// forward touchdown. A falling/invalid interval can never count.
export class CapabilityAudit {
  private readonly feet = { left: emptyFoot(), right: emptyFoot() };
  private supportSide: Side | null = null;
  private lastStep: Side | null = null;
  private weightTransfers = 0;
  private alternatingSteps = 0;
  private supportedRun = 0;
  private longestSupported = 0;
  private maxTail = 0;
  private maxTorso = 0;
  private lastElapsed = 0;

  observe(state: Transition, snapshot: PhysicsSnapshot): void {
    const dt = Math.max(0, Math.min(1 / ACTION_HZ, state.elapsed - this.lastElapsed));
    this.lastElapsed = state.elapsed;
    if (state.reason === 'invalid' || state.reason === 'fall') return;
    this.supportedRun = state.support.supported ? this.supportedRun + dt : 0;
    this.longestSupported = Math.max(this.longestSupported, this.supportedRun);
    const sensor = snapshot.sensors;
    for (const side of SIDES) {
      const foot = this.feet[side];
      const other = side === 'left' ? 'right' : 'left';
      const load = side === 'left' ? sensor.leftFootLoadN : sensor.rightFootLoadN;
      const otherLoad = other === 'left' ? sensor.leftFootLoadN : sensor.rightFootLoadN;
      const clearance = side === 'left' ? sensor.leftFootClearanceM : sensor.rightFootClearanceM;
      const x = footX(snapshot, side);
      const safe = state.support.upright && state.support.otherLoadN <= 0.05 * WEIGHT;
      const lifted =
        safe && clearance >= 0.03 && load <= 0.05 * WEIGHT && otherLoad >= 0.75 * WEIGHT;
      if (!safe) {
        foot.liftedFrom = null;
        foot.liftSeconds = 0;
        foot.liftCounted = false;
        foot.plantedX = null;
      }
      if (lifted && foot.plantedX !== null) {
        if (foot.liftedFrom === null) foot.liftedFrom = foot.plantedX;
        foot.liftSeconds += dt;
        if (!foot.liftCounted && foot.liftSeconds >= 0.1 - 1e-9) {
          foot.lifts++;
          foot.liftCounted = true;
          if (this.supportSide !== null && this.supportSide !== other) this.weightTransfers++;
          this.supportSide = other;
        }
      } else {
        foot.liftSeconds = 0;
        if (!foot.liftCounted) foot.liftedFrom = null;
        if (safe && clearance <= 0.015 && load >= 0.15 * WEIGHT) {
          if (foot.liftCounted && foot.liftedFrom !== null && x - foot.liftedFrom >= 0.05) {
            foot.steps++;
            if (this.lastStep !== null && this.lastStep !== side) this.alternatingSteps++;
            this.lastStep = side;
          }
          foot.plantedX = x;
          foot.liftedFrom = null;
          foot.liftCounted = false;
        }
      }
    }
    for (const joint of sensor.joints) {
      const pitch = Math.abs(joint.axes.pitch.angle * 180 / Math.PI);
      if (joint.id.startsWith('tail-')) this.maxTail = Math.max(this.maxTail, pitch);
      if (joint.id.startsWith('spine-')) this.maxTorso = Math.max(this.maxTorso, pitch);
    }
  }

  report(state: Transition): CapabilityReport {
    return {
      supportedSeconds: state.supportedSeconds,
      longestStableSeconds: state.longestStableSeconds,
      longestSupportedSeconds: this.longestSupported,
      leftLifts: this.feet.left.lifts,
      rightLifts: this.feet.right.lifts,
      weightTransfers: this.weightTransfers,
      leftSteps: this.feet.left.steps,
      rightSteps: this.feet.right.steps,
      alternatingSteps: this.alternatingSteps,
      maxTailPitchDegrees: this.maxTail,
      maxTorsoPitchDegrees: this.maxTorso,
    };
  }
}

export interface CapabilityGate {
  readonly validEpisodes: number;
  readonly invalidEpisodes: number;
  readonly stableStanding: boolean;
  readonly leftLift: boolean;
  readonly rightLift: boolean;
  readonly transfer: boolean;
  readonly alternatingSteps: boolean;
  readonly passed: boolean;
}

export function assessCapabilities(
  reports: readonly { reason: Transition['reason']; capability: CapabilityReport }[],
): CapabilityGate {
  const valid = reports.filter((report) => report.reason !== 'invalid' && report.reason !== 'running');
  const invalidEpisodes = reports.filter((report) => report.reason === 'invalid').length;
  const stableStanding = valid.some((report) => report.capability.longestStableSeconds >= 2);
  const leftLift = valid.some((report) => report.capability.leftLifts > 0);
  const rightLift = valid.some((report) => report.capability.rightLifts > 0);
  const transfer = valid.some((report) => report.capability.weightTransfers > 0);
  const alternatingSteps = valid.some((report) => report.capability.alternatingSteps > 0);
  return {
    validEpisodes: valid.length,
    invalidEpisodes,
    stableStanding,
    leftLift,
    rightLift,
    transfer,
    alternatingSteps,
    passed:
      valid.length >= 3 &&
      invalidEpisodes <= (valid.length + invalidEpisodes) * 0.1 &&
      stableStanding && leftLift && rightLift && transfer && alternatingSteps,
  };
}

// Zero-action baseline uses exactly the same environment and measurement.
export function passiveCapability(seed: number, horizon = 5): { reason: Transition['reason']; capability: CapabilityReport; elapsed: number } {
  const env = new BalanceEnvironment(horizon);
  let state = env.reset(seed);
  const audit = new CapabilityAudit();
  while (state.reason === 'running') {
    state = env.step(ACTIONS.map(() => 0));
    audit.observe(state, env.snapshot());
  }
  return { reason: state.reason, capability: audit.report(state), elapsed: state.elapsed };
}
