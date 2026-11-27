import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate, generator } from '../src/app/features/t-rex/spatial-learning.mjs';
const seed = 431,
  random = generator(seed),
  count = Number(process.argv[2] || 1600);
const url = new URL('../src/app/features/t-rex/spatial-checkpoint.json', import.meta.url);
const source = JSON.parse(readFileSync(process.argv[3] || url));
const starts = [
  {},
  { lateralVelocity: -0.035, friction: 0.8 },
  { lateralVelocity: 0.04, friction: 0.92 },
];
function fitness(policy) {
  const fitness = starts.map((options) => {
    const m = evaluate(policy, options);
    return 2 * Math.min(8, m.steps) + 3 * Math.min(m.distance, 0.22 * m.steps) + m.ticks / 120;
  });
  return Math.min(...fitness) * 0.5 + (0.5 * fitness.reduce((a, b) => a + b)) / fitness.length;
}
let parents = [{ policy: source.policy, score: fitness(source.policy) }];
for (let i = 0; i < count; i++) {
  const parent = parents[Math.floor(random() * parents.length)];
  const candidate = parent.policy.slice();
  const scale = [0.012, 0.05, 0.22, 0.8, 1.7][i % 5];
  const probability = [0.02, 0.06, 0.15][i % 3];
  for (let k = 0; k < candidate.length; k++) {
    if (random() < probability) candidate[k] += (random() - 0.5) * scale;
  }
  const score = fitness(candidate);
  if (!parents.some((p) => p.score === score)) {
    parents.push({ policy: candidate, score });
    parents.sort((a, b) => b.score - a.score);
    parents = parents.slice(0, 5);
  }
}
const best = parents[0];
const pairs = source.pairs.map(({ options }) => ({
  options,
  unlocked: evaluate(best.policy, options),
  locked: evaluate(best.policy, { ...options, locked: true }),
}));
writeFileSync(
  process.argv[4] || url,
  JSON.stringify(
    {
      ...source,
      ...best,
      refinement: { seed, candidates: count },
      nominal: evaluate(best.policy, {}),
      pairs,
    },
    null,
    2,
  ) + '\n',
);
console.log(evaluate(best.policy, {}), pairs);
