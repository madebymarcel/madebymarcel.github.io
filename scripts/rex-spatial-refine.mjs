import { readFileSync, writeFileSync } from 'node:fs';
import { refine, evaluate } from '../src/app/features/t-rex/spatial-learning.mjs';
const url = new URL('../src/app/features/t-rex/spatial-checkpoint.json', import.meta.url);
const base = JSON.parse(readFileSync(url));
const runs = Number(process.argv[2] || 800);
const best = refine(base.policy, 'walk', 431, runs);
const stand = refine(Array(base.policy.length).fill(0), 'stand', 845, Math.ceil(runs / 2));
const pairs = base.pairs.map(({ options }) => ({
  options,
  unlocked: evaluate(best.policy, options),
  locked: evaluate(best.policy, { ...options, locked: true }),
  stand: evaluate(stand.policy, options),
}));
writeFileSync(
  url,
  JSON.stringify(
    { ...base, ...best, refinement: runs, standingPolicy: stand.policy, pairs },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    nominal: evaluate(best.policy, {}),
    standing: evaluate(stand.policy, {}),
    pairs,
  }),
);
