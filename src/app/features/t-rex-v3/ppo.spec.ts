import { describe, expect, it } from 'vitest';
import { seededRandom } from './balance-environment';
import { PpoAgent, advantages, clippedPolicyDerivative, gaussianLogProbability } from './ppo';
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
