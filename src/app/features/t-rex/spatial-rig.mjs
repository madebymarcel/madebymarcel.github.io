import {
  Body,
  Box,
  ConeTwistConstraint,
  GSSolver,
  HingeConstraint,
  LockConstraint,
  Plane,
  Vec3,
  World,
} from 'cannon-es';

const vec = (x, y, z) => new Vec3(x, y, z);
const forward = vec(1, 0, 0);
const up = vec(0, 1, 0);
const dt = 1 / 120;

// Forward X, height Y, animal's right Z. Each shape's long axis is local X.
export function createRig({
  locked = false,
  lateralVelocity = 0,
  friction = 0.85,
  selfCollision = false,
} = {}) {
  const world = new World({ gravity: vec(0, -9.81, 0) });
  world.solver = new GSSolver();
  world.solver.iterations = 22;
  world.defaultContactMaterial.friction = friction;
  const ground = new Body({ mass: 0, shape: new Plane(), collisionFilterGroup: 2 });
  ground.quaternion.setFromAxisAngle(forward, -Math.PI / 2);
  world.addBody(ground);
  const bones = [];
  const joints = [];

  function bone(name, start, end, width, depth, mass) {
    const direction = end.vsub(start);
    const length = direction.normalize();
    const leg = /^(thigh|shin|metatarsus|toes)/.test(name);
    const group = leg ? (name.endsWith('-1') ? 4 : 8) : /^tail-[2-5]$/.test(name) ? 16 : 1;
    // Only separated collision groups interact. Adjacent anatomy shares overlapping boxes.
    const mask = group === 4 ? 8 | 16 : group === 8 ? 4 | 16 : group === 16 ? 4 | 8 : 0;
    const body = new Body({
      mass,
      shape: new Box(vec(length / 2, depth / 2, width / 2)),
      collisionFilterGroup: group,
      collisionFilterMask: 2 | (selfCollision ? mask : 0),
    });
    body.position.copy(start.vadd(end).scale(0.5));
    body.quaternion.setFromVectors(forward, direction);
    body.velocity.z = lateralVelocity;
    world.addBody(body);
    const segment = { name, body, width, depth, length };
    bones.push(segment);
    return segment;
  }

  function join(parent, child, anchor, limit, torque, immobile = false) {
    const a = parent.body,
      b = child.body;
    const axis = b.vectorToWorldFrame(forward);
    const constraint = immobile
      ? new LockConstraint(a, b)
      : new ConeTwistConstraint(a, b, {
          pivotA: a.pointToLocalFrame(anchor),
          pivotB: b.pointToLocalFrame(anchor),
          axisA: a.vectorToLocalFrame(axis),
          axisB: b.vectorToLocalFrame(axis),
          angle: limit,
          twistAngle: 0.12,
          collideConnected: false,
        });
    if (!immobile) {
      // Both twist references must agree in world space in the initial bent pose.
      const normal = vec(0, 0, 1);
      const refA = a.vectorToLocalFrame(normal),
        refB = b.vectorToLocalFrame(normal);
      const updateCone = constraint.update.bind(constraint);
      constraint.update = () => {
        updateCone();
        a.vectorToWorldFrame(refA, constraint.twistEquation.axisA);
        b.vectorToWorldFrame(refB, constraint.twistEquation.axisB);
      };
    }
    if (/^(shin|metatarsus|toes)/.test(child.name)) {
      const lateral = vec(0, 0, 1);
      const hinge = new HingeConstraint(a, b, {
        pivotA: a.pointToLocalFrame(anchor),
        pivotB: b.pointToLocalFrame(anchor),
        axisA: a.vectorToLocalFrame(lateral),
        axisB: b.vectorToLocalFrame(lateral),
        collideConnected: false,
      });
      // Keep the cone travel stop and replace its ball joint with a knee-like pin.
      hinge.equations.push(constraint.coneEquation);
      const update = hinge.update.bind(hinge);
      hinge.update = () => {
        update();
        constraint.update();
      };
      world.addConstraint(hinge);
    } else world.addConstraint(constraint);
    joints.push({ name: child.name, a, b, torque, immobile });
  }

  const root = vec(-0.38, 1.05, 0),
    shoulders = vec(0.53, 1.12, 0);
  const trunk = bone('trunk', root, shoulders, 0.46, 0.43, 5.8);
  const nape = vec(0.84, 1.27, 0);
  const neck = bone('neck', shoulders, nape, 0.23, 0.22, 0.65);
  join(trunk, neck, shoulders, 0.32, 9);
  join(neck, bone('skull', nape, vec(1.31, 1.22, 0), 0.28, 0.25, 1), nape, 0.28, 5);
  let parent = trunk,
    base = root;
  for (const [index, width] of [0.33, 0.27, 0.21, 0.15, 0.1, 0.055].entries()) {
    const tip = base.vadd(vec(-0.34, 0.025, 0));
    const tail = bone('tail-' + index, base, tip, width, width * 0.88, 12 * width ** 2);
    join(parent, tail, base, 0.32, 1100 * width ** 3, locked);
    parent = tail;
    base = tip;
  }
  for (const side of [-1, 1]) {
    const z = side * 0.195;
    const hip = vec(-0.09, 1.04, z),
      knee = vec(0.12, 0.68, z),
      hock = vec(-0.29, 0.34, z),
      ball = vec(-0.1, 0.045, z);
    const thigh = bone('thigh' + side, hip, knee, 0.15, 0.18, 0.86);
    const shin = bone('shin' + side, knee, hock, 0.1, 0.11, 0.36);
    const met = bone('metatarsus' + side, hock, ball, 0.075, 0.08, 0.19);
    const toes = bone('toes' + side, ball, vec(0.22, 0.045, z), 0.15, 0.08, 0.11);
    join(trunk, thigh, hip, 0.85, 90);
    join(thigh, shin, knee, 0.85, 33);
    join(shin, met, hock, 0.7, 18);
    join(met, toes, ball, 0.65, 9);
  }

  const requested = vec(0, 0, 0);
  const couple = vec(0, 0, 0);
  function step(actions = [], respectHinges = false) {
    for (const [i, joint] of joints.entries()) {
      if (joint.immobile) continue;
      const hinge = /^(shin|metatarsus|toes)/.test(joint.name);
      const lateral = respectHinges && hinge ? 0 : actions[2 * i] || 0;
      const hip = joint.name.startsWith('thigh');
      requested.set(hip ? lateral : 0, hip ? 0 : lateral, actions[2 * i + 1] || 0);
      requested.scale(joint.torque / Math.max(1, requested.length()), requested);
      joint.a.vectorToWorldFrame(requested, couple);
      joint.b.torque.vadd(couple, joint.b.torque);
      joint.a.torque.vsub(couple, joint.a.torque);
    }
    world.step(dt);
  }

  function frame() {
    return bones.map(({ name, width, depth, length, body }) => {
      // Local outlines share the collision body's pose. Digits move as a grouped forefoot.
      const contour = name.startsWith('toes')
        ? [
            [-0.52, -0.26],
            [-0.12, -0.45],
            [0.38, -0.8],
            [0.12, -0.19],
            [0.56, 0],
            [0.12, 0.19],
            [0.38, 0.8],
            [-0.12, 0.45],
            [-0.52, 0.26],
          ]
        : name === 'skull'
          ? [
              [-0.55, -0.31],
              [-0.32, -0.58],
              [0.24, -0.4],
              [0.52, -0.23],
              [0.52, 0.23],
              [0.24, 0.4],
              [-0.32, 0.58],
              [-0.55, 0.31],
            ]
          : [
              [-0.56, -0.31],
              [-0.28, -0.53],
              [0.17, -0.47],
              [0.55, -0.27],
              [0.56, 0.23],
              [0.17, 0.47],
              [-0.28, 0.53],
              [-0.56, 0.31],
            ];
      // Local z reverses on segments pointing backward; quaternions handle that rotation.
      const outline = contour.map(([x, z]) =>
        body.pointToWorldFrame(vec(x * length, 0, z * width)),
      );
      return {
        outline,
        eyes:
          name === 'skull'
            ? [-1, 1].map((k) =>
                body.pointToWorldFrame(vec(-0.18 * length, depth * 0.3, k * width * 0.35)),
              )
            : [],
        name,
        width,
        depth,
        start: body.pointToWorldFrame(vec(-length / 2, 0, 0)),
        end: body.pointToWorldFrame(vec(length / 2, 0, 0)),
      };
    });
  }
  return { world, ground, bones, joints, trunk, frame, step, dt, up };
}
