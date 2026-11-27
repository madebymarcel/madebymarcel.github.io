import { Box, RevoluteJoint, Vec2, World, type Body, type Vec2Value } from 'planck';
import { RunningGait } from './running-gait';

export const RADIANS_PER_DEGREE = Math.PI / 180;
const radians = RADIANS_PER_DEGREE;
export const JOINT_LIMITS = [
  [-20 * radians, 120 * radians],
  [-140 * radians, 0],
  [-55 * radians, 15 * radians],
] as const;
export const START_ANGLES = [4 * radians, -8 * radians, 4 * radians] as const;
export const JOINT_NAMES = ['Hip', 'Knee', 'Ankle'] as const;
const MOTOR_TORQUES = [140, 130, 85];
export const MOTOR_SPEED = 12; // rad/s commanded ceiling, not a physical angular-velocity clamp
const POLICY_TRAVEL = 1.6;
export const CONTROL_DT = 1 / 30;
const PHYSICS_DT = CONTROL_DT / 4;
export const TRACK_GOAL = 5;
export const EPISODE_SECONDS = 12;
const UPPER = 0.42;
const LOWER = 0.43;
const HIP = -0.16;
const SOLE = -0.05;
const HEEL = -0.08;
const TOE = 0.18;
const FLOOR = 1;
const ROBOT = 2;
export const OBSERVATIONS = 21;
export const ACTIONS = 6;
export type Contacts = [boolean, boolean, boolean, boolean];
export type Pose = { x: number; y: number; angle: number };
export type Frame = {
  torso: Pose;
  legs: { hip: Vec2Value; knee: Vec2Value; ankle: Vec2Value; toe: Vec2Value; heel: Vec2Value }[];
  contacts: Contacts;
  angles: number[];
  tail?: { root: Vec2Value; tip: Vec2Value; angle: number; jointAngle: number };
};
export type Start = { tilt?: number; vx?: number; friction?: number; crouch?: number };
export type Ground = { from: number; to: number; height: number };
export const FLAT_GROUND: readonly Ground[] = [{ from: -100, to: 100, height: 0 }];
type Collider = { x: number; y: number; halfWidth: number; halfHeight: number; density: number };
export type TailMorphology = {
  anchor: Vec2Value;
  length: number;
  halfHeight: number;
  density: number;
  limit: number;
  maxTorque: number;
  pitchGain: number;
  velocityGain: number;
};
export type Morphology = {
  torso: readonly [Collider, ...Collider[]];
  tail?: TailMorphology;
  hip: number;
  upper: number;
  lower: number;
  heel: number;
  toe: number;
  sole: number;
  neutral: readonly [number, number, number];
  limits: readonly (readonly [number, number])[];
};
const BIPED: Morphology = {
  torso: [{ x: 0, y: 0, halfWidth: 0.19, halfHeight: 0.19, density: 220 }],
  hip: HIP,
  upper: UPPER,
  lower: LOWER,
  heel: HEEL,
  toe: TOE,
  sole: SOLE,
  neutral: START_ANGLES,
  limits: JOINT_LIMITS,
};
export type WorldOptions = {
  ground?: readonly Ground[];
  seconds?: number;
  allowFalls?: boolean;
  morphology?: Morphology;
};
type Motor = { joint: RevoluteJoint; neutral: number; index: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function policyJointTarget(index: number, command: number, body = BIPED): number {
  const [min, max] = body.limits[index];
  return clamp(body.neutral[index] + POLICY_TRAVEL * clamp(command, -1, 1), min, max);
}

function drive(joint: RevoluteJoint, target: number) {
  joint.setMotorSpeed(clamp(14 * (target - joint.getJointAngle()), -MOTOR_SPEED, MOTOR_SPEED));
}

function rotate(x: number, y: number, angle: number): Vec2 {
  return Vec2(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle));
}

export class Walker {
  readonly world = new World({ gravity: Vec2(0, -9.81), allowSleep: false });
  readonly torso: Body;
  readonly tail?: { body: Body; joint: RevoluteJoint; length: number };
  readonly motors: Motor[] = [];
  readonly legs: { thigh: Body; shin: Body; foot: Body }[] = [];
  private readonly feet = new Map<Body, number>();
  private slipSpeed = 0;
  private forces: Contacts = [false, false, false, false];
  contacts: Contacts = [false, false, false, false];
  ticks = 0;
  work = 0;
  distance = 0;
  steps = 0;
  flightTime = 0;
  slipDistance = 0;
  done = false;
  fell = false;
  private lastLanded: number | null = null;
  private contactX = [0, 0];
  private lifted = [false, false];
  readonly ground: readonly Ground[];
  private readonly morphology: Morphology;
  private gait = new RunningGait();
  get runningGait() {
    return this.gait;
  }
  get alternatingFlights() {
    return this.gait.alternating;
  }
  resetRunningGait() {
    this.gait = new RunningGait();
  }
  private previous: Contacts = [false, false, false, false];

