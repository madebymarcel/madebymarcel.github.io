import { describe, expect, it } from 'vitest';
import { staticEquilibrium, torqueRequirements } from './biomechanics';
import { BALANCED_STANCE, LOAD_RESERVE } from './muscle-profile';
import { GRAVITY, MASS_KG, PassiveRig, STEP } from './passive-physics';

describe('V3 load-calibrated actuator system', () => {
  it('provides fixed per-axis capacities with a reserve over reference load cases', () => {
    const rig = new PassiveRig(0, 0, { initialPose: BALANCED_STANCE });
    const frame = rig.mechanics();
    const estimate = staticEquilibrium(frame);
    expect(estimate.margin).toBeGreaterThan(0.005);
    expect(estimate.worst[0].utilization).toBeLessThanOrEqual(1 / LOAD_RESERVE + 1e-8);
    for (const joint of frame.joints) {
      for (const axis of ['pitch', 'yaw', 'roll'] as const) {
        expect(Number.isFinite(joint.maximumNm[axis])).toBe(true);
        if (joint.locked[axis]) expect(joint.maximumNm[axis]).toBe(0);
      }
    }
    for (const point of frame.candidates) {
      const reactions = [{ ...point, loadN: MASS_KG * GRAVITY }];
      const requirements = torqueRequirements(frame, reactions);
      expect(requirements.every((entry) => entry.utilization <= 1 / LOAD_RESERVE + 1e-8)).toBe(
        true,
      );
    }

  });

  it('does not vary torque capacity with pose, timestep or instantaneous inertia', () => {
    const a = new PassiveRig(2, 0);
    const b = new PassiveRig(2, 5, { initialPose: BALANCED_STANCE, timestep: 1 / 120 });
    const before = a.mechanics().joints.map((joint) => joint.maximumNm);
    expect(b.mechanics().joints.map((joint) => joint.maximumNm)).toEqual(before);
    a.step({ ligaments: false, mode: 'manual', commands: { 'neck-2': { pitch: -1 } } });
    expect(a.mechanics().joints.map((joint) => joint.maximumNm)).toEqual(before);
  });

  it('keeps solved torque within the activated capacity at both integration rates', () => {
    for (const timestep of [STEP, 1 / 120]) {
      const rig = new PassiveRig(100, 0, { timestep });
      let peak = 0;
      for (let i = 0; i < Math.round(0.25 / timestep); i++) {
        rig.step({
          ligaments: false,
          mode: 'manual',
          commands: { 'neck-2': { pitch: -0.7 }, 'left-lower-leg': { pitch: 1, yaw: 1 } },
        });
        const state = rig.sense();
        const neck = state.joints.find((joint) => joint.id === 'neck-2')!.axes.pitch;
        const knee = state.joints.find((joint) => joint.id === 'left-lower-leg')!;
        expect(neck.muscleNm).toBeLessThanOrEqual(1e-8);
        expect(Math.abs(neck.muscleNm)).toBeLessThanOrEqual(
          Math.abs(neck.activation) * neck.maximumNm + 1e-6,
        );
        expect(knee.axes.yaw.muscleNm).toBe(0);
        peak = Math.max(peak, Math.abs(neck.muscleNm));
      }
      expect(peak).toBeGreaterThan(100);
      expect(rig.snapshot().valid).toBe(true);
      rig.step();
      const neck = rig.sense().joints.find((joint) => joint.id === 'neck-2')!.axes.pitch;
      expect(neck.muscleNm).toBe(0);
      expect(neck.activation).toBe(0);
    }
  });
});
