import { describe, expect, it } from 'vitest';
import {
  allocateLoads,
  staticEquilibrium,
  supportHull,
  supportMargin,
  torqueRequirements,
} from './biomechanics';
import type { SupportPoint } from './biomechanics';
import { BALANCED_STANCE, calibrationPoses, LOAD_RESERVE } from './muscle-profile';
import { GRAVITY, MASS_KG, PassiveRig, STEP } from './passive-physics';
import { poseRig } from './rig';
import { ligamentTorque } from './neuromuscular';

describe('V3 biomechanics', () => {
  it('allocates nonnegative ground forces with the correct total and centre of pressure', () => {
    const points: SupportPoint[] = [
      { id: 'a', position: [0, 0, 0], loadN: 0 },
      { id: 'b', position: [2, 0, 0], loadN: 0 },
      { id: 'c', position: [2, 2, 0], loadN: 0 },
      { id: 'd', position: [0, 2, 0], loadN: 0 },
    ];
    const hull = supportHull(points);
    expect(supportMargin(hull, [1, 1]).margin).toBeCloseTo(1);
    expect(supportMargin(hull, [3, 1]).margin).toBeCloseTo(-1);
    const loads = allocateLoads(points, [0.5, 1], 100);
    expect(loads.every((point) => point.loadN >= 0)).toBe(true);
    expect(loads.reduce((sum, point) => sum + point.loadN, 0)).toBeCloseTo(100);
    expect(loads.reduce((sum, point) => sum + point.loadN * point.position[0], 0)).toBeCloseTo(50);
    expect(loads.reduce((sum, point) => sum + point.loadN * point.position[1], 0)).toBeCloseTo(100);
  });

  it('initializes a non-neutral pose without joint separation or forbidden angles', () => {
    const rig = new PassiveRig(0.02, 0, { initialPose: BALANCED_STANCE });
    const state = rig.snapshot();
    const expected = poseRig(BALANCED_STANCE);
    expect(state.jointGap).toBeLessThan(1e-7);
    expect(state.angleExcess).toBeLessThan(1e-6);
    for (const actual of state.pose) {
      const target = expected.find((p) => p.bone.id === actual.bone.id)!;
      for (let i = 0; i < 3; i++) {
        expect(actual.end[i] - actual.start[i]).toBeCloseTo(target.end[i] - target.start[i], 6);
      }
    }
    const equilibrium = staticEquilibrium(rig.mechanics());
    expect(equilibrium.margin).toBeGreaterThan(0.005);
    expect(equilibrium.worst[0].utilization).toBeLessThanOrEqual(1 / LOAD_RESERVE + 1e-8);
  });

  it('reserves torque across all representative calibration poses and candidate loads', () => {
    let maximum = 0;
    const poses = calibrationPoses();
    for (const { angles, tilt } of poses) {
      const rig = new PassiveRig(0, tilt, { initialPose: angles });
      const frame = rig.mechanics();
      const scenarios = [
        staticEquilibrium(frame).reactions,
        [],
        ...frame.candidates.map((point) => [{ ...point, loadN: MASS_KG * GRAVITY }]),
      ];
      for (const reactions of scenarios) {
        for (const entry of torqueRequirements(frame, reactions)) {
          maximum = Math.max(maximum, entry.utilization);
        }
      }
    }
    console.info('V3_CALIBRATION ' + JSON.stringify({ poses: poses.length, maximum }));
    expect(maximum).toBeLessThanOrEqual(1 / LOAD_RESERVE + 1e-8);
  }, 30000);

  it('dissipates energy in an isolated displaced ligament', () => {
    let angle = 0.3;
    let rate = 0;
    const energy = () => {
      const excess = Math.max(0, Math.abs(angle) - 0.125);
      return 5 * rate * rate + 1000 * (0.5 * excess ** 2 + excess ** 3 / (3 * 0.375));
    };
    const initial = energy();
    for (let i = 0; i < 2 / STEP; i++) {
      rate += (ligamentTorque(angle, rate, -0.5, 0.5, 10) / 10) * STEP;
      angle += rate * STEP;
    }
    expect(energy()).toBeLessThan(initial * 0.01);
  });
});
