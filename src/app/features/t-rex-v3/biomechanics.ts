import { GRAVITY, MASS_KG } from './physical-constants';
import type { Axis, Vec3 } from './rig';

export type Point2 = readonly [number, number];

export interface BodyMechanics {
  readonly id: string;
  readonly parent: string | null;
  readonly massKg: number;
  readonly center: Vec3;
  readonly velocity: Vec3;
  readonly angularSpeed: number;
}

export interface JointMechanics {
  readonly id: string;
  readonly pivot: Vec3;
  readonly axes: Readonly<Record<Axis, Vec3>>;
  readonly maximumNm: Readonly<Record<Axis, number>>;
  readonly locked: Readonly<Record<Axis, boolean>>;
}

export interface SupportPoint {
  readonly id: string;
  readonly position: Vec3;
  readonly loadN: number;
}

export interface MechanicsFrame {
  readonly bodies: readonly BodyMechanics[];
  readonly joints: readonly JointMechanics[];
  readonly candidates: readonly SupportPoint[];
  readonly contacts: readonly SupportPoint[];
}

const AXES = ['pitch', 'yaw', 'roll'] as const;

export function isFoot(id: string): boolean {
  return id.endsWith('-toe') || id.endsWith('-foot');
}

export function massCenter(bodies: readonly BodyMechanics[]): { position: Vec3; velocity: Vec3 } {
  const mass = bodies.reduce((sum, body) => sum + body.massKg, 0);
  const average = (field: 'center' | 'velocity'): Vec3 => {
    const component = (i: number) =>
      bodies.reduce((sum, body) => sum + body.massKg * body[field][i], 0) / mass;
    return [component(0), component(1), component(2)];
  };
  return { position: average('center'), velocity: average('velocity') };
}

function turn(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function supportHull(points: readonly SupportPoint[]): Point2[] {
  const sorted: Point2[] = points
    .map((point): Point2 => [point.position[0], point.position[1]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((point, i, all) => i === 0 || Math.hypot(
      point[0] - all[i - 1][0], point[1] - all[i - 1][1],
    ) > 1e-8);
  if (sorted.length <= 2) return sorted;
  const half = (sequence: readonly Point2[]): Point2[] => {
    const result: Point2[] = [];
    for (const point of sequence) {
      while (result.length >= 2 && turn(result[result.length - 2], result[result.length - 1], point) <= 1e-10) {
        result.pop();
      }
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

export function supportMargin(hull: readonly Point2[], point: Point2): {
  margin: number;
  closest: Point2;
} {
  if (!hull.length) return { margin: -Infinity, closest: point };
  let distance = Infinity;
  let closest = hull[0];
  let inside = hull.length >= 3;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    const fraction = length2 > 0
      ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2))
      : 0;
    const candidate: Point2 = [a[0] + dx * fraction, a[1] + dy * fraction];
    const d = Math.hypot(candidate[0] - point[0], candidate[1] - point[1]);
    if (d < distance) {
      distance = d;
      closest = candidate;
    }
    inside &&= turn(a, b, point) >= -1e-9;
  }
  return { margin: inside ? distance : -distance, closest: inside ? point : closest };
}

// A nonnegative vertical-force allocation at the requested centre of pressure.
// Average all feasible pair/triple solutions; no force may pull on the floor.
export function allocateLoads(
  points: readonly SupportPoint[],
  target: Point2,
  weight: number,
): SupportPoint[] {
  if (!points.length) return [];
  const point = supportMargin(supportHull(points), target).closest;
  const xy = (i: number): Point2 => [points[i].position[0], points[i].position[1]];
  const loads = points.map(() => 0);
  let solutions = 0;
  const add = (indices: number[], weights: number[]): void => {
    if (weights.some((value) => value < -1e-7 || value > 1 + 1e-7)) return;
    solutions++;
    indices.forEach((index, i) => { loads[index] += Math.max(0, weights[i]); });
  };
  for (let i = 0; i < points.length; i++) {
    const a = xy(i);
    if (Math.hypot(point[0] - a[0], point[1] - a[1]) < 1e-8) add([i], [1]);
    for (let j = i + 1; j < points.length; j++) {
      const b = xy(j);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const d2 = dx * dx + dy * dy;
      if (d2 > 1e-12) {
        const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / d2;
        if (Math.hypot(a[0] + t * dx - point[0], a[1] + t * dy - point[1]) < 1e-7) {
          add([i, j], [1 - t, t]);
        }
      }
      for (let k = j + 1; k < points.length; k++) {
        const c = xy(k);
        const determinant = turn(a, b, c);
        if (Math.abs(determinant) < 1e-10) continue;
        const wb = turn(a, point, c) / determinant;
        const wc = turn(a, b, point) / determinant;
        add([i, j, k], [1 - wb - wc, wb, wc]);
      }
    }
  }
  if (!solutions) return [];
  const total = loads.reduce((sum, value) => sum + value, 0);
  return points.map((p, i) => ({ ...p, loadN: (loads[i] / total) * weight }));
}

export interface TorqueRequirement {
  readonly id: string;
  readonly axis: Axis;
  readonly requiredNm: number;
  readonly maximumNm: number;
  readonly utilization: number;
}

// Static inverse dynamics of each child subtree about its actual joint anchor.
// Only vertical gravity and the candidate normal reactions are included.
export function torqueRequirements(
  frame: MechanicsFrame,
  reactions: readonly SupportPoint[],
): TorqueRequirement[] {
  const byId = new Map(frame.bodies.map((body) => [body.id, body]));
  const belongs = (id: string, root: string): boolean => {
    let current: string | null = id;
    while (current !== null) {
      if (current === root) return true;
      current = byId.get(current)?.parent ?? null;
    }
    return false;
  };
  const requirements: TorqueRequirement[] = [];
  for (const joint of frame.joints) {
    let mx = 0;
    let my = 0;
    const moment = (position: Vec3, forceZ: number): void => {
      mx += (position[1] - joint.pivot[1]) * forceZ;
      my -= (position[0] - joint.pivot[0]) * forceZ;
    };
    for (const body of frame.bodies) {
      if (belongs(body.id, joint.id)) moment(body.center, -body.massKg * GRAVITY);
    }
    for (const contact of reactions) {
      if (belongs(contact.id, joint.id)) moment(contact.position, contact.loadN);
    }
    for (const axis of AXES) {
      if (joint.locked[axis]) continue;
      const direction = joint.axes[axis];
      const requiredNm = -(mx * direction[0] + my * direction[1]);
      const maximumNm = joint.maximumNm[axis];
      requirements.push({
        id: joint.id,
        axis,
        requiredNm,
        maximumNm,
        utilization: maximumNm > 0 ? Math.abs(requiredNm) / maximumNm : Infinity,
      });
    }
  }
  return requirements;
}

export function staticEquilibrium(frame: MechanicsFrame) {
  const center = massCenter(frame.bodies).position;
  const hull = supportHull(frame.candidates);
  const target: Point2 = [center[0], center[1]];
  const margin = supportMargin(hull, target).margin;
  const reactions = allocateLoads(frame.candidates, target, MASS_KG * GRAVITY);
  const requirements = torqueRequirements(frame, reactions);
  const worst = [...requirements].sort((a, b) => b.utilization - a.utilization);
  return {
    center,
    hull,
    margin,
    reactions,
    requirements,
    worst,
    residualMomentNm: Math.max(0, -margin) * MASS_KG * GRAVITY,
  };
}
