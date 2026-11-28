import {
  HOLDOUT_STARTS,
  MODES,
  assessment,
  advanceWeights,
  emptyCheckpoint,
  propose,
  recordEvaluation,
} from '../src/app/features/t-rex/v2-search.mjs';
import { evaluate } from '../src/app/features/t-rex/v2-learning.mjs';

const mode = process.argv[2] ?? 'planar';
const updates = Number(process.argv[3] ?? 100);
const seeds = process.argv.slice(4).map(Number);
if (!seeds.length) seeds.push(3, 42, 43);
if (
  !MODES.includes(mode) ||
  !Number.isSafeInteger(updates) ||
  updates < 1 ||
  !seeds.every((seed) => Number.isSafeInteger(seed) && seed > 0 && seed <= 0xffffffff)
) {
  throw new Error('Usage: npm run experiment:rex-v2 -- planar 100 3 42 43');
}
for (const seed of seeds) {
  let state = emptyCheckpoint(mode, seed);
  state = recordEvaluation(state, assessment(state.weights, mode));
  console.log(JSON.stringify({ mode, seed, baseline: state.best.evaluation }));
  for (let i = 0; i < updates; i++) {
    const wave = propose(state);
    const rewards = wave.policies.map((policy) => evaluate(policy, mode, wave.start).score);
    state = advanceWeights(state, wave, rewards);
    state = recordEvaluation(state, assessment(state.weights, mode));
    if (state.iteration % 5 === 0 || state.iteration === updates) {
      console.log(
        JSON.stringify({
          mode,
          seed,
          iteration: state.iteration,
          trainingRollouts: state.rollouts,
          evaluationRollouts: state.evaluationRollouts,
          best: state.best.evaluation,
        }),
      );
    }
  }
  console.log(
    JSON.stringify({
      mode,
      seed,
      finalHoldout: assessment(state.best.policy, mode, HOLDOUT_STARTS),
    }),
  );
}
