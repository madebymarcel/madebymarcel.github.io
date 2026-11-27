import { Quaternion, RotationalMotorEquation, Vec3 } from 'cannon-es';
import { createRig } from './spatial-rig.mjs';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const CONTROL_STEPS = 4;
export const LEG_INPUTS = 28;
export const AXIAL_INPUTS = 10;
export const POLICY_SIZE = 5 * LEG_INPUTS + 2 * AXIAL_INPUTS;
export const neutralPolicy = () => Array(POLICY_SIZE).fill(0);

// Same bodies, masses, collision shapes and physical joints as the spatial rig.
// Add solver motors rather than applying explicit high-gain torques every tick.
export function createServoRig(options = {}) {
  const rig = createRig({ ...options, selfCollision: true });
  const motors = rig.joints.map((joint) => {
    const { a, b, name, torque } = joint;
    const restInverse = a.quaternion.inverse().mult(b.quaternion).inverse();
    const constraint = rig.world.constraints.find((c) => c.bodyA === a && c.bodyB === b);
    const hip = name.startsWith('thigh');
    const hinge = /^(shin|metatarsus|toes)/.test(name);
    const axes = hinge ? ['z'] : [hip ? 'x' : 'y', 'z'];
    const limit = name.startsWith('thigh')
      ? 0.72
      : name.startsWith('shin')
        ? 0.72
        : name.startsWith('metatarsus')
          ? 0.56
          : name.startsWith('toes')
            ? 0.52
            : name === 'skull'
              ? 0.19
              : 0.23;
    const items = axes.map((axis) => {
      // GSSolver bounds the impulse lambda, not the torque in N m.
      const maxImpulse = (torque * rig.dt) / Math.sqrt(axes.length);
      const motor = new RotationalMotorEquation(a, b, maxImpulse);
      motor.setSpookParams(1e7, 4, rig.dt);
      motor.enabled = !joint.immobile;
      constraint.equations.push(motor);
      const local = new Vec3(Number(axis === 'x'), Number(axis === 'y'), Number(axis === 'z'));
      return { axis, motor, local, limit: axis === 'x' ? 0.1 : limit };
    });
    const update = constraint.update.bind(constraint);
    constraint.update = () => {
      update();
      for (const { motor, local } of items) {
        a.vectorToWorldFrame(local, motor.axisA);
        motor.axisB.copy(motor.axisA);
      }
    };
    return { joint, restInverse, items };
  });

  // A small stance split breaks symmetry without changing anatomy or separating joint anchors.
  if (options.startSplit) {
    const axis = new Vec3(0, 0, 1);
    function rotateAbout(body, pivot, rotation) {
      body.position.copy(pivot.vadd(rotation.vmult(body.position.vsub(pivot))));
      body.quaternion.copy(rotation.mult(body.quaternion));
      body.aabbNeedsUpdate = true;
    }
    for (let side = 0; side < 2; side++) {
      const index = 8 + 4 * side;
      const hip = rig.joints[index];
      const hipConstraint = rig.world.constraints.find(
        (c) => c.bodyA === hip.a && c.bodyB === hip.b,
      );
      const pivot = hip.a.pointToWorldFrame(hipConstraint.pivotA);
      const rotation = new Quaternion().setFromAxisAngle(
        axis,
        (side === 0 ? 1 : -1) * options.startSplit,
      );
      for (let i = index; i < index + 4; i++) rotateAbout(rig.joints[i].b, pivot, rotation);
      const toe = rig.joints[index + 3];
      const toeConstraint = rig.world.constraints.find(
        (c) => c.bodyA === toe.a && c.bodyB === toe.b,
      );
      rotateAbout(toe.b, toe.b.pointToWorldFrame(toeConstraint.pivotB), rotation.inverse());
    }
    const feet = rig.bones.filter((bone) => bone.name.startsWith('toes')).map((bone) => bone.body);
    for (const foot of feet) foot.updateAABB();
    const offset = 0.005 - Math.min(...feet.map((foot) => foot.aabb.lowerBound.y));
    for (const { body } of rig.bones) {
      body.position.y += offset;
      body.aabbNeedsUpdate = true;
    }
  }

  function observeJoints() {
    return motors.map(({ joint: { a, b }, restInverse }) => {
      const q = a.quaternion.inverse().mult(b.quaternion).mult(restInverse);
      const signed = (axis) => {
        const angle = 2 * Math.atan2(q[axis], q.w);
        return Math.atan2(Math.sin(angle), Math.cos(angle));
      };
      return {
        angle: { x: signed('x'), y: signed('y'), z: signed('z') },
        rate: a.vectorToLocalFrame(b.angularVelocity.vsub(a.angularVelocity)),
      };
    });
  }

  function drive(targets) {
    const state = observeJoints();
    for (const [index, { items }] of motors.entries()) {
      for (const { axis, motor, limit } of items) {
        const target = clamp(targets[2 * index + Number(axis === 'z')] ?? 0, -limit, limit);
        const desired = clamp(14 * (target - state[index].angle[axis]), -8, 8);
        // Cannon's equation is parent velocity minus child velocity.
        motor.targetVelocity = -desired;
      }
    }
    rig.world.step(rig.dt);
  }

  return { ...rig, motors, observeJoints, drive };
}

