import {
  Body,
  Box,
  Constraint,
  Equation,
  Plane,
  PointToPointConstraint,
  Quaternion,
  Vec3 as Vector,
  World,
} from 'cannon-es';
import { AXES, BONES, poseRig } from './rig';
import type { Angles, Axis, Bone, PosedBone, Vec3 } from './rig';
import { isFoot } from './biomechanics';
import { collisionExcluded } from './collision-policy';
import { CoulombSolver } from './coulomb-solver';
import type { MechanicsFrame, JointMechanics, SupportPoint } from './biomechanics';
import { GRAVITY, MASS_KG, STEP } from './physical-constants';
import { calibrationPoses, calibrateMuscles, muscleKey } from './muscle-profile';
import type { MuscleProfile } from './muscle-profile';
import { PASSIVE, activationStep, ligamentTorque, reflexCommands } from './neuromuscular';
import type { AxisSense, Commands, ControlInput, JointSense, SensorFrame } from './neuromuscular';

export { GRAVITY, MASS_KG, STEP } from './physical-constants';
const KG_PER_UNIT = 100;
export const FRICTION = 0.65;
const DEG = Math.PI / 180;
const MAX_IMPULSE = 1e6;
const VISIBLE = BONES.filter((bone) => bone.id !== 'root');

interface Segment {
  bone: Bone;
  body: Body;
  rest: Quaternion;
  inverseRest: Quaternion;
  center: Vector;
}

export interface PhysicsSnapshot {
  readonly pose: readonly PosedBone[];
  readonly seconds: number;
  readonly massKg: number;
  readonly centerHeight: number;
  readonly pelvisHeight: number;
  readonly groundContacts: number;
  readonly jointGap: number;
  readonly angleExcess: number;
  readonly penetration: number;
  readonly valid: boolean;
  readonly sensors: SensorFrame;
}

function weight(bone: Bone): number {
  if (bone.id === 'pelvis') return 1300;
  if (bone.id.startsWith('spine-')) return 600;
  if (bone.id.startsWith('neck-')) return [140, 110, 90, 70][Number(bone.id.slice(5)) - 1];
  if (bone.id === 'head') return 580;
  if (bone.id === 'jaw') return 130;
  if (bone.id.startsWith('tail-')) {
    return [600, 480, 350, 240, 150, 90, 45, 20][Number(bone.id.slice(5)) - 1];
  }
  if (bone.id.endsWith('-thigh')) return 480;
  if (bone.id.endsWith('-lower-leg')) return 240;
  if (bone.id.endsWith('-foot')) return 90;
  if (bone.id.endsWith('-toe')) return 16;
  if (bone.id.endsWith('-upper-arm')) return 25;
  if (bone.id.endsWith('-forearm')) return 12;
  if (bone.id.endsWith('-hand')) return 5;
  return 3;
}

const TOTAL_WEIGHT = VISIBLE.reduce((sum, bone) => sum + weight(bone), 0);

function vec(value: Vec3): Vector {
  return new Vector(...value);
}

// This matches the rig's rest basis: local X follows the bone, local Z is
// perpendicular to the bone and the world lateral axis.
function restRotation(direction: Vector): Quaternion {
  const x = direction.unit();
  const pitch = new Quaternion().setFromAxisAngle(new Vector(0, 1, 0), Math.atan2(-x.z, x.x));
  const yaw = new Quaternion().setFromAxisAngle(
    new Vector(0, 0, 1),
    Math.asin(Math.max(-1, Math.min(1, x.y))),
  );
  return pitch.mult(yaw);
}

function localPoint(segment: Segment, point: Vector): Vector {
  return segment.inverseRest.vmult(point.vsub(segment.center));
}

function makeSegment(bone: Bone): Segment {
  const start = vec(bone.start);
  const end = vec(bone.end);
  const direction = end.vsub(start);
  const rest = restRotation(direction);
  const inverseRest = rest.inverse();
  const midpoint = start.vadd(direction.scale(0.5));
  const center = midpoint.clone();
  if (bone.kind === 'spine') center.z -= 0.45;
  const mass = (MASS_KG * weight(bone)) / TOTAL_WEIGHT / KG_PER_UNIT;
  // Build in local coordinates so Cannon computes inertia in the rest basis.
  const body = new Body({ mass, linearDamping: 0, angularDamping: 0 });
  const segment = { bone, body, rest, inverseRest, center };
  body.addShape(
    new Box(new Vector(direction.length() / 2, bone.width, bone.height)),
    localPoint(segment, midpoint),
  );
  if (bone.kind === 'spine') {
    const ribs = midpoint.vadd(new Vector(0, 0, -0.61));
    body.addShape(
      new Box(
        new Vector(
          direction.length() * 0.47,
          ['spine-3', 'spine-4'].includes(bone.id) ? 0.3 : 0.54,
          0.49,
        ),
      ),
      localPoint(segment, ribs),
    );
  }
  body.position.copy(center);
  body.quaternion.copy(rest);
  body.updateInertiaWorld(true);
  body.aabbNeedsUpdate = true;
  return segment;
}

