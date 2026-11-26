import { describe, expect, it } from 'vitest';
import { CONTROL_DT, JOINT_LIMITS, Walker } from './walker';
import { evaluate, POLICY_SIZE, Trainer } from './training';

describe('Biped robot', () => {
  it('loads the floor, pushes off with motor torque, and lands', () => {
    const sim = new Walker({ crouch: 0.6 });
    const hold = [0.3, -0.6, 0.3, 0.3, -0.6, 0.3].map((value) => value / 1.6);
    for (let i = 0; i < 12; i++) sim.step(hold);
    expect(sim.frame().torso.y).toBeGreaterThan(0.9);
    expect(sim.contacts[0] || sim.contacts[1]).toBe(true);
    expect(sim.contacts[2] || sim.contacts[3]).toBe(true);
    let lifted = false;
    let landed = false;
    for (let i = 0; i < 18; i++) {
      sim.step([-0.07, 0.09, -0.3, -0.07, 0.09, -0.3]);
      const clearance = Math.min(...sim.frame().legs.flatMap((leg) => [leg.toe.y, leg.heel.y]));
      if (!sim.contacts.some(Boolean) && clearance > 0.035) lifted = true;
      if (lifted && sim.contacts.some(Boolean)) landed = true;
    }
    expect(lifted).toBe(true);
    expect(landed).toBe(true);
    expect(sim.work).toBeGreaterThan(0);
  });

  it('enforces hinge limits against opposite drive commands, allowing solver tolerance', () => {
    for (const direction of [-1, 1]) {
      const sim = new Walker({ crouch: 0.2 });
      for (let k = 0; k < 60 && !sim.done; k++) {
        sim.step([direction, direction, direction, -direction, -direction, -direction]);
        for (let i = 0; i < sim.motors.length; i++) {
          const a = sim.motors[i].joint.getJointAngle();
          const [min, max] = JOINT_LIMITS[i % 3];
          expect(a).toBeGreaterThanOrEqual(min - 0.065);
          expect(a).toBeLessThanOrEqual(max + 0.065);
        }
      }
    }
  });

  it('ends a fall and cannot keep earning reward after it', () => {
    const sim = new Walker({ tilt: 0.3 });
    const neutral = new Float64Array(6);
    while (!sim.done) sim.step(neutral);
    expect(sim.fell).toBe(true);
    expect(sim.ticks * CONTROL_DT).toBeLessThan(12);
    const frame = sim.frame();
    expect(sim.step(neutral)).toBe(0);
    expect(sim.frame()).toEqual(frame);
  });

  it('starts with an untrained baseline and updates policy reproducibly from rewards', () => {
    const a = new Trainer(42);
    const b = new Trainer(42);
    const base = a.checkpoint();
    expect(base.iteration).toBe(0);
    expect(base.policy).toEqual(Array(POLICY_SIZE).fill(0));
    expect(base.evaluation.passes).toBe(0);
    a.train();
    b.train();
    const next = a.checkpoint();
    expect(next.iteration).toBe(1);
    expect(next.policy).not.toEqual(base.policy);
    expect(next).toEqual(b.checkpoint());
    expect(next.evaluation).toEqual(evaluate(next.policy));
  });
});
