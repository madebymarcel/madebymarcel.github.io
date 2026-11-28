import { describe, expect, it } from 'vitest';
import { activationStep, ligamentTorque, muscleTorque, reflexCommands } from './neuromuscular';
import { PassiveRig, STEP } from './passive-physics';

describe('T. rex V3 neuromuscular system', () => {
  it('produces no elastic torque at rest and opposes displacement and velocity', () => {
    expect(ligamentTorque(0, 0, -1, 1, 10)).toBe(0);
    expect(ligamentTorque(0.8, 0, -1, 1, 10)).toBeLessThan(0);
    expect(ligamentTorque(-0.8, 0, -1, 1, 10)).toBeGreaterThan(0);
    expect(ligamentTorque(0, 1, -1, 1, 10)).toBeLessThan(0);
    expect(ligamentTorque(0.8, 2, 0, 0, 10)).toBe(0);
  });

  it('bounds activation and muscle output and reduces torque at high contraction speed', () => {
    const activation = activationStep(0, 2, STEP);
    expect(activation).toBeGreaterThan(0);
    expect(activation).toBeLessThan(1);
    expect(muscleTorque(2, 0, 100)).toBe(100);
    expect(muscleTorque(-2, 0, 100)).toBe(-100);
    expect(muscleTorque(1, 8, 100)).toBe(0);
    expect(muscleTorque(1, 4, 100)).toBe(50);
  });

  it('keeps powered joints off by default and exposes the actual sensor frame', () => {
    const rig = new PassiveRig(2, 0);
    rig.step();
    const state = rig.snapshot();
    expect(state.sensors.joints).toHaveLength(38);
    expect(Object.keys(state.sensors.contacts)).toHaveLength(39);
    expect(state.sensors.leftFootLoadN).toBe(0);
    expect(state.sensors.rightFootLoadN).toBe(0);
    expect(state.sensors.gravityDirection[2]).toBeCloseTo(-1, 2);
    for (const joint of state.sensors.joints) {
      expect(joint.axes.pitch.muscleNm).toBe(0);
      expect(joint.axes.pitch.ligamentNm).toBe(0);
    }
  });

  it('applies bounded manual muscle torque and rejects a locked axis', () => {
    const rig = new PassiveRig(2, 0);
    const id = 'left-lower-leg';
    const before = rig.sense().joints.find((joint) => joint.id === id)!;
    for (let i = 0; i < 6; i++) {
      rig.step({ ligaments: false, mode: 'manual', commands: { [id]: { pitch: 1, yaw: 1 } } });
    }
    const state = rig.snapshot();
    const joint = state.sensors.joints.find((candidate) => candidate.id === id)!;
    expect(state.valid).toBe(true);
    expect(joint.axes.pitch.activation).toBeGreaterThan(0);
    expect(joint.axes.pitch.muscleNm).toBeGreaterThanOrEqual(0);
    expect(joint.axes.pitch.muscleNm).toBeLessThanOrEqual(joint.axes.pitch.maximumNm);
    expect(joint.axes.yaw.activation).toBe(0);
    expect(joint.axes.yaw.muscleNm).toBe(0);
    expect(Math.abs(joint.axes.pitch.angle - before.axes.pitch.angle)).toBeGreaterThan(0.0001);
    rig.step();
    expect(rig.sense().joints.find((candidate) => candidate.id === id)!.axes.pitch.muscleNm).toBe(0);
  });

  it('maps sensory displacement to an opposing reflex command', () => {
    const rig = new PassiveRig(2, 0);
    const sensors = rig.sense();
    const knee = sensors.joints.find((joint) => joint.id === 'left-lower-leg')!;
    const modified = {
      ...sensors,
      joints: [
        {
          ...knee,
          axes: { ...knee.axes, pitch: { ...knee.axes.pitch, angle: 0.3, rate: 0 } },
        },
      ],
    };
    const commands = reflexCommands(modified);
    expect(commands[knee.id]?.pitch).toBeLessThan(0);
    expect(commands[knee.id]?.yaw).toBe(0);
  });
});