interface JointState {
  angles: Record<Axis, number>;
  gradients: Record<Axis, Vector>;
  axes: Record<Axis, Vector>;
}

// Angular coordinates use the same local Rz(yaw) Ry(pitch) Rx(roll)
// convention as poseRig. Gradients map relative angular velocity to rates.
function jointState(parent: Segment, child: Segment): JointState {
  const frame = parent.body.quaternion.mult(parent.inverseRest).mult(child.rest);
  const q = frame.inverse().mult(child.body.quaternion);
  const { x, y, z, w } = q;
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  const c = Math.max(0.05, Math.cos(pitch));
  const a = new Vector(Math.cos(yaw) * c, Math.sin(yaw) * c, -Math.sin(pitch));
  const b = new Vector(-Math.sin(yaw), Math.cos(yaw), 0);
  const d = new Vector(0, 0, 1);
  return {
    angles: { pitch, yaw, roll },
    axes: { roll: frame.vmult(a), pitch: frame.vmult(b), yaw: frame.vmult(d) },
    gradients: {
      roll: frame.vmult(b.cross(d).scale(1 / c)),
      pitch: frame.vmult(d.cross(a).scale(1 / c)),
      yaw: frame.vmult(a.cross(b).scale(1 / c)),
    },
  };
}

// A solver equation, not a motor or a pose correction. Its reaction is
// equal and opposite on the two bodies. Unilateral stops push only inward.
class AngularStop extends Equation {
  private error = 0;

  constructor(
    parent: Body,
    child: Body,
    private readonly direction: number,
    private readonly bound: number,
    locked: boolean,
    timestep: number,
  ) {
    super(parent, child, locked ? -MAX_IMPULSE : 0, MAX_IMPULSE);
    this.setSpookParams(1e8, 4, timestep);
  }

  updateStop(angle: number, gradient: Vector): void {
    this.error = (angle - this.bound) * this.direction;
    gradient.scale(this.direction, this.jacobianElementB.rotational);
    this.jacobianElementB.rotational.negate(this.jacobianElementA.rotational);
  }

  override computeB(h: number): number {
    return -this.a * this.error - this.b * this.computeGW() - h * this.computeGiMf();
  }

  override computeGiMGt(): number {
    const a = this.jacobianElementA.rotational;
    const b = this.jacobianElementB.rotational;
    return (
      a.dot(this.bi.invInertiaWorldSolve.vmult(a)) + b.dot(this.bj.invInertiaWorldSolve.vmult(b))
    );
  }
}

// Implicit, unilateral force-velocity actuator. Cannon 0.20 clamps solver
// impulses (lambda) directly, so convert Nm to scaled torque times timestep.
// At zero contraction speed it supplies activation * capacity; at the free
// contraction speed its torque falls to zero. It cannot pull in reverse.
class MuscleEquation extends Equation {
  private direction = 0;

  constructor(parent: Body, child: Body) {
    super(parent, child, 0, 0);
    this.enabled = false;
  }

  configure(gradient: Vector, activation: number, capacityNm: number, timestep: number): void {
    this.direction = Math.sign(activation);
    const impulse = (Math.abs(activation) * capacityNm * timestep) / KG_PER_UNIT;
    this.enabled = impulse > 1e-10;
    this.minForce = 0;
    this.maxForce = impulse;
    this.multiplier = 0;
    if (!this.enabled) return;
    gradient.scale(this.direction, this.jacobianElementB.rotational);
    this.jacobianElementB.rotational.negate(this.jacobianElementA.rotational);
    // lambda = impulseMax * (1 - signedRate / 8), clamped to [0, impulseMax].
    this.eps = 8 / impulse;
  }

  override computeB(h: number): number {
    return 8 - this.computeGW() - h * this.computeGiMf();
  }

