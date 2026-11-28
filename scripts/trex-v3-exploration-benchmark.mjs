import { strict as assert } from 'node:assert';
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { DistanceTrainer } from '../src/app/features/t-rex-v3/distance-training';
import {
  collectRollouts,
  evaluateFrozenPolicy,
} from '../src/app/features/t-rex-v3/rollout-collection';

const seeds = [37, 91];
const evaluationSeeds = [103, 257, 1009];
const lanes = 4;
const perLane = 96;
const rounds = 2;
const horizon = 30;
const budget = lanes * perLane * rounds;

function inference(trainer) {
  const { learner } = trainer.checkpoint();
  return { actor: learner.actor.weights, critic: learner.critic.weights };
}

function evaluate(trainer) {
  const trials = evaluateFrozenPolicy(inference(trainer), evaluationSeeds, horizon);
  const valid = trials.every((trial) => trial.distanceM !== null);
  return {
    trials,
    meanDistanceM: valid
      ? trials.reduce((sum, trial) => sum + trial.distanceM, 0) / trials.length
      : null,
    meanSeconds: trials.reduce((sum, trial) => sum + trial.elapsed, 0) / trials.length,
  };
}

function runWorker(job) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: job });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error('Rollout worker exited: ' + code));
    });
  });
}

async function train(seed, correlation) {
  const trainer = new DistanceTrainer(seed, horizon, correlation);
  const timeline = [];
  for (let round = 0; round < rounds; round++) {
    const jobs = trainer.beginRound(lanes, perLane, true);
    const start = performance.now();
    const results = await Promise.all(jobs.map(runWorker));
    const wallSeconds = (performance.now() - start) / 1000;
    assert.equal(results.reduce((sum, result) => sum + result.attempts, 0), lanes * perLane);
    let frame = trainer.finishRound(results);
    timeline.push({
      round: round + 1,
      wallSeconds,
      stats: frame.stats,
      episodeLengths: results.flatMap((result) =>
        result.episodes.map((episode) => episode.elapsed),
      ),
    });
    console.log('BENCHMARK_ROUND ' + JSON.stringify({ seed, correlation, ...timeline.at(-1) }));
    while (frame.phase === 'evaluation') frame = trainer.advance(16, true);
    if (frame.phase === 'blocked') break;
  }
  const checkpoint = trainer.checkpoint();
  return {
    seed,
    correlation,
    budget,
    stats: checkpoint.stats,
    phase: trainer.frame().phase,
    evaluation: evaluate(trainer),
    timeline,
  };
}

async function main() {
  // Verify real worker execution returns the same complete records as sequential
  // collection for the same frozen policy and seeded workload. Include startup
  // overhead in both timings; speedup depends on actual CPU availability.
  const probe = new DistanceTrainer(37, horizon, 0.85);
  const jobs = probe.beginRound(lanes, 32, true);
  let start = performance.now();
  const serial = jobs.map((job) => collectRollouts(job));
  const serialSeconds = (performance.now() - start) / 1000;
  start = performance.now();
  const parallel = await Promise.all(jobs.map(runWorker));
  const parallelSeconds = (performance.now() - start) / 1000;
  assert.deepEqual(parallel, serial);
  console.log(
    'BENCHMARK_THROUGHPUT ' +
      JSON.stringify({
        availableCpus: availableParallelism(),
        lanes,
        decisions: lanes * 32,
        serialSeconds,
        parallelSeconds,
        speedup: serialSeconds / parallelSeconds,
      }),
  );

  const comparisons = [];
  for (const seed of seeds) {
    const initial = new DistanceTrainer(seed, horizon, 0);
    const initialPolicy = inference(initial);
    const passive = evaluateFrozenPolicy(
      { ...initialPolicy, actor: initialPolicy.actor.map(() => 0) },
      evaluationSeeds,
      horizon,
    );
    const baseline = evaluate(initial);
    const iid = await train(seed, 0);
    const correlated = await train(seed, 0.85);
    const delta =
      iid.evaluation.meanDistanceM !== null && correlated.evaluation.meanDistanceM !== null
        ? correlated.evaluation.meanDistanceM - iid.evaluation.meanDistanceM
        : null;
    const comparison = { seed, passive, initial: baseline, iid, correlated, delta };
    comparisons.push(comparison);
    console.log('BENCHMARK_COMPARISON ' + JSON.stringify(comparison));
  }
  const complete = comparisons.every(({ iid, correlated }) =>
    [iid, correlated].every(
      (run) => run.stats.actions === budget && run.stats.updates > 0 && run.phase !== 'blocked',
    ),
  );
  const wins = comparisons.filter(({ delta }) => delta !== null && delta > 0).length;
  console.log(
    'BENCHMARK_SUMMARY ' +
      JSON.stringify({ complete, wins, pairedSeeds: seeds.length, budget, comparisons }),
  );
  assert.ok(complete, 'Both modes must complete the matched attempted-action budget and update PPO');
}

if (isMainThread) {
  await main();
} else {
  parentPort.postMessage(collectRollouts(workerData));
}
