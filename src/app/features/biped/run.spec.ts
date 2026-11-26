import { describe, expect, it } from 'vitest';
import { TaskProgress, validRun } from './tasks';
import { better, fastestRun, type Checkpoint, type Trial } from './training';
import { CONTROL_DT, EPISODE_SECONDS, Walker } from './walker';

function completedRun() {
  return Object.assign(new Walker(), {
    ticks: EPISODE_SECONDS / CONTROL_DT,
    done: true,
    distance: 24,
    steps: 15,
    flightTime: 3,
    alternatingFlights: 7,
  });
}

function checkpoint(...trials: [speed: number, valid: boolean][]): Checkpoint {
  const results: Trial[] = trials.map(([speed, validRun]) => ({
    distance: speed * EPISODE_SECONDS,
    seconds: EPISODE_SECONDS,
    validRun,
    passed: validRun && speed >= 1.55,
    reward: 7,
    steps: 15,
    flightFraction: 0.25,
    alternatingFlights: validRun ? 7 : 0,
    slipDistance: 0,
    fell: false,
  }));
  return {
    iteration: 5,
    policy: [],
    evaluation: {
      passes: results.filter((item) => item.passed).length,
      medianDistance: 0,
      medianReward: 7,
      results,
    },
  };
}

describe('Run training', () => {
  it('rejects a walk or a falling lunge, even if either is fast', () => {
    const sim = completedRun();
    expect(validRun(sim)).toBe(true);
    sim.alternatingFlights = 0;
    expect(validRun(sim)).toBe(false);
    sim.alternatingFlights = 7;
    sim.fell = true;
    expect(validRun(sim)).toBe(false);
  });

  it('rewards faster progress beyond the old speed cap', () => {
    const sim = new Walker();
    sim.distance = 2 * CONTROL_DT;
    const atTwo = new TaskProgress('run').update(sim, 0);
    sim.distance = 3 * CONTROL_DT;
    expect(new TaskProgress('run').update(sim, 0)).toBeGreaterThan(atTwo);
  });

  it('picks a qualifying replay rather than the first start or a faster non-run', () => {
    const run = checkpoint([3.3, false], [1.6, true], [1.8, true]);
    expect(fastestRun(run.evaluation)).toEqual({ index: 2, speed: 1.8 });
    expect(fastestRun(checkpoint([3.3, false]).evaluation)).toBeUndefined();
  });

  it('ranks stable runs ahead of failed attempts, then breaks ties by speed', () => {
    const slow = checkpoint([1.6, true], [1.8, true]);
    const fast = checkpoint([1.9, true], [2.2, true]);
    expect(better(fast, slow, 'run')).toBe(true);
    expect(better(checkpoint([3.3, false], [4, false]), fast, 'run')).toBe(false);
  });
});