  override computeGiMGt(): number {
    const a = this.jacobianElementA.rotational;
    const b = this.jacobianElementB.rotational;
    return (
      a.dot(this.bi.invInertiaWorldSolve.vmult(a)) + b.dot(this.bj.invInertiaWorldSolve.vmult(b))
    );
  }

  torqueNm(): number {
    return this.enabled ? this.direction * this.multiplier * KG_PER_UNIT : 0;
  }
}

class Joint extends PointToPointConstraint {
  private readonly stops: { axis: Axis; equation: AngularStop }[] = [];
  private readonly activation: Record<Axis, number> = { pitch: 0, yaw: 0, roll: 0 };
  private readonly ligament: Record<Axis, number> = { pitch: 0, yaw: 0, roll: 0 };
  private readonly motors = new Map<Axis, MuscleEquation>();
  private profile: MuscleProfile | undefined;

  constructor(
    private readonly parent: Segment,
    private readonly child: Segment,
    private readonly timestep: number,
  ) {
    const anchor = vec(child.bone.start);
    super(
      parent.body,
      localPoint(parent, anchor),
      child.body,
      localPoint(child, anchor),
      MAX_IMPULSE,
    );
    this.collideConnected = false;
    for (const equation of this.equations) {
      equation.setSpookParams(1e8, 4, timestep);
    }
    for (const axis of AXES) {
      const [min, max] = child.bone.limits[axis];
      const locked = min === max;
      const lower = new AngularStop(parent.body, child.body, 1, min * DEG, locked, timestep);
      this.stops.push({ axis, equation: lower });
      this.equations.push(lower);
      if (!locked) {
        const upper = new AngularStop(parent.body, child.body, -1, max * DEG, false, timestep);
        this.stops.push({ axis, equation: upper });
        this.equations.push(upper);
        const motor = new MuscleEquation(parent.body, child.body);
        this.motors.set(axis, motor);
        this.equations.push(motor);
      }
    }
  }

  setProfile(profile: MuscleProfile): void {
    this.profile = profile;
  }

  private maximumNm(axis: Axis): number {
    return this.profile?.get(muscleKey(this.child.bone.id, axis)) ?? 0;
  }

  override update(): void {
    super.update();
    const state = jointState(this.parent, this.child);
    for (const { axis, equation } of this.stops) {
      equation.updateStop(state.angles[axis], state.gradients[axis]);
    }
  }

  private inertia(gradient: Vector): number {
    const a = this.parent.body.invInertiaWorld.vmult(gradient);
    const b = this.child.body.invInertiaWorld.vmult(gradient);
    const inverse = gradient.dot(a) + gradient.dot(b);
    return inverse > 1e-10 ? KG_PER_UNIT / inverse : 0;
  }

  private rate(gradient: Vector): number {
    const relative = this.child.body.angularVelocity.vsub(this.parent.body.angularVelocity);
    return gradient.dot(relative);
  }

  mechanics(): JointMechanics {
    const state = jointState(this.parent, this.child);
    const locked = (axis: Axis) => {
      const [min, max] = this.child.bone.limits[axis];
      return min === max;
    };
    const maximum = (axis: Axis) => this.maximumNm(axis);
    return {
      id: this.child.bone.id,
      pivot: this.bodyB.pointToWorldFrame(this.pivotB).toArray(),
      axes: {
        pitch: state.axes.pitch.toArray(),
        yaw: state.axes.yaw.toArray(),
        roll: state.axes.roll.toArray(),
      },
      locked: { pitch: locked('pitch'), yaw: locked('yaw'), roll: locked('roll') },
      maximumNm: { pitch: maximum('pitch'), yaw: maximum('yaw'), roll: maximum('roll') },
    };
  }

  read(): JointSense {
    const state = jointState(this.parent, this.child);
    const axisSense = (axis: Axis): AxisSense => {
      const [min, max] = this.child.bone.limits[axis];
      return {
        angle: state.angles[axis],
        rate: this.rate(state.gradients[axis]),
        activation: this.activation[axis],
        ligamentNm: this.ligament[axis],
        muscleNm: this.motors.get(axis)?.torqueNm() ?? 0,
        maximumNm: this.maximumNm(axis),
        locked: min === max,
      };
    };
    return {
      id: this.child.bone.id,
      axes: { pitch: axisSense('pitch'), yaw: axisSense('yaw'), roll: axisSense('roll') },
    };
  }

