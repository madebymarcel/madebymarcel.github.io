import { describe, expect, it } from 'vitest';
import { seededRandom } from './balance-environment';
import {
  PpoAgent,
  advantages,
  clippedPolicyDerivative,
  conditionalGaussian,
  gaussianLogProbability,
} from './ppo';
import type { Sample } from './ppo';

describe('V3 PPO', () => {
  it('computes undiscounted advantages with distinct termination and truncation bootstrap', () => {
    const samples: Sample[] = [
      { observation: [0], latent: [0], logProbability: 0, value: 0, reward: 2 },
      { observation: [0], latent: [0], logProbability: 0, value: 0, reward: -1 },
    ];
    expect(advantages(samples, 0).map((sample) => sample.advantage)).toEqual([1.05, -1]);
    expect(advantages(samples, 3).map((sample) => sample.target)).toEqual([3.9, 2]);
  });

  it('clips the correct side of the PPO objective and uses the joint Gaussian probability', () => {
    expect(clippedPolicyDerivative(1.3, 1)).toBe(0);
    expect(clippedPolicyDerivative(0.7, -1)).toBe(0);
    expect(clippedPolicyDerivative(0.7, 1)).toBeCloseTo(-0.7);
    expect(clippedPolicyDerivative(1.3, -1)).toBeCloseTo(1.3);
    expect(gaussianLogProbability([0, 0], [0, 0])).toBeGreaterThan(
      gaussianLogProbability([1, -1], [0, 0]),
    );
  });

  it('samples stationary correlated residuals and recomputes their exact conditional likelihood', () => {
    const rho = 0.85;
    const agent = new PpoAgent(1, 1, seededRandom(37), rho);
    const observation = [0.25];
    const mean = Math.atanh(agent.action(observation)[0]);
    const residuals: number[] = [];
    let previous: { observation: readonly number[]; latent: readonly number[] } | undefined;
    for (let i = 0; i < 2048; i++) {
      const decision = agent.sample(observation, previous);
      expect(agent.logProbability({ observation, ...decision })).toBeCloseTo(
        decision.logProbability,
        10,
      );
      residuals.push(decision.latent[0] - mean);
      previous = { observation, latent: decision.latent };
    }
    const average = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
    const variance = residuals.reduce((sum, value) => sum + (value - average) ** 2, 0);
    const lag =
      residuals
        .slice(1)
        .reduce((sum, value, index) => sum + (value - average) * (residuals[index] - average), 0) /
      variance;
    expect(lag).toBeGreaterThan(0.79);
    expect(lag).toBeLessThan(0.91);
    expect(variance / residuals.length).toBeGreaterThan(0.14);
    expect(variance / residuals.length).toBeLessThan(0.27);
    expect(agent.sample(observation).history).toBeUndefined();
  });

  it('conditions on both network means, not on a fixed old residual', () => {
    const rho = 0.85;
    const gaussian = conditionalGaussian([0.2], [0.1], [0.5], rho);
    expect(gaussian.mean[0]).toBeCloseTo(0.54);
    expect(gaussian.std).toBeCloseTo(0.45 * Math.sqrt(1 - rho ** 2));
    const evaluate = (current: number, previous: number) => {
      const distribution = conditionalGaussian([current], [previous], [0.5], rho);
      return gaussianLogProbability([0.7], distribution.mean, distribution.std);
    };
    const h = 1e-5;
    const currentGradient = (evaluate(0.2 + h, 0.1) - evaluate(0.2 - h, 0.1)) / (2 * h);
    const previousGradient = (evaluate(0.2, 0.1 + h) - evaluate(0.2, 0.1 - h)) / (2 * h);
    expect(previousGradient).toBeCloseTo(-rho * currentGradient, 6);
    expect(conditionalGaussian([0.2], undefined, undefined, rho).std).toBe(0.45);
  });

  it('learns a positive action in a seeded one-state reward task', () => {
    const agent = new PpoAgent(1, 1, seededRandom(37));
    const observation = [1];
    const before = agent.action(observation)[0];
    for (let update = 0; update < 6; update++) {
      const data = Array.from({ length: 128 }, () => {
        const decision = agent.sample(observation);
        expect(Math.abs(decision.action[0])).toBeLessThanOrEqual(1);
        return advantages([{ ...decision, observation, reward: decision.action[0] }], 0)[0];
      });
      agent.update(data);
    }
    const after = agent.action(observation)[0];
    expect(after).toBeGreaterThan(before + 0.1);
    const restored = new PpoAgent(1, 1, seededRandom(5));
    restored.restore(agent.state());
    expect(restored.state()).toEqual(agent.state());
    expect(restored.action(observation)).toEqual(agent.action(observation));
  });
});
