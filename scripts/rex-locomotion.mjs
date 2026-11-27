import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  assess,
  completeWave,
  emptyCheckpoint,
  nextStage,
  parseCheckpoint,
  propose,
  WAVE_SIZE,
} from '../src/app/features/t-rex/curriculum.mjs';

const batches = Number(process.argv[2] ?? 100);
const output = process.argv[3] ?? 'rex-training.json';
if (!Number.isSafeInteger(batches) || batches < 1) throw new Error('Provide a positive batch count.');
const initial = JSON.parse(
  readFileSync(new URL('../src/app/features/t-rex/spatial-standing.json', import.meta.url)),
).policy;
let state = existsSync(output) ? parseCheckpoint(readFileSync(output, 'utf8')) : emptyCheckpoint();
const start = performance.now();
const originalSteps = state.physicsSteps;
for (let i = 0; i < batches; i++) {
  const wave = propose(state, initial);
  state = nextStage(
    completeWave(state, wave, wave.candidates.map(({ policy }) => assess(state.stage, policy))),
  );
  if (i % 10 === 0 || i === batches - 1) {
    writeFileSync(output + '.tmp', JSON.stringify(state));
    renameSync(output + '.tmp', output);
    const seconds = (performance.now() - start) / 1000;
    console.log(JSON.stringify({
      iteration: state.iteration,
      stage: state.stage,
      candidatesPerSecond: (i + 1) * WAVE_SIZE / seconds,
      physicsStepsPerSecond: (state.physicsSteps - originalSteps) / seconds,
      passes: Object.fromEntries(
        Object.entries(state.best).map(([stage, entry]) => [stage, entry.evaluation.passes]),
      ),
    }));
  }
}
