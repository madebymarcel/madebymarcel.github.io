import { Quaternion, RotationalMotorEquation, Vec3 } from 'cannon-es';
import { createRig } from './spatial-rig.mjs';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
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
      ? 0.92
      : name.startsWith('shin')
        ? 0.92
        : name.startsWith('metatarsus')
          ? 0.82
          : name.startsWith('toes')
            ? 0.7
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
      return { axis, motor, local, limit: axis === 'x' ? 0.32 : limit };
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
