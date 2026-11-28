export type Vec3 = readonly [number, number, number];
export type Axis = 'pitch' | 'yaw' | 'roll';
export type View = 'side' | 'top';
export type Angles = Readonly<Record<Axis, number>>;
type Limits = readonly [number, number];
type Frame = readonly [Vec3, Vec3, Vec3];
type Point = readonly [number, number];

export interface Bone {
  readonly id: string;
  readonly label: string;
  readonly parent: string | null;
  readonly start: Vec3;
  readonly end: Vec3;
  readonly width: number;
  readonly height: number;
  readonly limits: Readonly<Record<Axis, Limits>>;
  readonly kind: 'bone' | 'skull' | 'jaw' | 'pelvis' | 'spine';
}

export interface PosedBone {
  readonly bone: Bone;
  readonly start: Vec3;
  readonly end: Vec3;
  readonly frame: Frame;
}

export interface Shape {
  readonly id: string;
  readonly label: string;
  readonly points: string;
  readonly details: readonly string[];
  readonly depth: number;
}

export const AXES: readonly Axis[] = ['pitch', 'yaw', 'roll'];
export const ZERO: Angles = { pitch: 0, yaw: 0, roll: 0 };
const LOCKED: Limits = [0, 0];
const IDENTITY: Frame = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function limits(pitch: Limits, yaw: Limits = LOCKED, roll: Limits = LOCKED) {
  return { pitch, yaw, roll };
}

function bone(
  id: string,
  label: string,
  parent: string | null,
  start: Vec3,
  end: Vec3,
  width: number,
  height: number,
  range: Bone['limits'],
  kind: Bone['kind'] = 'bone',
): Bone {
  return { id, label, parent, start, end, width, height, limits: range, kind };
}

const axial: Bone[] = [
  bone('root', 'Root (not drawn)', null, [0, 0, 3.1], [1, 0, 3.1], 0, 0, limits(LOCKED)),
  bone(
    'pelvis',
    'Pelvis',
    'root',
    [0, 0, 3.1],
    [0.7, 0, 3.25],
    0.45,
    0.38,
    limits([-20, 20], [-20, 20], [-15, 15]),
    'pelvis',
  ),
];

function appendChain(
  target: Bone[],
  prefix: string,
  label: string,
  parent: string,
  points: readonly Vec3[],
  widths: readonly number[],
  heights: readonly number[],
  ranges: readonly Bone['limits'][],
  kind: Bone['kind'] = 'bone',
): string {
  for (let i = 0; i < points.length - 1; i++) {
    const id = prefix + (i + 1);
    target.push(
      bone(
        id,
        label + ' ' + (i + 1),
        parent,
        points[i],
        points[i + 1],
        widths[i],
        heights[i],
        ranges[i],
        kind,
      ),
    );
    parent = id;
  }
  return parent;
}

const spineEnd = appendChain(
  axial,
  'spine-',
  'Spine',
  'pelvis',
  [
    [0.25, 0, 3.45],
    [0.82, 0, 3.53],
    [1.39, 0, 3.55],
    [1.96, 0, 3.51],
    [2.5, 0, 3.44],
  ],
  [0.22, 0.21, 0.19, 0.17],
  [0.21, 0.22, 0.2, 0.17],
  Array.from({ length: 4 }, () => limits([-3, 3], [-3, 3])),
  'spine',
);
const neckEnd = appendChain(
  axial,
  'neck-',
  'Neck',
  spineEnd,
  [
    [2.5, 0, 3.44],
    [2.76, 0, 3.59],
    [3.01, 0, 3.87],
    [3.28, 0, 4.13],
    [3.66, 0, 4.23],
  ],
  [0.17, 0.15, 0.13, 0.12],
  [0.16, 0.15, 0.13, 0.12],
  Array.from({ length: 4 }, () => limits([-15, 15], [-15, 15], [-5, 5])),
);
axial.push(
  bone(
    'head',
    'Skull',
    neckEnd,
    [3.66, 0, 4.23],
    [5.05, 0, 4.18],
    0.35,
    0.42,
    limits([-20, 20], [-20, 20], [-10, 10]),
    'skull',
  ),
  bone(
    'jaw',
    'Lower jaw',
    'head',
    [3.76, 0, 3.93],
    [5.02, 0, 3.92],
    0.26,
    0.12,
    limits([0, 45]),
    'jaw',
  ),
);
appendChain(
  axial,
  'tail-',
  'Tail',
  'pelvis',
  [
    [-0.15, 0, 3.35],
    [-0.95, 0, 3.33],
    [-1.75, 0, 3.28],
    [-2.55, 0, 3.22],
    [-3.35, 0, 3.15],
    [-4.15, 0, 3.08],
    [-4.9, 0, 3.04],
    [-5.6, 0, 3.02],
    [-6.2, 0, 3.02],
  ],
  [0.34, 0.29, 0.24, 0.2, 0.16, 0.12, 0.08, 0.04],
  [0.32, 0.28, 0.24, 0.19, 0.15, 0.11, 0.07, 0.035],
  Array.from({ length: 8 }, (_, i) =>
    i < 2 ? limits([-8, 8], [-10, 10]) : limits([-10, 10], [-15, 15]),
  ),
);