  drive(ligaments: boolean, powered: boolean, commands: Commands): void {
    const state = jointState(this.parent, this.child);
    for (const axis of AXES) {
      const [min, max] = this.child.bone.limits[axis];
      const gradient = state.gradients[axis];
      const angle = state.angles[axis];
      const rate = this.rate(gradient);
      const inertia = this.inertia(gradient);
      const enabled = min !== max;
      const limit = this.maximumNm(axis);
      const target = commands[this.child.bone.id]?.[axis] ?? 0;
      this.activation[axis] =
        powered && enabled ? activationStep(this.activation[axis], target, this.timestep) : 0;
      this.ligament[axis] = ligaments
        ? ligamentTorque(angle, rate, min * DEG, max * DEG, inertia)
        : 0;
      const motor = this.motors.get(axis);
      if (motor) motor.configure(gradient, this.activation[axis], limit, this.timestep);
      const torque = gradient.scale(this.ligament[axis] / KG_PER_UNIT);
      this.child.body.torque.vadd(torque, this.child.body.torque);
      this.parent.body.torque.vsub(torque, this.parent.body.torque);
    }
  }

  gap(): number {
    const a = this.bodyA.pointToWorldFrame(this.pivotA);
    const b = this.bodyB.pointToWorldFrame(this.pivotB);
    return a.distanceTo(b);
  }

  excess(): number {
    const { angles } = jointState(this.parent, this.child);
    return Math.max(
      0,
      ...AXES.map((axis) => {
        const [min, max] = this.child.bone.limits[axis];
        const value = angles[axis] / DEG;
        return Math.max(min - value, value - max);
      }),
    );
  }
}

class CollisionExclusion extends Constraint {
  constructor(a: Body, b: Body) {
    super(a, b, { collideConnected: false });
  }

  override update(): void {
    // There are no equations: the pair only suppresses adjacent proxy contacts.
  }
}

function snapshotBone(segment: Segment): PosedBone {
  const { body, bone, inverseRest, center } = segment;
  const rotation = body.quaternion.mult(inverseRest);
  const point = (p: Vec3): Vec3 =>
    body.position.vadd(rotation.vmult(vec(p).vsub(center))).toArray();
  return {
    bone,
    start: point(bone.start),
    end: point(bone.end),
    frame: [
      rotation.vmult(new Vector(1, 0, 0)).toArray(),
      rotation.vmult(new Vector(0, 1, 0)).toArray(),
      rotation.vmult(new Vector(0, 0, 1)).toArray(),
    ],
  };
}

export interface PhysicsOptions {
  readonly timestep?: number;
  readonly iterations?: number;
  readonly initialPose?: Readonly<Record<string, Angles>>;
  readonly gravity?: number;
}

// Convert the rig's world rotation matrix to a unit quaternion. This is
// initialization only; the simulator never writes a target pose during stepping.
function poseRotation(frame: PosedBone['frame']): Quaternion {
  const [a, b, c] = frame;
  const trace = a[0] + b[1] + c[2];
  let q: Quaternion;
  if (trace > 0) {
    const s = 2 * Math.sqrt(1 + trace);
    q = new Quaternion((b[2] - c[1]) / s, (c[0] - a[2]) / s, (a[1] - b[0]) / s, s / 4);
  } else if (a[0] > b[1] && a[0] > c[2]) {
    const s = 2 * Math.sqrt(1 + a[0] - b[1] - c[2]);
    q = new Quaternion(s / 4, (b[0] + a[1]) / s, (c[0] + a[2]) / s, (b[2] - c[1]) / s);
  } else if (b[1] > c[2]) {
    const s = 2 * Math.sqrt(1 + b[1] - a[0] - c[2]);
    q = new Quaternion((b[0] + a[1]) / s, s / 4, (c[1] + b[2]) / s, (c[0] - a[2]) / s);
  } else {
    const s = 2 * Math.sqrt(1 + c[2] - a[0] - b[1]);
    q = new Quaternion((c[0] + a[2]) / s, (c[1] + b[2]) / s, s / 4, (a[1] - b[0]) / s);
  }
  q.normalize();
  return q;
}

