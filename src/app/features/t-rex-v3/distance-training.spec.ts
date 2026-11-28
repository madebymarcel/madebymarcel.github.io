import { describe, expect, it } from 'vitest';
import { DistanceTrainer, distanceReward } from './distance-training';
import { collectRollouts } from './rollout-collection';
import { DEFAULT_CORRELATION } from './ppo';

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

  it('collects complete seeded episodes under a frozen policy and rejects stale batches', () => {
    const trainer = new DistanceTrainer(37, 5);
    const jobs = trainer.beginRound(2, 4);
    expect(jobs[0].policy).toEqual(jobs[1].policy);
    expect(jobs[0].seed).not.toBe(jobs[1].seed);
    const results = jobs.map((job) => collectRollouts(job));
    for (const result of results) {
      expect(result.attempts).toBeGreaterThanOrEqual(4);
      expect(result.episodes.length).toBeGreaterThan(0);
      for (const episode of result.episodes) {
        if (episode.distanceM === null) {
          expect(episode.samples).toHaveLength(0);
        } else {
          expect(episode.samples[0].history).toBeUndefined();
          for (let i = 1; i < episode.samples.length; i++) {
            expect(episode.samples[i].history?.latent).toEqual(episode.samples[i - 1].latent);
          }
        }
      }
    }
    const frame = trainer.finishRound(results);
    expect(frame.stats.actions).toBe(results.reduce((sum, result) => sum + result.attempts, 0));
    const next = trainer.beginRound(1, 4, true);
    const short = collectRollouts(next[0]);
    expect(short.attempts).toBe(4);
    expect(short.episodes).toHaveLength(0);
    trainer.cancelRound(next[0].round);
    expect(() => trainer.finishRound([short])).toThrow('Incomplete collection round');
    expect(trainer.checkpoint().stats).toEqual(frame.stats);
  }, 30000);

  it('migrates V1 checkpoints without changing their policy parameters', () => {
    const trainer = new DistanceTrainer(37, 5, 0);
    const saved = trainer.checkpoint();
    const restored = DistanceTrainer.restore({ ...saved, format: 'trex-v3-ppo-distance-1' });
    expect(restored.correlation).toBe(DEFAULT_CORRELATION);
    expect(restored.checkpoint().learner).toEqual(saved.learner);
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