function limbs(side: 'left' | 'right'): Bone[] {
  const sign = side === 'left' ? 1 : -1;
  const name = side === 'left' ? 'Left ' : 'Right ';
  const id = (part: string) => side + '-' + part;
  const p = (x: number, y: number, z: number): Vec3 => [x, sign * y, z];
  const shoulder = p(2.02, 0.34, 3.23);
  const elbow = p(1.94, 0.4, 2.88);
  const wrist = p(2.28, 0.43, 2.79);
  const hand = p(2.43, 0.43, 2.75);
  const hip = p(0, 0.37, 3.05);
  const knee = p(0.48, 0.46, 1.95);
  const ankle = p(-0.2, 0.5, 0.86);
  const foot = p(0.12, 0.51, 0.13);
  return [
    bone(
      id('upper-arm'),
      name + 'upper arm',
      'spine-4',
      shoulder,
      elbow,
      0.065,
      0.065,
      limits([-35, 45], [-20, 20], [-10, 10]),
    ),
    bone(
      id('forearm'),
      name + 'forearm',
      id('upper-arm'),
      elbow,
      wrist,
      0.05,
      0.05,
      limits([-20, 60]),
    ),
    bone(
      id('hand'),
      name + 'hand',
      id('forearm'),
      wrist,
      hand,
      0.055,
      0.04,
      limits([-15, 25], [-10, 10]),
    ),
    bone(
      id('claws'),
      name + 'claws',
      id('hand'),
      hand,
      p(2.58, 0.43, 2.64),
      0.045,
      0.035,
      limits([0, 35]),
    ),
    bone(
      id('thigh'),
      name + 'thigh',
      'pelvis',
      hip,
      knee,
      0.15,
      0.17,
      limits([-40, 45], [-20, 20], [-20, 20]),
    ),
    bone(
      id('lower-leg'),
      name + 'lower leg',
      id('thigh'),
      knee,
      ankle,
      0.105,
      0.12,
      limits([-25, 65]),
    ),
    bone(
      id('foot'),
      name + 'foot / metatarsus',
      id('lower-leg'),
      ankle,
      foot,
      0.09,
      0.095,
      limits([-35, 35]),
    ),
    bone(
      id('inner-toe'),
      name + 'inner toe',
      id('foot'),
      foot,
      p(0.65, 0.28, 0.055),
      0.048,
      0.045,
      limits([-25, 55]),
    ),
    bone(
      id('middle-toe'),
      name + 'middle toe',
      id('foot'),
      foot,
      p(0.92, 0.51, 0.055),
      0.055,
      0.05,
      limits([-25, 55]),
    ),
    bone(
      id('outer-toe'),
      name + 'outer toe',
      id('foot'),
      foot,
      p(0.67, 0.77, 0.055),
      0.048,
      0.045,
      limits([-25, 55]),
    ),
  ];
}

export const BONES: readonly Bone[] = [...axial, ...limbs('left'), ...limbs('right')];

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(a: Vec3): Vec3 {
  return scale(a, 1 / Math.hypot(...a));
}

function transform(frame: Frame, vector: Vec3): Vec3 {
  return add(
    add(scale(frame[0], vector[0]), scale(frame[1], vector[1])),
    scale(frame[2], vector[2]),
  );
}

function restFrame(b: Bone): Frame {
  const x = unit(subtract(b.end, b.start));
  const z = unit(cross(x, [0, 1, 0]));
  return [x, cross(z, x), z];
}

export function clampAngles(b: Bone, angles: Angles): Angles {
  const clamp = (axis: Axis) => {
    const [min, max] = b.limits[axis];
    const value = Number.isFinite(angles[axis]) ? angles[axis] : 0;
    return Math.min(max, Math.max(min, value));
  };
  return { pitch: clamp('pitch'), yaw: clamp('yaw'), roll: clamp('roll') };
}

function rotateLocal(v: Vec3, angles: Angles): Vec3 {
  const [x, y, z] = v;
  const roll = (angles.roll * Math.PI) / 180;
  const pitch = (angles.pitch * Math.PI) / 180;
  const yaw = (angles.yaw * Math.PI) / 180;
  const y1 = y * Math.cos(roll) - z * Math.sin(roll);
  const z1 = y * Math.sin(roll) + z * Math.cos(roll);
  const x2 = x * Math.cos(pitch) + z1 * Math.sin(pitch);
  const z2 = -x * Math.sin(pitch) + z1 * Math.cos(pitch);
  return [
    x2 * Math.cos(yaw) - y1 * Math.sin(yaw),
    x2 * Math.sin(yaw) + y1 * Math.cos(yaw),
    z2,
  ];
}

