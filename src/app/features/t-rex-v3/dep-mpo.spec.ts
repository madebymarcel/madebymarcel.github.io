import { describe, expect, it } from 'vitest';
import { ACTIONS, OBSERVATIONS, BalanceEnvironment, physicsFaultKinds, seededRandom } from './balance-environment';
import { CapabilityAudit, assessCapabilities, passiveCapability } from './capability-audit';
import { DepController, OSTRICH_DEP, depSensors } from './dep-controller';
import { collectDepRollouts } from './dep-rollout';
import { DepTrainer } from './dep-training';
import { MASS_KG, GRAVITY } from './passive-physics';
import { MpoAgent, mpoWeights } from './mpo';
import { ReplayBuffer, nStepExperiences } from './replay-buffer';
import type { Experience } from './replay-buffer';

describe('reference-inspired DEP', () => {
  it('has no scripted motion and learns the finite-window differential outer product', () => {
    const controller = new DepController(2, { ...OSTRICH_DEP, delay: 0, tau: 8 });
    expect(controller.step([0, 0])).toEqual([0, 0]);
    for (let t = 1; t < 12; t++) controller.step([t * 0.01, -2 * t * 0.01]);
    const state = controller.state();
    expect(state.matrix[0]).toBeLessThan(0);
    expect(state.matrix[1]).toBeGreaterThan(0);
    expect(state.matrix[2]).toBeGreaterThan(0);
    expect(state.matrix[3]).toBeLessThan(0);
    expect(Math.hypot(...state.matrix.slice(0, 2))).toBeCloseTo(OSTRICH_DEP.kappa);
    const restored = new DepController(2, { ...OSTRICH_DEP, delay: 0, tau: 8 });
    restored.restore(state);
    expect(restored.state()).toEqual(state);
    const beforeReset = restored.state();
    restored.step([100, -100]);
    expect(restored.state()).toEqual(beforeReset);
    expect(() => restored.step([NaN, 0])).toThrow();
  });

  it('maps only signed joint angle sensors to DEP', () => {
    const observation = OBSERVATIONS.map((_, i) => i);
    expect(depSensors(observation)).toEqual(ACTIONS.map((_, i) => -(i * 4)));
  });

  it('collects reproducible complete real-body episodes and discards truncated benchmark work', () => {
    const job = {
      brain: 'dep' as const,
      round: 1,
      lane: 0,
      seed: 37,
      horizon: 5,
      minimumActions: 32,
      exactBudget: false,
      exploration: 'dep' as const,
      depState: null,
      policy: null,
    };
    const first = collectDepRollouts(job);
    const second = collectDepRollouts(job);
    expect(first).toEqual(second);
    expect(first.attempts).toBeGreaterThanOrEqual(32);
    expect(first.depAttempts).toBe(first.attempts);
    expect(first.episodes.length).toBeGreaterThan(0);
    for (const episode of first.episodes) {
      expect(episode.reason).not.toBe('running');
      if (episode.reason === 'invalid') expect(episode.experiences).toHaveLength(0);
      else {
        expect(episode.experiences).toHaveLength(episode.actions);
        expect(episode.experiences.every((item) => item.source === 'dep')).toBe(true);
      }
    }
    const short = collectDepRollouts({ ...job, exactBudget: true, minimumActions: 2 });
    expect(short.attempts).toBe(2);
    expect(short.episodes).toHaveLength(0);
    expect(short.depState.matrix.every((value) => value === 0)).toBe(true);
  }, 60000);
});

describe('physical capability validation', () => {
  it('requires loaded support, sustained lift and a forward touchdown for alternating steps', () => {
    const env = new BalanceEnvironment(5);
    const reset = env.reset(37);
    const snapshot = env.snapshot();
    const audit = new CapabilityAudit();
    const weight = MASS_KG * GRAVITY;
    let t = 0;
    const observe = (
      leftLifted: boolean,
      rightLifted: boolean,
      leftShift: number,
      rightShift: number,
    ) => {
      const leftLoad = leftLifted ? 0 : rightLifted ? weight : weight / 2;
      const rightLoad = rightLifted ? 0 : leftLifted ? weight : weight / 2;
      audit.observe(
        {
          ...reset,
          elapsed: t++ / 30,
          support: {
            footLoadN: leftLoad + rightLoad,
            otherLoadN: 0,
            upright: true,
            supported: true,
            stable: false,
          },
        },
        {
          ...snapshot,
          sensors: {
            ...snapshot.sensors,
            leftFootLoadN: leftLoad,
            rightFootLoadN: rightLoad,
            leftFootClearanceM: leftLifted ? 0.05 : 0,
            rightFootClearanceM: rightLifted ? 0.05 : 0,
          },
          pose: snapshot.pose.map((item) => {
            const shift =
              item.bone.id === 'left-foot'
                ? leftShift
                : item.bone.id === 'right-foot'
                  ? rightShift
                  : 0;
            return { ...item, end: [item.end[0] + shift, item.end[1], item.end[2]] as const };
          }),
        },
      );
    };
    observe(false, false, 0, 0);
    for (let i = 0; i < 3; i++) observe(true, false, 0.02, 0);
    observe(false, false, 0.1, 0);
    for (let i = 0; i < 3; i++) observe(false, true, 0.1, 0.02);
    observe(false, false, 0.1, 0.1);
    expect(audit.report(reset)).toMatchObject({
      leftLifts: 1,
      rightLifts: 1,
      leftSteps: 1,
      rightSteps: 1,
      weightTransfers: 1,
      alternatingSteps: 1,
    });
  });

  it('does not classify a passive collapse or airborne reset as locomotion', () => {
    const env = new BalanceEnvironment(5);
    const reset = env.reset(37);
    const audit = new CapabilityAudit();
    audit.observe(reset, env.snapshot());
    expect(audit.report(reset).leftLifts).toBe(0);
    expect(audit.report(reset).rightLifts).toBe(0);
    const baseline = passiveCapability(37);
    expect(baseline.capability.alternatingSteps).toBe(0);
    expect(baseline.capability.longestStableSeconds).toBeLessThan(2);
    expect(assessCapabilities([baseline]).passed).toBe(false);
  }, 30000);
});

