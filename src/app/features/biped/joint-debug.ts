import {
  ACTIONS,
  JOINT_LIMITS,
  JOINT_NAMES,
  MOTOR_SPEED,
  policyJointTarget,
  RADIANS_PER_DEGREE,
  START_ANGLES,
  Walker,
} from './walker';
import { Vec2 } from 'planck';

const isolatedCount = ACTIONS * 2;
export const COMBINATIONS = 1 << ACTIONS;
const phases = isolatedCount + COMBINATIONS;
const neutral = Array.from({ length: ACTIONS }, (_, index) => START_ANGLES[index % 3]);

export const degrees = (angle: number) => angle / RADIANS_PER_DEGREE;

export const JOINT_DEBUG_SPECS = JOINT_NAMES.map((name, index) => ({
  name,
  min: degrees(JOINT_LIMITS[index][0]),
  max: degrees(JOINT_LIMITS[index][1]),
  policyMin: degrees(policyJointTarget(index, -1)),
  policyMax: degrees(policyJointTarget(index, 1)),
  motorSpeed: degrees(MOTOR_SPEED),
}));

export function jointPose(phase: number) {
  if (phase < isolatedCount) {
    const motor = Math.floor(phase / 2);
    const end = phase % 2;
    const targets = [...neutral];
    targets[motor] = JOINT_LIMITS[motor % 3][end];
    return {
      label: `${motor < 3 ? 'Far' : 'Near'} leg · ${JOINT_NAMES[motor % 3]} ${end === 0 ? 'min' : 'max'}`,
      motor,
      targets,
    };
  }
  const config = phase - isolatedCount;
  const gray = config ^ (config >> 1); // Visit each endpoint pose, changing only one joint at a time.
  return {
    label: `Combined pose ${config + 1} / ${COMBINATIONS}`,
    motor: -1,
    targets: neutral.map((_, motor) => JOINT_LIMITS[motor % 3][(gray >> motor) & 1]),
  };
}

export class JointDebug {
  readonly rig = new Walker({}, { ground: [] });
  readonly peaks = Array.from({ length: ACTIONS }, () => 0);
  private phase = 0;
  private elapsed = 0;
  done = false;
  pose = jointPose(this.phase);

  constructor() {
    this.rig.world.setGravity(Vec2(0, 0));
    this.rig.torso.setStatic();
  }

  step() {
    if (this.done) return;
    this.drive();
    if (++this.elapsed >= this.dwell) this.next();
  }

  next(settle = false) {
    if (this.done) return;
    if (this.phase === phases - 1) {
      this.done = true;
      return;
    }
    this.pose = jointPose(++this.phase);
    this.elapsed = 0;
    if (settle) {
      for (let i = 0; i < this.dwell; i++) this.drive();
    }
  }

  private get dwell() {
    return this.phase < isolatedCount ? 36 : 24;
  }

  private drive() {
    this.rig.probeJoints(this.pose.targets, () => {
      this.rig.motors.forEach(({ joint }, index) => {
        this.peaks[index] = Math.max(this.peaks[index], Math.abs(degrees(joint.getJointSpeed())));
      });
    });
  }

  snapshot() {
    return {
      frame: this.rig.frame(),
      label: this.pose.label,
      motor: this.pose.motor,
      targets: this.pose.targets.map(degrees),
      peaks: [...this.peaks],
      done: this.done,
    };
  }
}