function placeSegments(
  segments: readonly Segment[],
  dropHeight: number,
  tiltDegrees: number,
  initialPose?: Readonly<Record<string, Angles>>,
): void {
  if (initialPose) {
    const posed = new Map(poseRig(initialPose).map((bone) => [bone.bone.id, bone]));
    for (const segment of segments) {
      const pose = posed.get(segment.bone.id);
      if (!pose) throw new Error('Missing starting bone');
      const rotation = poseRotation(pose.frame);
      const offset = segment.center.vsub(vec(segment.bone.start));
      segment.body.position.copy(vec(pose.start).vadd(rotation.vmult(offset)));
      segment.body.quaternion.copy(rotation.mult(segment.rest));
    }
  }

  // Apply one rigid rotation and translation, preserving every joint anchor.
  const tilt = new Quaternion().setFromAxisAngle(new Vector(1, 0, 0), tiltDegrees * DEG);
  const pivot = vec(BONES[1].start);
  let lowest = Infinity;
  for (const { body } of segments) {
    body.position.copy(pivot.vadd(tilt.vmult(body.position.vsub(pivot))));
    body.quaternion.copy(tilt.mult(body.quaternion));
    body.updateInertiaWorld(true);
    body.updateAABB();
    lowest = Math.min(lowest, body.aabb.lowerBound.z);
  }
  for (const { body } of segments) {
    body.position.z += dropHeight - lowest;
    body.aabbNeedsUpdate = true;
  }
}

function mechanicsFrame(
  segments: readonly Segment[],
  joints: readonly Joint[],
  ground: Body | null,
  equations: World['contacts'],
  tolerance: number,
): MechanicsFrame {
  const candidates: SupportPoint[] = [];
  const contacts: SupportPoint[] = [];
  const ids = new Map(segments.map((segment) => [segment.body, segment.bone.id]));
  let lowest = Infinity;
  const corners: SupportPoint[] = [];
  for (const { bone, body } of segments) {
    body.updateAABB();
    lowest = Math.min(lowest, body.aabb.lowerBound.z);
    if (!isFoot(bone.id)) continue;
    body.shapes.forEach((shape, i) => {
      if (!(shape instanceof Box)) return;
      const h = shape.halfExtents;
      for (const x of [-h.x, h.x]) {
        for (const y of [-h.y, h.y]) {
          for (const z of [-h.z, h.z]) {
            const local = body.shapeOrientations[i].vmult(new Vector(x, y, z));
            local.vadd(body.shapeOffsets[i], local);
            const position = body.pointToWorldFrame(local).toArray();
            corners.push({ id: bone.id, position, loadN: 0 });
          }
        }
      }
    });
  }
  for (const point of corners) {
    if (point.position[2] <= lowest + tolerance) candidates.push(point);
  }
  for (const equation of equations) {
    if (!equation.enabled) continue;
    const groundA = equation.bi === ground;
    if (!groundA && equation.bj !== ground) continue;
    const body = groundA ? equation.bj : equation.bi;
    const id = ids.get(body);
    if (!id) continue;
    const offset = groundA ? equation.rj : equation.ri;
    contacts.push({
      id,
      position: body.position.vadd(offset).toArray(),
      loadN: Math.max(0, equation.multiplier) * KG_PER_UNIT,
    });
  }
  return {
    bodies: segments.map(({ bone, body }) => ({
      id: bone.id,
      parent: bone.parent,
      massKg: body.mass * KG_PER_UNIT,
      center: body.position.toArray(),
      velocity: body.velocity.toArray(),
      angularSpeed: body.angularVelocity.length(),
    })),
    joints: joints.map((joint) => joint.mechanics()),
    candidates,
    contacts,
  };
}

export class PassiveRig {
  private readonly world: World;
  private readonly solver: CoulombSolver;
  private readonly ground = new Body({ mass: 0, shape: new Plane() });
  private readonly segments = VISIBLE.map(makeSegment);
  private readonly joints: Joint[] = [];
  private steps = 0;
  readonly timestep: number;
  private readonly pelvis = this.segments[0];
  private specificForce = new Vector();

