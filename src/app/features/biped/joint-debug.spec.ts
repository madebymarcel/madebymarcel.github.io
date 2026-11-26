import { describe, expect, it } from 'vitest';
import { COMBINATIONS, JOINT_DEBUG_SPECS, JointDebug, jointPose } from './joint-debug';
import { ACTIONS } from './walker';

describe('Joint debug', () => {
  it('shows the mechanical range separately from targets the policy can command', () => {
    const [hip, knee, ankle] = JOINT_DEBUG_SPECS;
    expect(hip.max).toBeCloseTo(120);
    expect(hip.policyMax).toBeCloseTo(95.673);
    expect(knee.min).toBeCloseTo(-140);
    expect(knee.policyMin).toBeCloseTo(-99.673);
    expect(ankle.min).toBeCloseTo(-55);
    expect(ankle.max).toBeCloseTo(15);
    for (const joint of JOINT_DEBUG_SPECS) expect(joint.motorSpeed).toBeCloseTo(687.549);
  });

  it('covers every min/max endpoint combination by moving one joint at a time', () => {
    const poses = Array.from({ length: COMBINATIONS }, (_, i) => jointPose(2 * ACTIONS + i));
    expect(new Set(poses.map(({ targets }) => targets.join(','))).size).toBe(64);
    for (let i = 1; i < poses.length; i++) {
      expect(
        poses[i].targets.filter((target, j) => target !== poses[i - 1].targets[j]),
      ).toHaveLength(1);
    }
  });

  it('physically reaches all test poses and measures every joint with the torso fixed', () => {
    const debug = new JointDebug();
    const start = debug.snapshot();
    let reached = 0;
    for (let step = 0; step < 2500 && !debug.done; step++) {
      const before = debug.snapshot();
      debug.step();
      const now = debug.snapshot();
      if (before.label !== now.label || now.done) {
        expect(
          now.frame.angles.every((angle, i) => Math.abs(angle - before.targets[i]) < 0.5),
        ).toBe(true);
        reached++;
      }
    }
    const finish = debug.snapshot();
    expect(reached).toBe(2 * ACTIONS + COMBINATIONS);
    expect(finish.done).toBe(true);
    expect(finish.frame.torso).toEqual(start.frame.torso);
    expect(finish.peaks.every((peak) => peak > 0 && Number.isFinite(peak))).toBe(true);
  });
});
