import { writeFileSync } from 'node:fs';
import { dimension, evaluate, generator } from '../src/app/features/t-rex/spatial-learning.mjs';

// Search symmetric posture biases and trunk feedback gains for the hips, knees and ankles.
// All coefficients start at zero. Training changes joint torque only.
const seed = 845,
  random = generator(seed);
const entries = [];
for (const joint of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
  entries.push([(joint * 2 + 1) * 9, 0.45]);
  if (joint >= 8) {
    entries.push([(joint * 2 + 1) * 9 + 1, 10], [(joint * 2 + 1) * 9 + 4, 7]);
  }
}
entries.push([16 * 9 + 2, 12], [16 * 9 + 3, 9], [16 * 9, 0.25]);
const starts = [{}, { lateralVelocity: -0.06 }, { lateralVelocity: 0.06 }];
const count = Number(process.argv[2] || 1500);
let best = Array(dimension).fill(0);
function fitness(policy) {
  const values = starts.map((s) => {
    const m = evaluate(policy, s);
    return m.ticks / 120 - 1.5 * Math.abs(m.distance);
  });
  return 0.7 * Math.min(...values) + (0.3 * values.reduce((a, b) => a + b)) / values.length;
}
let score = fitness(best);
for (let i = 0; i < count; i++) {
  const candidate = best.slice(),
    amplitude = [0.01, 0.05, 0.25, 1, 2][i % 5];
  for (const [k, scale] of entries)
    if (random() < 0.22) candidate[k] += (2 * random() - 1) * scale * amplitude;
  const value = fitness(candidate);
  if (value > score) {
    score = value;
    best = candidate;
  }
}
const results = [
  {},
  ...[-0.2, -0.1, 0, 0.1, 0.2].map((lateralVelocity, i) => ({
    lateralVelocity,
    friction: 0.65 + i * 0.08,
  })),
].map((options) => ({ options, ...evaluate(best, options) }));
writeFileSync(
  new URL('../src/app/features/t-rex/spatial-standing.json', import.meta.url),
  JSON.stringify({ seed, candidates: count, policy: best, results }, null, 2) + '\n',
);
console.log(results);