  constructor(
    start: Start = {},
    private readonly options: WorldOptions = {},
  ) {
    this.ground = options.ground ?? FLAT_GROUND;
    this.morphology = options.morphology ?? BIPED;
    const { hip: hipOffset, upper, lower, heel, toe, sole, neutral, torso, tail } = this.morphology;
    for (const { from, to, height } of this.ground) {
      const depth = 0.5 + height;
      const body = this.world.createBody({ position: Vec2((from + to) / 2, height - depth / 2) });
      body.createFixture(Box((to - from) / 2, depth / 2), {
        friction: start.friction ?? 0.9,
        filterCategoryBits: FLOOR,
        filterMaskBits: ROBOT,
      });
    }
    const tilt = start.tilt ?? 0;
    const crouch = start.crouch ?? 0;
    const hip = rotate(0, hipOffset, tilt);
    const poses = [-0.045, 0.045].map((split) => {
      const thighAngle = tilt + neutral[0] + crouch * 0.5 + split;
      const shinAngle = thighAngle + neutral[1] - crouch;
      const footAngle = shinAngle + neutral[2] + crouch * 0.5 - split;
      const knee = Vec2.add(hip, rotate(0, -upper, thighAngle));
      const ankle = Vec2.add(knee, rotate(0, -lower, shinAngle));
      const lowest =
        ankle.y + Math.min(rotate(heel, sole, footAngle).y, rotate(toe, sole, footAngle).y);
      return { thighAngle, shinAngle, footAngle, knee, ankle, lowest };
    });
    const bodyBottom = Math.min(
      ...torso.map(
        ({ x, y, halfWidth, halfHeight }) =>
          rotate(x, y, tilt).y -
          halfWidth * Math.abs(Math.sin(tilt)) -
          halfHeight * Math.abs(Math.cos(tilt)),
      ),
    );
    const tailBottom = tail
      ? rotate(tail.anchor.x - tail.length / 2, tail.anchor.y, tilt).y -
        (tail.length / 2) * Math.abs(Math.sin(tilt)) -
        tail.halfHeight * Math.abs(Math.cos(tilt))
      : Infinity;
    const minY = Math.min(...poses.map(({ lowest }) => lowest), bodyBottom, tailBottom);
    const floorOffset = 0.015 - minY;
    hip.y += floorOffset;
    const [core, ...extensions] = torso;
    const collider = ({ x, y, halfWidth, halfHeight }: Collider) =>
      Box(halfWidth, halfHeight, Vec2(x, y));
    this.torso = this.body(Vec2(0, floorOffset), tilt, collider(core), core.density, start.vx ?? 0);
    for (const part of extensions) this.attach(this.torso, collider(part), part.density);
    this.torso.setLinearVelocity(Vec2(start.vx ?? 0, 0));

    if (tail) {
      const body = this.body(
        this.torso.getWorldPoint(tail.anchor),
        tilt,
        Box(tail.length / 2, tail.halfHeight, Vec2(-tail.length / 2, 0)),
        tail.density,
        start.vx ?? 0,
      );
      const joint = new RevoluteJoint({
        bodyA: this.torso,
        bodyB: body,
        localAnchorA: tail.anchor,
        localAnchorB: Vec2(),
        referenceAngle: 0,
        lowerAngle: -tail.limit,
        upperAngle: tail.limit,
        enableLimit: true,
        enableMotor: true,
        maxMotorTorque: tail.maxTorque,
      });
      this.world.createJoint(joint);
      this.tail = { body, joint, length: tail.length };
    }

    for (let side = 0; side < 2; side++) {
      const { thighAngle, shinAngle, footAngle, knee, ankle } = poses[side];
      knee.y += floorOffset;
      ankle.y += floorOffset;
      const thigh = this.body(hip, thighAngle, Box(0.047, upper / 2, Vec2(0, -upper / 2)), 135);
      const shin = this.body(knee, shinAngle, Box(0.04, lower / 2, Vec2(0, -lower / 2)), 82);
      const foot = this.body(
        ankle,
        footAngle,
        Box((toe - heel) / 2, 0.029, Vec2((toe + heel) / 2, sole + 0.029)),
        105,
      );
      for (const body of [thigh, shin, foot]) body.setLinearVelocity(Vec2(start.vx ?? 0, 0));
      this.legs.push({ thigh, shin, foot });
      this.feet.set(foot, side);
      this.hinge(0, this.torso, thigh, Vec2(0, hipOffset));
      this.hinge(1, thigh, shin, Vec2(0, -upper));
      this.hinge(2, shin, foot, Vec2(0, -lower));
    }
    this.world.on('post-solve', (contact, impulse) => {
      const a = contact.getFixtureA().getBody();
      const b = contact.getFixtureB().getBody();
      const side = this.feet.get(a) ?? this.feet.get(b);
      if (side === undefined) return;
      const foot = this.legs[side].foot;
      const manifold = contact.getWorldManifold(null);
      if (!manifold || manifold.normal.y * (this.feet.has(a) ? -1 : 1) < 0.55) return;
      for (let i = 0; i < manifold.pointCount; i++) {
        if (impulse.normalImpulses[i] > 0.01) {
          const point = manifold.points[i];
          this.forces[2 * side + Number(foot.getLocalPoint(point).x >= 0)] = true;
          this.slipSpeed = Math.max(
            this.slipSpeed,
            Math.abs(foot.getLinearVelocityFromWorldPoint(point).x),
          );
        }
      }
    });
  }

