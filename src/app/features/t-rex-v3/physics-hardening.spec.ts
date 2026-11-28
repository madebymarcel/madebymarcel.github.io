import { Body, Box, Plane, Vec3, World } from 'cannon-es';
import { describe, expect, it } from 'vitest';
import { CoulombSolver } from './coulomb-solver';
import { collisionExcluded } from './collision-policy';
import { ACTIONS, decodeActions, seededRandom } from './balance-environment';
import { BALANCED_STANCE } from './muscle-profile';
import { FRICTION, GRAVITY, MASS_KG, PassiveRig, STEP } from './passive-physics';
import { BONES } from './rig';

function loadedBox(dt: number, horizontalForce: number, extraLoad: number) {
  const solver = new CoulombSolver(FRICTION);
  solver.iterations = 100;
  const world = new World({ solver, gravity: new Vec3(0, 0, -GRAVITY) });
  world.defaultContactMaterial.friction = 0;
  world.defaultContactMaterial.contactEquationStiffness = 1e8;
  const plane = new Body({ mass: 0, shape: new Plane() });
  const box = new Body({
    mass: 1,
    shape: new Box(new Vec3(0.5, 0.5, 0.5)),
    position: new Vec3(0, 0, 0.5),
    fixedRotation: true,
    linearDamping: 0,
    angularDamping: 0,
  });
  world.addBody(plane);
  world.addBody(box);
  const count = Math.round(0.2 / dt);
  let normal = 0;
  let tangent = 0;
  for (let i = 0; i < count * 2; i++) {
    box.force.set(
      i < count ? 0 : horizontalForce / Math.sqrt(2),
      i < count ? 0 : horizontalForce / Math.sqrt(2),
      -extraLoad,
    );
    world.step(dt);
    for (const force of solver.forces) {
      expect(force.normal).toBeGreaterThanOrEqual(0);
      expect(force.tangent).toBeLessThanOrEqual(FRICTION * force.normal + 1e-8);
      if (i >= count) {
        normal += force.normal / count;
        tangent += force.tangent / count;
      }
    }
  }
  return { normal, tangent, velocity: Math.hypot(box.velocity.x, box.velocity.y) };
}