function dot(policy, offset, inputs) {
  let sum = 0;
  for (let i = 0; i < inputs.length; i++) sum += policy[offset + i] * inputs[i];
  return Math.tanh(sum);
}

// A shared bilateral feedback policy, with own-leg and opposite-leg observations swapped.
// No phase clock, animated pose sequence, or externally applied push.
export function targetsFor(rig, policy, contacts, speed, heading, loads) {
  const trunk = rig.trunk.body;
  const vertical = trunk.vectorToWorldFrame(rig.up);
  const joints = rig.observeJoints();
  const feet = rig.bones.filter((bone) => bone.name.startsWith('toes')).map((bone) => bone.body);
  const totalMass = rig.bones.reduce((sum, bone) => sum + bone.body.mass, 0);
  let comX = 0;
  let comZ = 0;
  for (const { body } of rig.bones) {
    comX += body.mass * body.position.x;
    comZ += body.mass * body.position.z;
  }
  const support = Number(contacts[0]) + Number(contacts[1]);
  const centroid = (axis) =>
    support
      ? (feet[0].position[axis] * Number(contacts[0]) +
          feet[1].position[axis] * Number(contacts[1])) /
        support
      : (feet[0].position[axis] + feet[1].position[axis]) / 2;
  const deltaX = comX / totalMass - centroid('x');
  const deltaZ = comZ / totalMass - centroid('z');
  const yaw = Math.atan2(
    2 * (trunk.quaternion.x * trunk.quaternion.z - trunk.quaternion.w * trunk.quaternion.y),
    1 - 2 * (trunk.quaternion.y ** 2 + trunk.quaternion.z ** 2),
  );
  const out = Array(32).fill(0);
  const cap = (value) => clamp(value, -2, 2);
  for (let side = 0; side < 2; side++) {
    const own = 8 + side * 4;
    const other = 8 + (1 - side) * 4;
    const mirror = side === 0 ? 1 : -1;
    const inputs = [
      1,
      vertical.x,
      vertical.z * mirror,
      trunk.angularVelocity.z / 5,
      (trunk.angularVelocity.x * mirror) / 5,
      trunk.velocity.x / 2,
      (trunk.velocity.z * mirror) / 2,
      deltaX * 2,
      deltaZ * 2 * mirror,
      trunk.position.y - 1,
      speed - trunk.velocity.x,
      Math.sin(heading - yaw) * mirror,
      Number(contacts[side]),
      Number(contacts[1 - side]),
      loads[side],
      loads[1 - side],
      ...joints.slice(own, own + 4).flatMap((j) => [j.angle.z, j.rate.z / 10]),
      ...joints.slice(other, other + 2).map((j) => j.angle.z),
      joints[own].angle.x * mirror,
      (joints[own].rate.x * mirror) / 10,
    ].map(cap);
    for (let i = 0; i < 4; i++) {
      out[2 * (own + i) + 1] = [0.72, 0.72, 0.56, 0.52][i] * dot(policy, i * LEG_INPUTS, inputs);
    }
    out[2 * own] = 0.1 * mirror * dot(policy, 4 * LEG_INPUTS, inputs);
  }
  // Shared local feedback for the neck, skull and six independently driven tail links.
  // Their targets depend on sensed body and joint state, not a predetermined wag.
  for (let i = 0; i < 8; i++) {
    const { angle, rate } = joints[i];
    const inputs = [
      1,
      vertical.x,
      vertical.z,
      trunk.angularVelocity.z / 5,
      trunk.angularVelocity.x / 5,
      deltaX * 2,
      deltaZ * 2,
      angle.y,
      rate.y / 10,
      angle.z,
    ].map(cap);
    out[2 * i] = 0.17 * dot(policy, 5 * LEG_INPUTS, inputs);
    inputs[7] = angle.z;
    inputs[8] = rate.z / 10;
    inputs[9] = angle.y;
    out[2 * i + 1] = 0.19 * dot(policy, 5 * LEG_INPUTS + AXIAL_INPUTS, inputs);
  }
  return out;
}