  private body(
    pos: Vec2Value,
    angle: number,
    shape: ReturnType<typeof Box>,
    density: number,
    vx = 0,
  ): Body {
    const body = this.world.createDynamicBody({
      position: pos,
      angle,
      linearVelocity: Vec2(vx, 0),
      angularDamping: 0.06,
    });
    this.attach(body, shape, density);
    return body;
  }

  private attach(body: Body, shape: ReturnType<typeof Box>, density: number) {
    // The two legs occupy different lateral lanes, projected into one side-view plane.
    body.createFixture(shape, {
      density,
      friction: 0.9,
      restitution: 0,
      filterCategoryBits: ROBOT,
      filterMaskBits: FLOOR,
    });
  }

  private hinge(index: number, parent: Body, child: Body, anchor: Vec2Value) {
    const [lowerAngle, upperAngle] = this.morphology.limits[index];
    const joint = new RevoluteJoint({
      bodyA: parent,
      bodyB: child,
      localAnchorA: anchor,
      localAnchorB: Vec2(),
      referenceAngle: 0,
      lowerAngle,
      upperAngle,
      enableLimit: true,
      enableMotor: true,
      maxMotorTorque: MOTOR_TORQUES[index],
    });
    this.world.createJoint(joint);
    this.motors.push({ joint, neutral: this.morphology.neutral[index], index });
  }

  observe(out: Float64Array = new Float64Array(OBSERVATIONS)): Float64Array {
    const v = this.torso.getLinearVelocity();
    const angle = this.torso.getAngle();
    out[0] = this.options.allowFalls
      ? Math.atan2(Math.sin(angle), Math.cos(angle))
      : clamp(angle, -2, 2);
    out[1] = clamp(this.torso.getAngularVelocity() / 5, -2, 2);
    out[2] = clamp(v.x / 3, -2, 2);
    out[3] = clamp(v.y / 3, -2, 2);
    for (let i = 0; i < ACTIONS; i++) {
      const { joint, neutral } = this.motors[i];
      out[4 + i * 2] = clamp(joint.getJointAngle() - neutral, -2, 2);
      out[5 + i * 2] = clamp(joint.getJointSpeed() / 10, -2, 2);
    }
    for (let i = 0; i < 4; i++) out[16 + i] = Number(this.contacts[i]);
    out[20] = 1; // Policy bias, not a clock or gait phase.
    return out;
  }

  groundHeight(x: number): number {
    return this.ground.find(({ from, to }) => x >= from && x < to)?.height ?? -0.5;
  }

  // A reproducible disturbance for the get-up segment, not a policy action.
  trip(): void {
    this.torso.applyAngularImpulse(-24);
    this.torso.applyLinearImpulse(Vec2(-18, -9), this.torso.getWorldCenter());
  }

  // Diagnostic only: bypass the policy target range, not the solver or motor limits.
  probeJoints(targets: readonly number[], sample: () => void) {
    for (let substep = 0; substep < 4; substep++) {
      this.motors.forEach(({ joint, index }, i) => {
        const [min, max] = this.morphology.limits[index];
        drive(joint, clamp(targets[i], min, max));
      });
      this.stepWorld();
      sample();
    }
  }

  private stepWorld() {
    if (this.tail && this.morphology.tail) {
      const { joint } = this.tail;
      const { pitchGain, velocityGain, limit } = this.morphology.tail;
      const pitch = this.torso.getAngle();
      const pitchRate = this.torso.getAngularVelocity();
      // Accelerating the tail in the direction of body pitch generates an opposing
      // reaction torque on the torso. The motor is internal, so there is no free external torque.
      const target = clamp(pitchGain * pitch + velocityGain * pitchRate, -limit, limit);
      joint.setMotorSpeed(clamp(14 * (target - joint.getJointAngle()), -4, 4));
    }
    this.world.step(PHYSICS_DT, 10, 4);
  }

