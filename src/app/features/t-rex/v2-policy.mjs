import { Vec3 } from 'cannon-es';

// Shared left/right feedback, with lateral observations reflected across the body.
export const LEG_INPUTS = 40;
export const AXIAL_INPUTS = 14;
export const POLICY_SIZE = 5 * LEG_INPUTS + 4 * AXIAL_INPUTS;
const SAGITTAL_INPUTS = 30;
const AXIAL_SAGITTAL_INPUTS = 8;
const clamp = (value, limit = 2) => Math.max(-limit, Math.min(limit, value));

export function activeParameters(mode) {
  return Array.from({ length: POLICY_SIZE }, (_, i) => {
    if (mode === 'spatial') return true;
    if (i < 5 * LEG_INPUTS) {
      return Math.floor(i / LEG_INPUTS) < 4 && i % LEG_INPUTS < SAGITTAL_INPUTS;
    }
    const index = i - 5 * LEG_INPUTS;
    return (
      Math.floor(index / AXIAL_INPUTS) % 2 === 0 && index % AXIAL_INPUTS < AXIAL_SAGITTAL_INPUTS
    );
  });
}

export function feedback(weights, offset, inputs) {
  let value = 0;
  for (let i = 0; i < inputs.length; i++) value += weights[offset + i] * clamp(inputs[i]);
  return 0.85 * Math.tanh(value);
}

export function targetsFor(rig, weights, contacts, mode) {
  const trunk = rig.trunk.body;
  const joints = rig.observeJoints();
  const feet = rig.bones.filter((bone) => bone.name.startsWith('toes')).map((bone) => bone.body);
  const up = trunk.vectorToWorldFrame(rig.up);
  const forward = trunk.vectorToWorldFrame(new Vec3(1, 0, 0));
  let mass = 0;
  let comX = 0;
  let comZ = 0;
  for (const { body } of rig.bones) {
    mass += body.mass;
    comX += body.mass * body.position.x;
    comZ += body.mass * body.position.z;
  }
  comX /= mass;
  comZ /= mass;
  const midX = (feet[0].position.x + feet[1].position.x) / 2;
  const midZ = (feet[0].position.z + feet[1].position.z) / 2;
  const sagittal = [
    1,
    up.x,
    trunk.angularVelocity.z / 4,
    trunk.velocity.x / 2,
    trunk.velocity.y / 2,
    (comX - midX) / 0.5,
  ];
  const legState = (side) =>
    joints.slice(8 + side * 4, 12 + side * 4).flatMap((joint) => [joint.angle.z, joint.rate.z / 8]);
  const targets = Array(32).fill(0);
  for (let side = 0; side < 2; side++) {
    const other = 1 - side;
    const sign = side === 0 ? -1 : 1;
    const own = contacts[side];
    const opposite = contacts[other];
    const hip = joints[8 + 4 * side];
    const otherHip = joints[8 + 4 * other];
    const inputs = [
      ...sagittal,
      ...legState(side),
      ...legState(other),
      Number(own.heel),
      Number(own.toe),
      Number(opposite.heel),
      Number(opposite.toe),
      own.load,
      opposite.load,
      (feet[side].position.x - comX) / 0.5,
      (feet[other].position.x - comX) / 0.5,
      up.z * sign,
      (trunk.angularVelocity.x * sign) / 4,
      (trunk.velocity.z * sign) / 2,
      forward.z * sign,
      (trunk.angularVelocity.y * sign) / 4,
      ((comZ - midZ) * sign) / 0.3,
      hip.angle.x * sign,
      (hip.rate.x * sign) / 8,
      otherHip.angle.x * sign,
      (otherHip.rate.x * sign) / 8,
    ];
    if (mode === 'planar') inputs.fill(0, SAGITTAL_INPUTS);
    for (let joint = 0; joint < 4; joint++) {
      targets[17 + 8 * side + 2 * joint] = feedback(weights, joint * LEG_INPUTS, inputs);
    }
    if (mode === 'spatial') {
      targets[16 + 8 * side] = sign * feedback(weights, 4 * LEG_INPUTS, inputs);
    }
  }
  for (let i = 0; i < 8; i++) {
    const { angle, rate } = joints[i];
    const inputs = [
      1,
      up.x,
      trunk.angularVelocity.z / 4,
      trunk.velocity.x / 2,
      (comX - midX) / 0.5,
      angle.z,
      rate.z / 8,
      i < 2 ? i : (i - 2) / 5,
      up.z,
      trunk.angularVelocity.x / 4,
      forward.z,
      trunk.angularVelocity.y / 4,
      angle.y,
      rate.y / 8,
    ];
    if (mode === 'planar') inputs.fill(0, AXIAL_SAGITTAL_INPUTS);
    const offset = 5 * LEG_INPUTS + (i < 2 ? 0 : 2 * AXIAL_INPUTS);
    targets[2 * i + 1] = feedback(weights, offset, inputs);
    if (mode === 'spatial') targets[2 * i] = feedback(weights, offset + AXIAL_INPUTS, inputs);
  }
  return targets;
}