function experience(action: number, reward: number, discount = 0): Experience {
  return {
    observation: [1],
    action: [action],
    nextObservation: [1],
    reward,
    discount,
    source: 'dep',
  };
}

describe('off-policy MPO', () => {
  it('solves the shared E-step KL budget and favors high-Q actions', () => {
    const e = mpoWeights(
      [
        [0, 1, 2],
        [2, 4, 5],
      ],
      0.1,
    );
    expect(e.kl).toBeCloseTo(0.1, 5);
    for (const row of e.weights) {
      expect(row.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
      expect(row[2]).toBeGreaterThan(row[1]);
      expect(row[1]).toBeGreaterThan(row[0]);
    }
    const constant = mpoWeights([[1, 1, 1]]);
    expect(constant.weights[0]).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('stores valid off-policy transitions, uses terminal-aware n-step returns and round-trips replay', () => {
    const items = nStepExperiences([
      experience(0.2, 1, 1),
      experience(0.4, 2, 1),
      experience(0.6, 3),
    ]);
    expect(items.map((item) => item.reward)).toEqual([6, 5, 3]);
    expect(items.map((item) => item.discount)).toEqual([0, 0, 0]);
    expect(nStepExperiences([experience(0.2, 1, 1)])[0].discount).toBe(1);
    const replay = new ReplayBuffer(1, 1, 2);
    items.forEach((item) => replay.add(item));
    expect(replay.size).toBe(2);
    const saved = replay.state();
    const restored = new ReplayBuffer(1, 1, 2);
    restored.restore(saved);
    expect(restored.state()).toEqual(saved);
    expect(restored.get(0)).toEqual(replay.get(0));
    expect(() => restored.restore({ ...saved, data: 'bad' })).toThrow();
    expect(() => restored.add(experience(2, 0))).toThrow();
  });

  it('learns a positively rewarded action from DEP-labeled replay without on-policy probabilities', () => {
    const random = seededRandom(37);
    const replay = new ReplayBuffer(1, 1, 256);
    for (let i = 0; i < 256; i++) {
      const action = 2 * random() - 1;
      replay.add(experience(action, action));
    }
    const agent = new MpoAgent(1, 1, seededRandom(91));
    const before = agent.action([1])[0];
    for (let i = 0; i < 180; i++) {
      const metrics = agent.update(replay.sample(32, random));
      expect(Object.values(metrics).every(Number.isFinite)).toBe(true);
      expect(metrics.nonparametricKl).toBeLessThanOrEqual(0.100001);
    }
    expect(agent.action([1])[0]).toBeGreaterThan(before + 0.03);
    const restored = new MpoAgent(1, 1, seededRandom(173));
    restored.restore(agent.state());
    expect(restored.state()).toEqual(agent.state());
    expect(restored.action([1])).toEqual(agent.action([1]));
  }, 60000);
});

describe('staged DEP trainer', () => {
  it('retains DEP replay and controller state when enabling experimental MPO and reloading', () => {
    const trainer = new DepTrainer(37, 5);
    const jobs = trainer.beginRound(1, 32);
    const frame = trainer.finishRound(jobs.map((job) => collectDepRollouts(job)));
    expect(frame.brain).toBe('dep');
    expect(frame.stats.updates).toBe(0);
    expect(frame.depDecisions).toBe(frame.stats.actions);
    const saved = trainer.checkpoint();
    const promoted = trainer.enableMpo();
    expect(promoted.brain).toBe('dep-mpo');
    const after = trainer.checkpoint();
    expect(after.replay).toEqual(saved.replay);
    expect(after.depStates).toEqual(saved.depStates);
    expect(after.history).toEqual(saved.history);
    const restored = DepTrainer.restore(JSON.parse(JSON.stringify(after)));
    expect(restored.checkpoint()).toEqual(after);
    const next = restored.beginRound(1, 2, true);
    restored.cancelRound(next[0].round);
    expect(() => restored.finishRound(next.map((job) => collectDepRollouts(job)))).toThrow();
  }, 60000);
});

describe('physics fault localization', () => {
  it('reports the existing limits without relaxing them', () => {
    const env = new BalanceEnvironment(5);
    env.reset(37);
    const state = env.snapshot();
    expect(physicsFaultKinds(state)).toEqual([]);
    expect(physicsFaultKinds({ ...state, jointGap: 0.031, angleExcess: 3.01, penetration: 0.031 })).toEqual([
      'joint-gap', 'angle-limit', 'ground-penetration',
    ]);
    expect(physicsFaultKinds({ ...state, valid: false })).toEqual(['non-finite']);
    expect(() => new BalanceEnvironment(5, true, { timestep: 1 / 500 })).toThrow();
  });
});