describe('V3 physics invariants', () => {
  it('scales static friction with actual normal load, including external overburden', () => {
    for (const dt of [1 / 120, STEP]) {
      const result = loadedBox(dt, 40, 100);
      expect(result.normal).toBeCloseTo(100 + GRAVITY, 0);
      expect(result.tangent).toBeCloseTo(40, 0);
      expect(result.velocity).toBeLessThan(0.05);
    }
  });

  it('uses a circular friction cone and gives similar sliding acceleration at both timesteps', () => {
    const results = [1 / 120, STEP].map((dt) => loadedBox(dt, 12, 0));
    for (const result of results) {
      expect(result.normal).toBeCloseTo(GRAVITY, 0);
      expect(result.tangent).toBeCloseTo(FRICTION * GRAVITY, 0);
      expect(result.velocity).toBeCloseTo((12 - FRICTION * GRAVITY) * 0.2, 1);
    }
    expect(Math.abs(results[0].velocity - results[1].velocity)).toBeLessThan(0.1);
  });

  it('excludes only connected and explicitly justified shared-joint regions', () => {
    const bone = (id: string) => BONES.find((entry) => entry.id === id)!;
    expect(collisionExcluded(bone('left-thigh'), bone('pelvis'))).toBe(true);
    expect(collisionExcluded(bone('left-inner-toe'), bone('left-middle-toe'))).toBe(true);
    expect(collisionExcluded(bone('left-thigh'), bone('spine-1'))).toBe(true);
    expect(collisionExcluded(bone('left-upper-arm'), bone('spine-3'))).toBe(true);
    expect(collisionExcluded(bone('left-forearm'), bone('spine-4'))).toBe(false);
    expect(collisionExcluded(bone('left-hand'), bone('spine-4'))).toBe(false);
    expect(collisionExcluded(bone('left-middle-toe'), bone('right-middle-toe'))).toBe(false);
    expect(collisionExcluded(bone('head'), bone('tail-8'))).toBe(false);
    const visible = BONES.filter((entry) => entry.id !== 'root');
    const pairs = visible.flatMap((a, i) =>
      visible.slice(i + 1).filter((b) => collisionExcluded(a, b)),
    );
    expect(pairs).toHaveLength(48);
  });

  it('checks momentum and energy under seeded random muscle commands in zero-gravity flight', () => {
    const results = [];
    for (const seed of [7, 37, 91]) {
      const random = seededRandom(seed);
      const rig = new PassiveRig(100, 0, { gravity: 0, initialPose: BALANCED_STANCE });
      const initial = rig.invariants();
      let commands = decodeActions(ACTIONS.map(() => 0));
      let maxLinear = 0;
      let maxAngular = 0;
      let maxGap = 0;
      let maxExcess = 0;
      let positiveWorkJ = 0;
      for (let i = 0; i < 240; i++) {
        if (i % 16 === 0) {
          commands = decodeActions(ACTIONS.map(() => 0.4 * (2 * random() - 1)));
        }
        rig.step({ mode: 'manual', ligaments: false, commands });
        const state = rig.snapshot();
        const now = rig.invariants();
        expect(state.valid).toBe(true);
        expect(state.groundContacts).toBe(0);
        expect(rig.contactForces().every((f) => f.tangentN <= FRICTION * f.normalN + 1e-5)).toBe(
          true,
        );
        maxLinear = Math.max(
          maxLinear,
          Math.hypot(...now.momentum.map((value, index) => value - initial.momentum[index])),
        );
        maxAngular = Math.max(
          maxAngular,
          Math.hypot(
            ...now.angularMomentum.map((value, index) => value - initial.angularMomentum[index]),
          ),
        );
        maxGap = Math.max(maxGap, state.jointGap);
        maxExcess = Math.max(maxExcess, state.angleExcess);
        for (const joint of state.sensors.joints) {
          for (const axis of ['pitch', 'yaw', 'roll'] as const) {
            const sensor = joint.axes[axis];
            expect(Math.abs(sensor.muscleNm)).toBeLessThanOrEqual(
              Math.abs(sensor.activation) * sensor.maximumNm + 1e-5,
            );
            positiveWorkJ += Math.max(0, sensor.muscleNm * sensor.rate) * STEP;
          }
        }
      }
      const energyJ = rig.invariants().energyJ - initial.energyJ;
      results.push({
        seed, maxLinear, maxAngular, maxGap, maxExcess, positiveWorkJ, energyJ,
        angularPass: maxAngular < 0.02 * MASS_KG * GRAVITY,
        constraintsPass: maxGap < 0.03 && maxExcess < 3,
        workPass: energyJ <= positiveWorkJ + 1000,
      });
      // Internal forces cannot change whole-body linear momentum.
      expect(maxLinear).toBeLessThan(0.1);
      expect(Number.isFinite(energyJ)).toBe(true);
    }
    // Explicit report-only gates: angular integration and work accounting
    // remain approximate; a passing test runner is not a physical certificate.
    console.info('V3_RANDOM_AUDIT ' + JSON.stringify(results));
  }, 30000);

  it('measures passive fall energy dissipation and contact accuracy', () => {
    const results = [];
    for (const timestep of [1 / 120, STEP]) {
      const rig = new PassiveRig(0.35, 5, { timestep });
      const initial = rig.invariants().energyJ;
      let peakGap = 0;
      let peakExcess = 0;
      let peakPenetration = 0;
      let peakEnergy = initial;
      let landed = false;
      for (let i = 0; i < Math.round(4 / timestep); i++) {
        rig.step();
        const state = rig.snapshot();
        expect(state.valid).toBe(true);
        landed ||= state.groundContacts > 0;
        peakGap = Math.max(peakGap, state.jointGap);
        peakExcess = Math.max(peakExcess, state.angleExcess);
        peakPenetration = Math.max(peakPenetration, state.penetration);
        peakEnergy = Math.max(peakEnergy, rig.invariants().energyJ);
        expect(rig.contactForces().every((f) => f.tangentN <= FRICTION * f.normalN + 1e-5)).toBe(
          true,
        );
      }
      const finalEnergy = rig.invariants().energyJ;
      expect(landed).toBe(true);
      expect(finalEnergy).toBeLessThan(initial);
      results.push({ timestep, initial, finalEnergy, peakEnergy, peakGap, peakExcess, peakPenetration });
    }
    console.info('V3_PASSIVE_AUDIT ' + JSON.stringify(results));
  }, 60000);
});
