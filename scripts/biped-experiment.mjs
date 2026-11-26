import { registerHooks } from 'node:module';
import { extname } from 'node:path';

const iterations = Number(process.argv[2] ?? 120);
const seeds = (process.argv.slice(3).length ? process.argv.slice(3) : ['42', '43', '44']).map(
  Number,
);
if (
  !Number.isSafeInteger(iterations) ||
  iterations < 1 ||
  seeds.some((seed) => !Number.isInteger(seed) || seed < 1 || seed > 0xffffffff)
) {
  throw new Error('Usage: npm run experiment:biped -- <positive iterations> [seed ...]');
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relativeTs =
      context.parentURL?.endsWith('.ts') && specifier.startsWith('.') && !extname(specifier);
    return nextResolve(relativeTs ? `${specifier}.ts` : specifier, context);
  },
});
const { Trainer } = await import('../src/app/features/biped/training.ts');
for (const seed of seeds) {
  const trainer = new Trainer(seed);
  for (let iteration = 0; iteration <= iterations; iteration++) {
    if (iteration % 5 === 0 || iteration === iterations) {
      console.log(JSON.stringify({ seed, iteration, ...trainer.checkpoint().evaluation }));
    }
    if (iteration < iterations) trainer.train();
  }
}
