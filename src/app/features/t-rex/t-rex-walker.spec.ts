import { describe, expect, it } from 'vitest';
import { evaluate, POLICY_SIZE } from '../biped/training';
import { REX_DEMO } from './t-rex-demo';
import { rexTrainer, rexWalker } from './t-rex-walker';

describe('T. rex walking', () => {
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
