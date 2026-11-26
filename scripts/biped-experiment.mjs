import { registerHooks } from 'node:module';
import { extname } from 'node:path';

const args = process.argv.slice(2);
const course = args.includes('--parkour');
const [count, ...seedArgs] = args.filter((arg) => arg !== '--parkour');
const iterations = Number(count ?? 120);
const seeds = (seedArgs.length ? seedArgs : ['42', '43', '44']).map(Number);
if (
  !Number.isSafeInteger(iterations) ||
  iterations < 1 ||
  seeds.some((seed) => !Number.isInteger(seed) || seed < 1 || seed > 0xffffffff)
) {
  throw new Error(
    'Usage: npm run experiment:biped -- <positive iterations> [seed ...] [--parkour]',
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relativeTs =
      context.parentURL?.endsWith('.ts') && specifier.startsWith('.') && !extname(specifier);
    return nextResolve(relativeTs ? `${specifier}.ts` : specifier, context);
  },
});
const { Trainer, better } = await import('../src/app/features/biped/training.ts');
const { SKILLS } = await import('../src/app/features/biped/tasks.ts');
const { Parkour } = await import('../src/app/features/biped/course.ts');

for (const seed of seeds) {
  const book = {};
  for (const skill of course ? SKILLS : ['walk']) {
    const trainer = new Trainer(seed, skill, book.walk?.policy);
    for (let iteration = 0; iteration <= iterations; iteration++) {
      if (iteration % 5 === 0 || iteration === iterations) {
        const current = trainer.checkpoint();
        console.log(JSON.stringify({ seed, skill, iteration, ...current.evaluation }));
        if (better(current, book[skill], skill)) book[skill] = current;
        if (course && skill !== 'run' && current.evaluation.passes === 5) break;
      }
      if (iteration < iterations) trainer.train();
    }
  }
  if (course) {
    const test = new Parkour(book);
    while (!test.done) test.step();
    console.log(
      JSON.stringify({
        seed,
        parkour: test.result(),
        distance: test.sim.distance,
        checkpoints: Object.fromEntries(
          SKILLS.map((skill) => [
            skill,
            {
              iteration: book[skill].iteration,
              passes: book[skill].evaluation.passes,
            },
          ]),
        ),
      }),
    );
  }
}
