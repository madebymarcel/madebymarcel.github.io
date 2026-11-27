import { STAGES, assess, completeWave, emptyCheckpoint, propose, selectSkill, skillState } from '../src/app/features/t-rex/servo-search.mjs';

const stage = process.argv[2] ?? 'walk';
const generations = Number(process.argv[3] ?? 10);
const seed = Number(process.argv[4] ?? 3);
if (!STAGES.includes(stage) || !Number.isSafeInteger(generations) || generations < 1 || !Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) {
  throw new Error('Usage: node scripts/rex-servo-experiment.mjs walk 10 3');
}
let state = selectSkill(emptyCheckpoint(seed), stage);
console.log('Baseline', assess(stage, skillState(state).weights));
for (let i = 0; i < generations; i++) {
  const wave = propose(state);
  const evaluations = wave.candidates.map(({ policy }) => assess(stage, policy));
  state = completeWave(state, wave, evaluations);
  const best = skillState(state).best;
  console.log(JSON.stringify({ generation: i + 1, candidates: state.iteration, ...best.evaluation }));
  if (best.evaluation.passed) break;
}
