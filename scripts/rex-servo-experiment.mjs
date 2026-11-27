import { readFileSync } from 'node:fs';
import {
  assess,
  completeWave,
  emptyCheckpoint,
  parseCheckpoint,
  propose,
} from '../src/app/features/t-rex/servo-search.mjs';

const generations = Number(process.argv[2] ?? 10);
const seed = Number(process.argv[3] ?? 3);
if (
  !Number.isSafeInteger(generations) ||
  generations < 1 ||
  !Number.isSafeInteger(seed) ||
  seed < 1
) {
  throw new Error('Usage: node scripts/rex-servo-experiment.mjs 10 3');
}
let state = process.argv[4]
  ? parseCheckpoint(readFileSync(process.argv[4], 'utf8'))
  : emptyCheckpoint(seed);
console.log('Initial learned policy', assess(state.best.policy));
for (let i = 0; i < generations; i++) {
  const wave = propose(state);
  state = completeWave(
    state,
    wave,
    wave.candidates.map(({ policy }) => assess(policy)),
  );
  console.log(
    JSON.stringify({
      generation: i + 1,
      candidates: state.iteration,
      best: state.best,
      populationFitness: Math.max(...state.population.map((e) => e.fitness)),
    }),
  );
}