  constructor(dropHeight = 0.35, tiltDegrees = 5, options: PhysicsOptions = {}) {
    this.timestep = options.timestep ?? STEP;
    if (!Number.isFinite(this.timestep) || this.timestep <= 0 || this.timestep > 1 / 120) {
      throw new Error('Invalid physics timestep');
    }
    const solver = new CoulombSolver(FRICTION);
    solver.iterations = options.iterations ?? 100;
    solver.tolerance = 1e-7;
    this.solver = solver;
    this.world = new World({
      gravity: new Vector(0, 0, -(options.gravity ?? GRAVITY)),
      solver,
      allowSleep: false,
    });
    this.world.defaultContactMaterial.friction = 0;
    this.world.defaultContactMaterial.restitution = 0.02;
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;
    this.world.defaultContactMaterial.contactEquationRelaxation = 4;
    this.world.defaultContactMaterial.frictionEquationStiffness = 1e8;
    this.world.addBody(this.ground);

    const byId = new Map(this.segments.map((segment) => [segment.bone.id, segment]));
    for (const segment of this.segments) {
      this.world.addBody(segment.body);
      const parent = segment.bone.parent === null ? undefined : byId.get(segment.bone.parent);
      if (parent) {
        const joint = new Joint(parent, segment, this.timestep);
        this.joints.push(joint);
        this.world.addConstraint(joint);
      }
    }

    // Direct connections are already excluded by Joint. Only explicitly
    // documented proximal overlaps may receive an additional exclusion.
    for (let i = 0; i < this.segments.length; i++) {
      for (let j = i + 1; j < this.segments.length; j++) {
        const a = this.segments[i];
        const b = this.segments[j];
        if (
          a.bone.parent !== b.bone.id &&
          b.bone.parent !== a.bone.id &&
          collisionExcluded(a.bone, b.bone)
        ) {
          this.world.addConstraint(new CollisionExclusion(a.body, b.body));
        }
      }
    }

    placeSegments(this.segments, dropHeight, tiltDegrees, options.initialPose);
    const profile = referenceMuscleProfile();
    for (const joint of this.joints) joint.setProfile(profile);
  }

  mechanics(tolerance = 0.005): MechanicsFrame {
    return mechanicsFrame(this.segments, this.joints, this.ground, this.world.contacts, tolerance);
  }

  contactForces() {
    return this.solver.forces.map(({ normal, tangent }) => ({
      normalN: normal * KG_PER_UNIT,
      tangentN: tangent * KG_PER_UNIT,
    }));
  }

  // Read-only diagnostics; never expose mutable engine bodies.
  invariants() {
    const momentum = new Vector();
    const angularMomentum = new Vector();
    let kineticJ = 0;
    let potentialJ = 0;
    for (const { body } of this.segments) {
      const mass = body.mass * KG_PER_UNIT;
      const linear = body.velocity.scale(mass);
      momentum.vadd(linear, momentum);
      const omega = body.quaternion.inverse().vmult(body.angularVelocity);
      const spin = body.quaternion.vmult(body.inertia.vmul(omega).scale(KG_PER_UNIT));
      angularMomentum.vadd(spin.vadd(body.position.cross(linear)), angularMomentum);
      kineticJ += 0.5 * (mass * body.velocity.lengthSquared() + spin.dot(body.angularVelocity));
      potentialJ -= mass * this.world.gravity.z * body.position.z;
    }
    return {
      momentum: momentum.toArray(),
      angularMomentum: angularMomentum.toArray(),
      energyJ: kineticJ + potentialJ,
    };
  }

  sense(): SensorFrame {
    const contacts: Record<
      string,
      { touching: boolean; groundTouching: boolean; normalLoadN: number }
    > = {};
    const ids = new Map<Body, string>();
    for (const segment of this.segments) {
      ids.set(segment.body, segment.bone.id);
      contacts[segment.bone.id] = { touching: false, groundTouching: false, normalLoadN: 0 };
    }
    for (const contact of this.world.contacts) {
      if (!contact.enabled) continue;
      const a = ids.get(contact.bi);
      const b = ids.get(contact.bj);
      if (a) contacts[a].touching = true;
      if (b) contacts[b].touching = true;
      const id = contact.bi === this.ground ? b : contact.bj === this.ground ? a : undefined;
      if (id) {
        contacts[id].groundTouching ||= contact.multiplier > 0;
        contacts[id].normalLoadN += Math.max(0, contact.multiplier) * KG_PER_UNIT;
      }
    }
    const load = (side: string): number =>
      Object.entries(contacts)
        .filter(([id]) => id.startsWith(side) && (id.endsWith('-toe') || id.endsWith('-foot')))
        .reduce((sum, [, contact]) => sum + contact.normalLoadN, 0);
    const clearance = (side: string): number => {
      let lowest = Infinity;
      for (const { bone, body } of this.segments) {
        if (bone.id.startsWith(side) && (bone.id.endsWith('-toe') || bone.id.endsWith('-foot'))) {
          body.updateAABB();
          lowest = Math.min(lowest, body.aabb.lowerBound.z);
        }
      }
      return lowest;
    };
    const orientation = this.pelvis.body.quaternion.mult(this.pelvis.inverseRest);
    const inverse = orientation.inverse();
    return {
      joints: this.joints.map((joint) => joint.read()),
      contacts,
      gravityDirection: inverse.vmult(new Vector(0, 0, -1)).toArray(),
      angularVelocity: inverse.vmult(this.pelvis.body.angularVelocity).toArray(),
      specificForce: inverse.vmult(this.specificForce).toArray(),
      leftFootLoadN: load('left-'),
      rightFootLoadN: load('right-'),
      leftFootClearanceM: clearance('left-'),
      rightFootClearanceM: clearance('right-'),
    };
  }

