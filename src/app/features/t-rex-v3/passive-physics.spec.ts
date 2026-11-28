import { describe, expect, it } from 'vitest';
import { GRAVITY, MASS_KG, PassiveRig, STEP } from './passive-physics';

describe('T. rex V3 passive physics', () => {
  it('starts with the complete weighted rig, neutral joints and ground clearance', () => {
    const rig = new PassiveRig(0.35, 5);
    const state = rig.snapshot();
    expect(state.valid).toBe(true);
    expect(state.pose).toHaveLength(39);
    expect(state.massKg).toBeCloseTo(MASS_KG);
    expect(state.jointGap).toBeLessThan(1e-8);
    expect(state.angleExcess).toBeLessThan(1e-6);
    expect(state.penetration).toBe(0);
  });

  it('falls under gravity without any actuator or ground contact', () => {
    const rig = new PassiveRig(2, 0);
    const before = rig.snapshot();
    for (let i = 0; i < Math.round(0.1 / STEP); i++) rig.step();
    const after = rig.snapshot();
    expect(after.seconds).toBeCloseTo(0.1);
    expect(after.groundContacts).toBe(0);
    const expected = (GRAVITY * after.seconds ** 2) / 2;
    expect(before.centerHeight - after.centerHeight).toBeCloseTo(expected, 2);
    expect(after.jointGap).toBeLessThan(0.01);
  });

  it('contacts the floor and retains a finite articulated body after a passive fall', () => {
    const rig = new PassiveRig();
    const before = rig.snapshot();
    let contacted = false;
    for (let i = 0; i < Math.round(4 / STEP); i++) {
      rig.step();
      if (i % Math.round(0.1 / STEP) === 0) {
        const state = rig.snapshot();
        expect(state.valid).toBe(true);
        contacted ||= state.groundContacts > 0;
      }
    }
    const after = rig.snapshot();
    expect(contacted).toBe(true);
    expect(after.centerHeight).toBeLessThan(before.centerHeight - 0.1);
    expect(after.jointGap).toBeLessThan(0.15);
    expect(after.angleExcess).toBeLessThan(10);
    expect(after.penetration).toBeLessThan(0.12);
    for (const p of after.pose) {
      const length = Math.hypot(...p.end.map((value, i) => value - p.start[i]));
      const rest = Math.hypot(...p.bone.end.map((value, i) => value - p.bone.start[i]));
      expect(length).toBeCloseTo(rest, 5);
    }
  }, 30000);
});