  step(action: ArrayLike<number>): number {
    if (this.done) return 0;
    const before = this.torso.getPosition().x;
    const beforeSteps = this.steps;
    const beforeSlip = this.slipDistance;
    const beforeAir = this.flightTime;
    let effort = 0;
    for (let substep = 0; substep < 4; substep++) {
      for (let i = 0; i < ACTIONS; i++) {
        const { joint, index } = this.motors[i];
        drive(joint, policyJointTarget(index, action[i], this.morphology));
      }
      this.forces = [false, false, false, false];
      this.slipSpeed = 0;
      this.stepWorld();
      this.contacts = this.forces;
      this.slipDistance += this.slipSpeed * PHYSICS_DT;
      for (const { joint } of this.motors) {
        effort +=
          Math.abs(joint.getMotorTorque(1 / PHYSICS_DT) * joint.getJointSpeed()) * PHYSICS_DT;
      }
      if (this.tail) {
        const { joint } = this.tail;
        effort +=
          Math.abs(joint.getMotorTorque(1 / PHYSICS_DT) * joint.getJointSpeed()) * PHYSICS_DT;
      }
      this.recordFlight();
      this.countSteps();
    }
    this.ticks++;
    const torso = this.torso.getPosition();
    this.distance = torso.x;
    this.work += effort;
    this.fell =
      torso.y < Math.max(0, this.groundHeight(torso.x)) + 0.55 ||
      Math.abs(Math.atan2(Math.sin(this.torso.getAngle()), Math.cos(this.torso.getAngle()))) > 1.15;
    this.done =
      (this.fell && !this.options.allowFalls) ||
      this.ticks >= (this.options.seconds ?? EPISODE_SECONDS) / CONTROL_DT;
    return (
      Math.min(torso.x - before, 0.85 * CONTROL_DT) -
      0.00025 * effort -
      0.8 * (this.slipDistance - beforeSlip) -
      1.2 * (this.flightTime - beforeAir) +
      0.24 * (this.steps - beforeSteps) -
      (this.fell ? 0.8 : 0)
    );
  }

  private recordFlight() {
    const left = this.contacts[0] || this.contacts[1];
    const right = this.contacts[2] || this.contacts[3];
    if (!left && !right) this.flightTime += PHYSICS_DT;
    this.gait.observe(left, right);
  }

  private countSteps() {
    const { heel: back, toe: front, sole } = this.morphology;
    for (let side = 0; side < 2; side++) {
      const i = side * 2;
      const foot = this.legs[side].foot;
      if (!(this.contacts[i] || this.contacts[i + 1])) {
        const heel = foot.getWorldPoint(Vec2(back, sole));
        const toe = foot.getWorldPoint(Vec2(front, sole));
        if (
          Math.min(
            heel.y - Math.max(0, this.groundHeight(heel.x)),
            toe.y - Math.max(0, this.groundHeight(toe.x)),
          ) > 0.028
        ) {
          this.lifted[side] = true;
        }
        continue;
      }
      const x = foot.getPosition().x;
      const newLanding = this.lifted[side] && !(this.previous[i] || this.previous[i + 1]);
      this.lifted[side] = false;
      if (
        (newLanding || this.lastLanded === null) &&
        this.lastLanded !== side &&
        (this.lastLanded === null || x > this.contactX[this.lastLanded] + 0.1)
      ) {
        if (this.lastLanded !== null) this.steps++;
        this.lastLanded = side;
      }
      this.contactX[side] = x;
    }
    this.previous = this.contacts;
  }

  frame(): Frame {
    const { heel: back, toe: front, sole } = this.morphology;
    const { x, y } = this.torso.getPosition();
    return {
      torso: { x, y, angle: this.torso.getAngle() },
      legs: this.legs.map(({ thigh, shin, foot }) => ({
        hip: { ...thigh.getPosition() },
        knee: { ...shin.getPosition() },
        ankle: { ...foot.getPosition() },
        toe: foot.getWorldPoint(Vec2(front, sole)),
        heel: foot.getWorldPoint(Vec2(back, sole)),
      })),
      contacts: [...this.contacts],
      angles: this.motors.map(({ joint }) => joint.getJointAngle() / radians),
      ...(this.tail && {
        tail: {
          root: { ...this.tail.body.getPosition() },
          tip: this.tail.body.getWorldPoint(Vec2(-this.tail.length, 0)),
          angle: this.tail.body.getAngle(),
          jointAngle: this.tail.joint.getJointAngle(),
        },
      }),
    };
  }
}