  step(input: ControlInput = PASSIVE): void {
    const commands = input.mode === 'reflex' ? reflexCommands(this.sense()) : input.commands;
    for (const joint of this.joints) {
      joint.drive(input.ligaments, input.mode !== 'off', commands);
    }
    const previous = this.pelvis.body.velocity.clone();
    this.world.step(this.timestep);
    this.specificForce = this.pelvis.body.velocity.vsub(previous).scale(1 / this.timestep);
    this.specificForce.z -= this.world.gravity.z;
    this.steps++;
  }

  snapshot(): PhysicsSnapshot {
    const pose = this.segments.map(snapshotBone);
    let mass = 0;
    let weightedHeight = 0;
    let penetration = 0;
    let valid = true;
    for (const { body } of this.segments) {
      mass += body.mass;
      weightedHeight += body.mass * body.position.z;
      body.updateAABB();
      penetration = Math.max(penetration, -body.aabb.lowerBound.z);
      valid &&= [
        ...body.position.toArray(),
        ...body.velocity.toArray(),
        ...body.angularVelocity.toArray(),
      ].every(Number.isFinite);
      valid &&= [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w].every(
        Number.isFinite,
      );
    }
    const contacts = new Set<Body>();
    for (const contact of this.world.contacts) {
      if (!contact.enabled || contact.multiplier <= 0) continue;
      if (contact.bi === this.ground) contacts.add(contact.bj);
      if (contact.bj === this.ground) contacts.add(contact.bi);
    }
    const jointGap = Math.max(...this.joints.map((joint) => joint.gap()));
    const angleExcess = Math.max(...this.joints.map((joint) => joint.excess()));
    const centerHeight = weightedHeight / mass;
    valid &&= [jointGap, angleExcess, centerHeight, penetration].every(Number.isFinite);
    const sensors = this.sense();
    valid &&= Object.values(sensors.contacts).every((contact) =>
      Number.isFinite(contact.normalLoadN),
    );
    valid &&= sensors.joints.every((joint) =>
      AXES.every((axis) =>
        Object.values(joint.axes[axis]).every(
          (value) => typeof value === 'boolean' || Number.isFinite(value),
        ),
      ),
    );
    valid &&= [
      ...sensors.gravityDirection,
      ...sensors.angularVelocity,
      ...sensors.specificForce,
      sensors.leftFootLoadN,
      sensors.rightFootLoadN,
      sensors.leftFootClearanceM,
      sensors.rightFootClearanceM,
    ].every(Number.isFinite);
    return {
      pose,
      seconds: this.steps * this.timestep,
      massKg: mass * KG_PER_UNIT,
      centerHeight,
      pelvisHeight: pose[0].start[2],
      groundContacts: contacts.size,
      jointGap,
      angleExcess,
      penetration,
      valid,
      sensors,
    };
  }
}

let cachedProfile: MuscleProfile | undefined;

function referenceMuscleProfile(): MuscleProfile {
  if (!cachedProfile) {
    const frames = calibrationPoses().map(({ angles, tilt }) => {
      const segments = VISIBLE.map(makeSegment);
      const byId = new Map(segments.map((segment) => [segment.bone.id, segment]));
      const joints = segments.flatMap((segment) => {
        const parent = segment.bone.parent === null ? undefined : byId.get(segment.bone.parent);
        return parent ? [new Joint(parent, segment, STEP)] : [];
      });
      placeSegments(segments, 0, tilt, angles);
      return mechanicsFrame(segments, joints, null, [], 0.005);
    });
    cachedProfile = calibrateMuscles(frames);
  }
  return cachedProfile;
}
