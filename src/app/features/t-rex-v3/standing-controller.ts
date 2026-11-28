import { allocateLoads, isFoot, massCenter, supportHull, torqueRequirements } from './biomechanics';
import type { MechanicsFrame, Point2 } from './biomechanics';
import { GRAVITY, MASS_KG } from './physical-constants';
import { signedUnit } from './neuromuscular';
import type { Commands, ControlInput, SensorFrame } from './neuromuscular';
import type { Angles, Axis } from './rig';

const AXES = ['pitch', 'yaw', 'roll'] as const;

export interface StandingTarget {
  readonly angles: Readonly<Record<string, Angles>>;
  readonly center: Point2;
}

// Experimental quasi-static controller. The desired centre of pressure
// responds to COM error and velocity; inverse statics supplies gravity/load
// compensation. The only outputs are bounded, ordinary muscle activations.
export function standingControl(
  frame: MechanicsFrame,
  sensors: SensorFrame,
  target: StandingTarget,
): ControlInput {
  const { position, velocity } = massCenter(frame.bodies);
  const contacts = frame.contacts.filter((point) => isFoot(point.id) && point.loadN > 0);
  const points = contacts.length >= 3 ? contacts : frame.candidates;
  const hull = supportHull(points);
  const targetCop: Point2 = [
    position[0] + 0.8 * (position[0] - target.center[0]) + 0.35 * velocity[0],
    position[1] + 0.8 * (position[1] - target.center[1]) + 0.35 * velocity[1],
  ];
  const reactions = hull.length ? allocateLoads(points, targetCop, MASS_KG * GRAVITY) : [];
  const feedforward = torqueRequirements(frame, reactions);
  const byJoint = new Map(feedforward.map((entry) => [entry.id + ':' + entry.axis, entry]));
  const commands: Record<string, Partial<Record<Axis, number>>> = {};
  for (const joint of sensors.joints) {
    const command: Partial<Record<Axis, number>> = {};
    for (const axis of AXES) {
      const state = joint.axes[axis];
      const torque = byJoint.get(joint.id + ':' + axis);
      const desired = ((target.angles[joint.id]?.[axis] ?? 0) * Math.PI) / 180;
      const feedback = 3 * (desired - state.angle) - 0.45 * state.rate;
      const compensation =
        torque && torque.maximumNm > 0 ? torque.requiredNm / torque.maximumNm : 0;
      command[axis] = state.locked ? 0 : signedUnit(compensation + feedback);
    }
    commands[joint.id] = command;
  }
  const output: Commands = commands;
  return { ligaments: false, mode: 'manual', commands: output };
}
