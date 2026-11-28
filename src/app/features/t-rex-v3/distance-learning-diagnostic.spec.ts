import { describe, expect, it } from 'vitest';
import { ACTIONS, BalanceEnvironment, seededRandom } from './balance-environment';
import { DistanceTrainer } from './distance-training';
import { PpoAgent } from './ppo';
import { OBSERVATIONS } from './balance-environment';

describe('deployed V3 training diagnostic', () => {
  it('compares passive, untrained mean policy and stochastic rollout outcomes', () => {
    const results = [];
    for (const mode of ['zero', 'mean', 'explore'] as const) {
      for (const seed of [37, 91, 173]) {
        const env = new BalanceEnvironment(5, true);
        const agent = new PpoAgent(OBSERVATIONS.length, ACTIONS.length, seededRandom(seed));
        let state = env.reset(seed);
        const origin = state.forwardPositionM;
        let steps = 0;
        let maxGap = 0;
        let maxExcess = 0;
        let maxPenetration = 0;
        let maxSupport = 0;
        let lastDistance = 0;
        while (state.reason === 'running' && state.observation && steps < 150) {
          const action =
            mode === 'zero'
              ? ACTIONS.map(() => 0)
              : mode === 'mean'
                ? agent.action(state.observation)
                : agent.sample(state.observation).action;
          state = env.step(action);
          const snapshot = env.snapshot();
          maxGap = Math.max(maxGap, snapshot.jointGap);
          maxExcess = Math.max(maxExcess, snapshot.angleExcess);
          maxPenetration = Math.max(maxPenetration, snapshot.penetration);
          maxSupport = Math.max(maxSupport, state.support.footLoadN);
          if (state.reason !== 'invalid' && state.reason !== 'fall') {
            lastDistance = state.forwardPositionM - origin;
          }
          steps++;
        }
        results.push({
          mode,
          seed,
          steps,
          seconds: state.elapsed,
          reason: state.reason,
          lastDistance,
          maxGap,
          maxExcess,
          maxPenetration,
          maxSupport,
          pelvisHeight: env.snapshot().pelvisHeight,
          supportedSeconds: state.supportedSeconds,
        });
      }
    }
    console.info('V3_ROLLOUT_DIAGNOSTIC ' + JSON.stringify(results));
    expect(results).toHaveLength(9);
  }, 120000);

  it('runs the exact deployed trainer until two updates or a bounded diagnostic budget', () => {
    const trainer = new DistanceTrainer(37, 30);
    const initial = trainer.checkpoint();
    let frame = trainer.frame();
    const trace = [];
    for (let i = 0; i < 64; i++) {
      frame = trainer.advance(8);
      if (i % 4 === 0 || frame.phase === 'blocked') {
        trace.push({
          phase: frame.phase,
          reason: frame.reason,
          elapsed: frame.elapsed,
          distanceM: frame.distanceM,
          pelvisHeight: frame.snapshot.pelvisHeight,
          gap: frame.snapshot.jointGap,
          excess: frame.snapshot.angleExcess,
          penetration: frame.snapshot.penetration,
          stats: frame.stats,
          message: frame.message,
        });
      }
      if (frame.phase === 'blocked' || frame.stats.updates >= 2) break;
    }
    const changed = trainer
      .checkpoint()
      .learner.actor.weights.some((value, i) => value !== initial.learner.actor.weights[i]);
    console.info(
      'V3_TRAINER_DIAGNOSTIC ' +
        JSON.stringify({
          trace,
          phase: frame.phase,
          reason: frame.reason,
          message: frame.message,
          stats: frame.stats,
          weightsChanged: changed,
        }),
    );
    expect(frame.stats.actions).toBeGreaterThan(0);
  }, 180000);
});
