import { describe, expect, it } from 'vitest';
import { DistanceTrainer, distanceReward } from './distance-training';

describe('V3 distance-only training', () => {
  it('only rewards signed forward displacement and excludes the falling transition', () => {
    expect(distanceReward(0, 1.5, 'running')).toBe(1.5);
    expect(distanceReward(1.5, 1, 'running')).toBe(-0.5);
    expect(distanceReward(1, 1, 'running')).toBe(0);
    expect(distanceReward(1, 3, 'fall')).toBe(0);
    expect(distanceReward(1, 3, 'invalid')).toBeNull();
    expect(distanceReward(1, 3, 'time-limit')).toBe(2);
    expect(distanceReward(1, NaN, 'running')).toBeNull();
  });

  it('runs reproducible real-body actions without a scripted controller', () => {
    const first = new DistanceTrainer(37, 5);
    const second = new DistanceTrainer(37, 5);
    const a = first.advance(4);
    const b = second.advance(4);
    expect(a.stats.actions).toBeGreaterThan(0);
    expect(a.distanceM).toBe(b.distanceM);
    expect(a.stats).toEqual(b.stats);
    expect(a.snapshot.pose).toEqual(b.snapshot.pose);
    expect(Number.isFinite(a.distanceM)).toBe(true);
    expect(a.stats.bestEvaluationM).toBeNull();
    const saved = first.checkpoint();
    const restored = DistanceTrainer.restore(JSON.parse(JSON.stringify(saved)));
    expect(restored.checkpoint().learner).toEqual(saved.learner);
    expect(restored.checkpoint().stats).toEqual(saved.stats);
    expect(() => DistanceTrainer.restore({ ...saved, format: 'legacy' })).toThrow();
    expect(() => DistanceTrainer.restore({ ...saved, actions: [] })).toThrow();
  }, 30000);
});