export function poseRig(angles: Readonly<Record<string, Angles>>): readonly PosedBone[] {
  const posed = new Map<string, PosedBone>();
  for (const b of BONES) {
    const parent = b.parent === null ? undefined : posed.get(b.parent);
    const parentFrame = parent?.frame ?? IDENTITY;
    const start = parent
      ? add(parent.start, transform(parentFrame, subtract(b.start, parent.bone.start)))
      : b.start;
    const basis = restFrame(b);
    const rotation = clampAngles(b, angles[b.id] ?? ZERO);
    const axis = (v: Vec3): Vec3 => {
      const local: Vec3 = [dot(v, basis[0]), dot(v, basis[1]), dot(v, basis[2])];
      return transform(parentFrame, transform(basis, rotateLocal(local, rotation)));
    };
    const frame: Frame = [axis(IDENTITY[0]), axis(IDENTITY[1]), axis(IDENTITY[2])];
    const end = add(start, transform(frame, subtract(b.end, b.start)));
    posed.set(b.id, { bone: b, start, end, frame });
  }
  return [...posed.values()];
}

function project(point: Vec3, view: View): Point {
  return [point[0], view === 'side' ? -point[2] : -point[1]];
}

function world(p: PosedBone, rest: Vec3): Vec3 {
  return add(p.start, transform(p.frame, subtract(rest, p.bone.start)));
}

function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (sequence: Point[]) => {
    const out: Point[] = [];
    for (const point of sequence) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], point) <= 0) {
        out.pop();
      }
      out.push(point);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

function vertices(p: PosedBone): Vec3[] {
  const b = p.bone;
  const basis = restFrame(b);
  const delta = subtract(b.end, b.start);
  const skullRings = [
    [0, 0.65],
    [0.18, 1],
    [0.48, 0.88],
    [0.9, 0.62],
    [1, 0.38],
  ];
  const jawRings = [
    [0, 0.7],
    [0.25, 1],
    [0.8, 0.65],
    [1, 0.35],
  ];
  const boneRings = [
    [0, 0.85],
    [0.12, 1],
    [0.45, 0.55],
    [0.88, 0.9],
    [1, 0.7],
  ];
  const rings = b.kind === 'skull' ? skullRings : b.kind === 'jaw' ? jawRings : boneRings;
  const result: Vec3[] = [];
  for (const [along, radius] of rings) {
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      const center = add(b.start, scale(delta, along));
      const lateral = scale(basis[1], b.width * radius * Math.cos(angle));
      const vertical = scale(basis[2], b.height * radius * Math.sin(angle));
      result.push(world(p, add(add(center, lateral), vertical)));
    }
  }
  return result;
}

function formatPoints(points: readonly Point[]): string {
  return points.map(([x, y]) => x.toFixed(4) + ',' + y.toFixed(4)).join(' ');
}

function details(p: PosedBone, view: View): string[] {
  const b = p.bone;
  const line = (points: Vec3[]) =>
    formatPoints(points.map((point) => project(world(p, point), view)));
  if (b.kind === 'spine') {
    const [x, , z] = b.start;
    const rib = (side: number, offset: number): Vec3[] => [
      [x + offset, 0, z],
      [x + offset + 0.08, side * 0.48, z - 0.23],
      [x + offset + 0.22, side * 0.64, z - 0.65],
      [x + offset + 0.38, side * 0.44, z - 1.02],
      [x + offset + 0.41, side * 0.12, z - 1.14],
    ];
    return [
      line(rib(-1, 0.12)),
      line(rib(1, 0.12)),
      line(rib(-1, 0.36)),
      line(rib(1, 0.36)),
    ];
  }
  if (b.kind === 'skull') {
    const orbit = (side: number): Vec3[] => [
      [3.91, side * 0.3, 4.43],
      [4.12, side * 0.32, 4.48],
      [4.2, side * 0.3, 4.28],
      [4.05, side * 0.29, 4.17],
      [3.91, side * 0.3, 4.43],
    ];
    const opening = (side: number): Vec3[] => [
      [4.32, side * 0.24, 4.35],
      [4.7, side * 0.18, 4.32],
      [4.54, side * 0.22, 4.1],
      [4.32, side * 0.24, 4.35],
    ];
    return [line(orbit(-1)), line(orbit(1)), line(opening(-1)), line(opening(1))];
  }
  return [];
}

export function projectRig(pose: readonly PosedBone[], view: View): readonly Shape[] {
  return pose
    .filter((p) => p.bone.id !== 'root')
    .map((p) => {
      const vertices3d = vertices(p);
      const depthAxis = view === 'side' ? 1 : 2;
      return {
        id: p.bone.id,
        label: p.bone.label,
        points: formatPoints(hull(vertices3d.map((point) => project(point, view)))),
        details: details(p, view),
        depth: (p.start[depthAxis] + p.end[depthAxis]) / 2,
      };
    })
    .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
}

export function viewBox(shapes: readonly Shape[], view: View): string {
  const xs = [-6.7, 5.6];
  const ys = view === 'side' ? [-5.1, 0.5] : [-2.8, 2.8];
  for (const shape of shapes) {
    for (const line of [shape.points, ...shape.details]) {
      for (const pair of line.split(' ')) {
        const [x, y] = pair.split(',').map(Number);
        xs.push(x - 0.25, x + 0.25);
        ys.push(y - 0.25, y + 0.25);
      }
    }
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return [minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY].join(' ');
}
