import { strict as assert } from 'node:assert';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { assessCapabilities } from '../src/app/features/t-rex-v3/capability-audit';
import { collectDepRollouts } from '../src/app/features/t-rex-v3/dep-rollout';
import { DepTrainer, WARMUP } from '../src/app/features/t-rex-v3/dep-training';

const seeds = [37, 91, 173];
const horizon = 5;
const attemptsPerSeed = 192;

function runWorker(job) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: job });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error('DEP worker exited: ' + code));
    });
  });
}

function summarize(episodes) {
  const valid = episodes.filter((run) => run.distanceM !== null);
  const max = (key) => Math.max(0, ...valid.map((run) => run.capability[key]));
  return {
    gate: assessCapabilities(episodes),
    meanSeconds: valid.length
      ? valid.reduce((sum, run) => sum + run.elapsed, 0) / valid.length
      : null,
    meanDistanceM: valid.length
      ? valid.reduce((sum, run) => sum + run.distanceM, 0) / valid.length
      : null,
    longestStableSeconds: max('longestStableSeconds'),
    longestSupportedSeconds: max('longestSupportedSeconds'),
    leftLifts: max('leftLifts'),
    rightLifts: max('rightLifts'),
    weightTransfers: max('weightTransfers'),
    leftSteps: max('leftSteps'),
    rightSteps: max('rightSteps'),
    alternatingSteps: max('alternatingSteps'),
    counterRotationSeconds: max('counterRotationSeconds'),
  };
}

async function capabilityAudit() {
  const comparisons = [];
  for (const exploration of ['zero', 'iid', 'dep']) {
    const results = await Promise.all(
      seeds.map((seed, lane) => runWorker({
        brain: 'dep',
        round: 1,
        lane,
        seed,
        horizon,
        minimumActions: attemptsPerSeed,
        exactBudget: true,
        exploration,
        depState: null,
        policy: null,
      })),
    );
    assert.ok(results.every((result) => result.attempts === attemptsPerSeed));
    const records = results.map((result, i) => ({
      seed: seeds[i],
      attempts: result.attempts,
      ...summarize(result.episodes),
    }));
    const combined = summarize(results.flatMap((result) => result.episodes));
    const comparison = { exploration, records, combined };
    comparisons.push(comparison);
    console.log('V3_DEP_CAPABILITY ' + JSON.stringify(comparison));
  }
  const dep = comparisons.find((item) => item.exploration === 'dep');
  console.log('V3_DEP_GATE ' + JSON.stringify(dep.combined.gate));
  return dep.combined.gate;
}

async function learnerAudit(gate) {
  // Explicitly experimental when pure DEP has not passed. Exercise the real
  // coordinator with its production warmup, not a fabricated replay fixture.
  const trainer = new DepTrainer(37, horizon, 'dep-mpo');
  const timeline = [];
  let mixedRound = false;
  for (let round = 0; round < 6; round++) {
    const jobs = trainer.beginRound(4, 256, true);
    const mixed = jobs[0].exploration === 'mixed';
    const results = await Promise.all(jobs.map(runWorker));
    let frame = trainer.finishRound(results);
    while (frame.phase === 'evaluation') frame = trainer.advance(16);
    const record = {
      round: round + 1,
      mixed,
      phase: frame.phase,
      stats: frame.stats,
      replaySize: frame.replaySize,
      depDecisions: frame.depDecisions,
      latestEvaluationSeconds: frame.latestEvaluationSeconds,
      bestEvaluationSeconds: frame.bestEvaluationSeconds,
      gate: frame.gate,
      bestCapability: frame.bestCapability,
      sampledTransitions: frame.sampledTransitions,
      message: frame.message,
    };
    timeline.push(record);
    console.log('V3_MPO_ROUND ' + JSON.stringify(record));
    if (mixed) {
      mixedRound = true;
      assert.ok(results.some((result) => result.episodes.some((run) =>
        run.experiences.some((item) => item.source === 'policy'),
      )), 'Mixed rollout must collect actual policy-generated actions');
    }
    if (frame.phase === 'blocked' || mixedRound) break;
  }
  const saved = trainer.checkpoint();
  const restored = DepTrainer.restore(JSON.parse(JSON.stringify(saved)));
  const roundTrip = restored.checkpoint();
  assert.deepEqual(roundTrip.learner, saved.learner);
  assert.deepEqual(roundTrip.replay, saved.replay);
  assert.deepEqual(roundTrip.stats, saved.stats);
  assert.deepEqual(roundTrip.depStates, saved.depStates);
  assert.deepEqual(roundTrip.history, saved.history);
  const learned = saved.stats.updates > 0 && mixedRound;
  console.log('V3_MPO_SUMMARY ' + JSON.stringify({
    pureDepValidated: gate.passed,
    warmup: WARMUP,
    learned,
    mixedRound,
    blocked: trainer.frame().phase === 'blocked',
    timeline,
  }));
  // A blocked physics run is a valid diagnostic outcome, not a walking
  // success. If enough valid replay exists, require actual optimizer updates.
  if (saved.replay.count >= WARMUP && trainer.frame().phase !== 'blocked') {
    assert.ok(saved.stats.updates > 0 && mixedRound, 'MPO must update and collect a mixed round');
  }
}

if (isMainThread) {
  const gate = await capabilityAudit();
  await learnerAudit(gate);
} else {
  parentPort.postMessage(collectDepRollouts(workerData));
}
