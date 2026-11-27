import { appendFileSync, readFileSync } from 'node:fs';
import {
  assess,
  completeWave,
  emptyCheckpoint,
  evaluationDeficit,
  legacyPropose,
  propose,
  WAVE_SIZE,
} from '../src/app/features/t-rex/curriculum.mjs';

const algorithm = process.argv[2] ?? 'both';
const budget = Number(process.argv[3] ?? 3504);
const seed = Number(process.argv[4] ?? 536);
if (!['legacy', 'adaptive', 'both'].includes(algorithm)) throw new Error('Invalid algorithm.');
if (!Number.isSafeInteger(budget) || budget < WAVE_SIZE || budget % WAVE_SIZE !== 0) {
  throw new Error('Candidate budget must be a positive multiple of eight.');
}
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
  throw new Error('Seed must be a uint32.');
}
const initial = JSON.parse(
  readFileSync(new URL('../src/app/features/t-rex/spatial-standing.json', import.meta.url), 'utf8'),
).policy;

for (const mode of algorithm === 'both' ? ['legacy', 'adaptive'] : [algorithm]) {
  let state = emptyCheckpoint(seed);
  let firstPassingCandidate = null;
  const start = performance.now();
  while (state.iteration < budget) {
    const wave = (mode === 'legacy' ? legacyPropose : propose)(state, initial);
    const evaluations = wave.candidates.map(({ policy }) => assess('balance', policy));
    if (firstPassingCandidate === null) {
      const index = evaluations.findIndex((evaluation) => evaluation.passes === 3);
      if (index >= 0) firstPassingCandidate = wave.candidates[index].iteration;
    }
    state = completeWave(state, wave, evaluations, mode === 'legacy');
    if (state.iteration % 256 === 0 || state.iteration === budget) {
      console.log(
        JSON.stringify({
          mode,
          candidates: state.iteration,
          passes: state.best.balance.evaluation.passes,
          deficit: evaluationDeficit('balance', state.best.balance.evaluation),
          firstPassingCandidate,
        }),
      );
    }
  }
  const seconds = (performance.now() - start) / 1000;
  const summary = {
    mode,
    seed,
    candidates: budget,
    firstPassingCandidate,
    passes: state.best.balance.evaluation.passes,
    deficit: evaluationDeficit('balance', state.best.balance.evaluation),
    fitness: state.best.balance.evaluation.score,
    seconds,
    candidatesPerSecond: budget / seconds,
    physicsStepsPerSecond: state.physicsSteps / seconds,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      '## Balance benchmark: ' +
        mode +
        '\n\n```json\n' +
        JSON.stringify(summary, null, 2) +
        '\n```\n',
    );
  }
}
