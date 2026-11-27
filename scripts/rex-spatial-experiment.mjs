import { writeFileSync } from 'node:fs';
import { evaluate, trainer } from '../src/app/features/t-rex/spatial-learning.mjs';
const train = trainer(1938);
let best;
for (let i = 0; i < Number(process.argv[2] || 100); i++) best = train();
const pairs = [-0.2, -0.1, 0, 0.1, 0.2].map((lateralVelocity, i) => {
  const options = { lateralVelocity, friction: 0.65 + i * 0.08 };
  return {
    options,
    unlocked: evaluate(best.policy, options),
    locked: evaluate(best.policy, { ...options, locked: true }),
  };
});
writeFileSync(
  new URL('../src/app/features/t-rex/spatial-checkpoint.json', import.meta.url),
  JSON.stringify({ seed: 1938, ...best, pairs }, null, 2) + '\n',
);
console.log(JSON.stringify(pairs));
