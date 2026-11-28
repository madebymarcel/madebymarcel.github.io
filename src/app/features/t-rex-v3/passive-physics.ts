import {
  Body,
  Box,
  Constraint,
  Equation,
  GSSolver,
  Plane,
  PointToPointConstraint,
  Quaternion,
  Vec3 as Vector,
  World,
} from 'cannon-es';
import { AXES, BONES } from './rig';
import type { Axis, Bone, PosedBone, Vec3 } from './rig';

export const STEP = 1 / 120;
export const GRAVITY = 9.81;
export const MASS_KG = 8000;
const KG_PER_UNIT = 100;
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
  const body = new Body({ mass, linearDamping: 0.08, angularDamping: 0.35 });
  const segment = { bone, body, rest, inverseRest, center };
  body.addShape(
    new Box(new Vector(direction.length() / 2, bone.width, bone.height)),
    localPoint(segment, midpoint),
  );
  if (bone.kind === 'spine') {
    const ribs = midpoint.vadd(new Vector(0, 0, -0.61));
    body.addShape(
      new Box(new Vector(direction.length() * 0.47, 0.54, 0.49)),
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
  ) {
    super(parent, child, locked ? -MAX_IMPULSE : 0, MAX_IMPULSE);
    this.setSpookParams(1e8, 4, STEP);
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

class Joint extends PointToPointConstraint {
  private readonly stops: { axis: Axis; equation: AngularStop }[] = [];

  constructor(
    private readonly parent: Segment,
    private readonly child: Segment,
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
      equation.setSpookParams(1e8, 4, STEP);
    }
    for (const axis of AXES) {
      const [min, max] = child.bone.limits[axis];
      const locked = min === max;
      const lower = new AngularStop(parent.body, child.body, 1, min * DEG, locked);
      this.stops.push({ axis, equation: lower });
      this.equations.push(lower);
      if (!locked) {
        const upper = new AngularStop(parent.body, child.body, -1, max * DEG, false);
        this.stops.push({ axis, equation: upper });
        this.equations.push(upper);
      }
    }
  }

  override update(): void {
    super.update();
    const state = jointState(this.parent, this.child);
    for (const { axis, equation } of this.stops) {
      equation.updateStop(state.angles[axis], state.gradients[axis]);
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

function adjacent(a: Bone, b: Bone): boolean {
  return a.parent === b.id || b.parent === a.id;
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

export class PassiveRig {
  private readonly world: World;
  private readonly ground = new Body({ mass: 0, shape: new Plane() });
  private readonly segments = VISIBLE.map(makeSegment);
  private readonly joints: Joint[] = [];
  private steps = 0;

  constructor(dropHeight = 0.35, tiltDegrees = 5) {
    const solver = new GSSolver();
    solver.iterations = 100;
    solver.tolerance = 1e-7;
    this.world = new World({ gravity: new Vector(0, 0, -GRAVITY), solver, allowSleep: false });
    this.world.defaultContactMaterial.friction = 0.65;
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
        const joint = new Joint(parent, segment);
        this.joints.push(joint);
        this.world.addConstraint(joint);
      }
    }

    // Neutral proxies intentionally overlap at joints and in the rib cage.
    // Suppress these pairs, but keep other body-body collisions enabled.
    for (const segment of this.segments) segment.body.updateAABB();
    for (let i = 0; i < this.segments.length; i++) {
      for (let j = i + 1; j < this.segments.length; j++) {
        const a = this.segments[i];
        const b = this.segments[j];
        if (!adjacent(a.bone, b.bone) && a.body.aabb.overlaps(b.body.aabb)) {
          this.world.addConstraint(new CollisionExclusion(a.body, b.body));
        }
      }
    }

    // Apply one rigid rotation and translation to the entire neutral rig,
    // preserving every joint anchor and its neutral relative orientation.
    const tilt = new Quaternion().setFromAxisAngle(new Vector(1, 0, 0), tiltDegrees * DEG);
    const pivot = vec(BONES[1].start);
    let lowest = Infinity;
    for (const { body } of this.segments) {
      body.position.copy(pivot.vadd(tilt.vmult(body.position.vsub(pivot))));
      body.quaternion.copy(tilt.mult(body.quaternion));
      body.updateInertiaWorld(true);
      body.updateAABB();
      lowest = Math.min(lowest, body.aabb.lowerBound.z);
    }
    for (const { body } of this.segments) {
      body.position.z += dropHeight - lowest;
      body.aabbNeedsUpdate = true;
    }
  }

  step(): void {
    this.world.step(STEP);
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
      valid &&= [...body.position.toArray(), ...body.velocity.toArray()].every(Number.isFinite);
      valid &&= [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w].every(
        Number.isFinite,
      );
    }
    const contacts = new Set<Body>();
    for (const contact of this.world.contacts) {
      if (contact.bi === this.ground) contacts.add(contact.bj);
      if (contact.bj === this.ground) contacts.add(contact.bi);
    }
    const jointGap = Math.max(...this.joints.map((joint) => joint.gap()));
    const angleExcess = Math.max(...this.joints.map((joint) => joint.excess()));
    const centerHeight = weightedHeight / mass;
    valid &&= [jointGap, angleExcess, centerHeight, penetration].every(Number.isFinite);
    return {
      pose,
      seconds: this.steps * STEP,
      massKg: mass * KG_PER_UNIT,
      centerHeight,
      pelvisHeight: pose[0].start[2],
      groundContacts: contacts.size,
      jointGap,
      angleExcess,
      penetration,
      valid,
    };
  }
}
