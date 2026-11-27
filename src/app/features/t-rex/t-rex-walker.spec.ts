import { describe, expect, it } from 'vitest';
import { evaluate, POLICY_SIZE } from '../biped/training';
import { Vec2 } from 'planck';
import { Walker } from '../biped/walker';
import { REX_DEMO } from './t-rex-demo';
import { rexTrainer, rexWalker } from './t-rex-walker';

describe('T. rex walking', () => {
  it('has a separate massive tail with bounded internal motor torque', () => {
    const sim = rexWalker({});
    const tail = sim.tail!;
    expect(tail.body).not.toBe(sim.torso);
    expect(tail.body.getMass()).toBeCloseTo(0.76 * 0.12 * 95);
    expect(tail.joint.getBodyA()).toBe(sim.torso);
    expect(tail.joint.getBodyB()).toBe(tail.body);
    expect(tail.joint.isMotorEnabled()).toBe(true);
    expect(new Walker().tail).toBeUndefined();
    for (let i = 0; i < 30 && !sim.done; i++) {
      sim.step(new Float64Array(6));
      expect(Math.abs(tail.joint.getJointAngle())).toBeLessThan(25 * (Math.PI / 180) + 0.065);
      expect(Math.abs(tail.joint.getMotorTorque(120))).toBeLessThanOrEqual(80.01);
    }
  });

  it('moves the tail relative to the trunk in response to opposite pitch disturbances', () => {
    for (const sign of [-1, 1]) {
      const sim = rexWalker({ tilt: sign * 0.2 });
      // Isolate the angular response from gravity and ground reaction.
      sim.world.setGravity(Vec2(0, 0));
      sim.torso.setAngularVelocity(sign * 1.5);
      const before = sim.frame().tail!;
      sim.step(new Float64Array(6));
      const after = sim.frame().tail!;
      expect(sign * after.jointAngle).toBeGreaterThan(0);
      expect(after.tip).not.toEqual(before.tip);
      expect(sim.work).toBeGreaterThan(0);
    }
  });

  it('learns from a zero-weight policy in its own physical model', () => {
    const trainer = rexTrainer();
    const baseline = trainer.checkpoint();
    expect(baseline.policy).toEqual(Array(POLICY_SIZE).fill(0));
    expect(baseline.evaluation.passes).toBe(0);
    trainer.train();
    expect(trainer.checkpoint().policy).not.toEqual(baseline.policy);
  });

  it('re-evaluates the learned demo on the dinosaur rig without using saved poses', () => {
    const result = evaluate(REX_DEMO.policy, 'walk', rexWalker);
    expect(result.passes).toBeGreaterThanOrEqual(4);
    expect(result.medianDistance).toBeGreaterThan(8);
  });
});
