import { registerHooks } from 'node:module';
import { extname } from 'node:path';

const budget = process.argv[2] === undefined ? 24000 : Number(process.argv[2]);
if (!Number.isSafeInteger(budget) || budget < 1) {
  throw new Error('Provide a positive integer training tick budget per seed and arm.');
}
// Resolve the application's extensionless TypeScript imports in this standalone Node process.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const relativeTs =
      context.parentURL?.endsWith('.ts') && specifier.startsWith('.') && !extname(specifier);
    return nextResolve(relativeTs ? `${specifier}.ts` : specifier, context);
  },
});
const { runCanoeExperiment } =
  await import('../src/app/features/canoe-polo/training-experiment.ts');
runCanoeExperiment(budget, (row) => console.log(JSON.stringify(row)));
