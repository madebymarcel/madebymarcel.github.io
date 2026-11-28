import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  OBSERVATIONS,
  BalanceEnvironment,
  decodeActions,
  measureSupport,
  seededRandom,
} from './balance-environment';
import { BALANCED_STANCE } from './muscle-profile';
import { GRAVITY, MASS_KG, PassiveRig } from './passive-physics';

describe('V3 deterministic balance environment', () => {
  it('provides stable, unique action and observation schemas', () => {
    const env = new BalanceEnvironment();
    const state = env.reset(42, 0);
    expect(state.observation).toHaveLength(OBSERVATIONS.length);
    expect(state.observation?.every(Number.isFinite)).toBe(true);
    expect(new Set(OBSERVATIONS).size).toBe(OBSERVATIONS.length);
    expect(new Set(ACTIONS.map(({ id, axis }) => id + ':' + axis)).size).toBe(ACTIONS.length);
    expect(ACTIONS.some(({ id, axis }) => id === 'left-lower-leg' && axis === 'yaw')).toBe(false);
    expect(() => decodeActions([])).toThrow('Invalid action vector');
    expect(() => decodeActions(ACTIONS.map(() => NaN))).toThrow('Invalid action vector');
    expect(() => decodeActions(ACTIONS.map(() => 2))).toThrow('Invalid action vector');
  });

  it('replays the same seeded episode independently of previous runs', () => {
    const env = new BalanceEnvironment(0.2);
    const random = seededRandom(17);
    const actions = Array.from({ length: 6 }, () => ACTIONS.map(() => 0.1 * (2 * random() - 1)));
    const run = (seed: number) => {
      const trajectory = [env.reset(seed)];
      for (const action of actions) {
        const last = trajectory[trajectory.length - 1];
        if (last.terminated || last.truncated) break;
        trajectory.push(env.step(action));
      }
      return trajectory;
    };
    const first = run(42);
    const second = run(42);
    expect(second).toEqual(first);
    expect(run(43)[0].observation).not.toEqual(first[0].observation);
    expect(first.length).toBeGreaterThan(1);
    if (first.at(-1)?.terminated || first.at(-1)?.truncated) {
      expect(() => env.step(actions[0])).toThrow('Reset a completed episode');
    }
  });

  it('cannot count upright airborne time as supported standing', () => {
    const rig = new PassiveRig(2, 0, { initialPose: BALANCED_STANCE });
    const state = rig.snapshot();
    const airborne = measureSupport(state, [0, 0, 0], 0, 0);
    expect(airborne.upright).toBe(true);
    expect(airborne.supported).toBe(false);
    expect(airborne.stable).toBe(false);
    const supported = measureSupport(state, [0, 0, 0], MASS_KG * GRAVITY, 0);
    expect(supported.stable).toBe(true);
    const moving = measureSupport(state, [1, 0, 0], MASS_KG * GRAVITY, 0);
    expect(moving.stable).toBe(false);
    const propped = measureSupport(
      state,
      [0, 0, 0],
      0.8 * MASS_KG * GRAVITY,
      0.2 * MASS_KG * GRAVITY,
    );
    expect(propped.supported).toBe(false);
  });
});
