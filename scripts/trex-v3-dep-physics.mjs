import { strict as assert } from 'node:assert';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { BalanceEnvironment } from '../src/app/features/t-rex-v3/balance-environment';
import { collectDepRollouts } from '../src/app/features/t-rex-v3/dep-rollout';

const settings = [
  { name: 'baseline', timestep: 1 / 480, iterations: 100 },
  { name: 'iterations', timestep: 1 / 480, iterations: 300 },
  { name: 'substeps', timestep: 1 / 960, iterations: 100 },
  { name: 'both', timestep: 1 / 960, iterations: 300 },
];
const rounds = 3;
const minimumActions = 192;

function reproduce(witness, physics) {
  const env = new BalanceEnvironment(5, true, physics);
  let state = env.reset(witness.resetSeed);
  const peak = { gapM: 0, excessDegrees: 0, penetrationM: 0 };
  for (const action of witness.actions) {
    if (state.reason !== 'running') break;
    state = env.step(action);
    const snapshot = env.snapshot();
    peak.gapM = Math.max(peak.gapM, snapshot.jointGap);
    peak.excessDegrees = Math.max(peak.excessDegrees, snapshot.angleExcess);
    peak.penetrationM = Math.max(peak.penetrationM, snapshot.penetration);
  }
  return { reason: state.reason, elapsed: state.elapsed, peak, fault: state.physicsFault ?? null };
}

function summarize(episodes) {
  const counts = {};
  const locations = {};
  for (const episode of episodes) {
    const fault = episode.physicsFault;
    if (!fault) continue;
    for (const kind of fault.kinds) {
      counts[kind] = (counts[kind] ?? 0) + 1;
      const id =
        kind === 'joint-gap'
          ? fault.gapJoint
          : kind === 'angle-limit'
            ? fault.limitJoint + ':' + fault.limitAxis
            : kind === 'ground-penetration'
              ? fault.groundBody
              : 'unknown';
      const key = kind + ':' + id;
      locations[key] = (locations[key] ?? 0) + 1;
    }
  }
  return {
    episodes: episodes.length,
    invalid: episodes.filter((episode) => episode.reason === 'invalid').length,
    counts,
    locations,
    faults: episodes.flatMap((episode) => (episode.physicsFault ? [episode.physicsFault] : [])),
  };
}

function collectLane(lane, physics, capture) {
  let depState = null;
  const episodes = [];
  const witnesses = [];
  const started = performance.now();
  for (let round = 1; round <= rounds; round++) {
    const seed = (37 ^ Math.imul(round, 0x9e3779b9) ^ Math.imul(lane + 1, 0x85ebca6b)) >>> 0;
    const result = collectDepRollouts(
      {
        brain: 'dep',
        round,
        lane,
        seed,
        horizon: 5,
        minimumActions,
        exactBudget: true,
        exploration: 'dep',
        depState,
        policy: null,
        physics,
      },
      undefined,
      capture
        ? (witness) => {
            if (witnesses.length < 3) witnesses.push(witness);
          }
        : undefined,
    );
    episodes.push(...result.episodes.map(({ experiences: _experiences, ...episode }) => episode));
    depState = result.depState;
  }
  const report = summarize(episodes);
  const elapsed = (performance.now() - started) / 1000;
  return { lane, report, elapsed, witnesses };
}

function worker(payload) {
  return new Promise((resolve, reject) => {
    const instance = new Worker(new URL(import.meta.url), { workerData: payload });
    instance.once('message', resolve);
    instance.once('error', reject);
    instance.once('exit', (code) => {
      if (code !== 0) reject(new Error('Diagnostic worker exited: ' + code));
    });
  });
}

if (isMainThread) {
  const baseline = await Promise.all(
    [0, 1, 2, 3].map((lane) =>
      worker({ kind: 'collect', lane, physics: settings[0], capture: true }),
    ),
  );
  const witnesses = baseline.flatMap((lane) => lane.witnesses);
  console.log(
    'DEP_PHYSICS_BASELINE ' +
      JSON.stringify(baseline.map(({ witnesses: _witnesses, ...lane }) => lane)),
  );
  assert.ok(witnesses.length > 0, 'Known DEP fault must be reproduced');
  const comparisons = await Promise.all(
    settings.map((physics) => worker({ kind: 'replay', physics, witnesses })),
  );
  for (const comparison of comparisons)
    console.log('DEP_PHYSICS_REPLAY ' + JSON.stringify(comparison));
  assert.equal(
    comparisons[0].reproduced,
    witnesses.length,
    'Exact baseline replay must reproduce each fault',
  );
  const ranked = comparisons.slice(1).sort((a, b) => b.valid - a.valid || a.seconds - b.seconds);
  const selected = ranked[0];
  console.log(
    'DEP_PHYSICS_CANDIDATE ' +
      JSON.stringify({
        selected: selected.physics,
        valid: selected.valid,
        total: witnesses.length,
      }),
  );
  const candidate = await Promise.all(
    [0, 1, 2, 3].map((lane) =>
      worker({ kind: 'collect', lane, physics: selected.physics, capture: false }),
    ),
  );
  console.log('DEP_PHYSICS_CLOSED_LOOP ' + JSON.stringify(candidate));
  const baseEpisodes = baseline.reduce((sum, lane) => sum + lane.report.episodes, 0);
  const baseInvalid = baseline.reduce((sum, lane) => sum + lane.report.invalid, 0);
  const newEpisodes = candidate.reduce((sum, lane) => sum + lane.report.episodes, 0);
  const newInvalid = candidate.reduce((sum, lane) => sum + lane.report.invalid, 0);
  console.log(
    'DEP_PHYSICS_SUMMARY ' +
      JSON.stringify({
        baseEpisodes,
        baseInvalid,
        newEpisodes,
        newInvalid,
        baselineInvalidRate: baseInvalid / baseEpisodes,
        candidateInvalidRate: newInvalid / newEpisodes,
        candidate: selected.physics,
        witnessCount: witnesses.length,
        witnessRepairs: selected.valid,
      }),
  );
} else if (workerData.kind === 'collect') {
  parentPort.postMessage(collectLane(workerData.lane, workerData.physics, workerData.capture));
} else {
  const started = performance.now();
  const results = workerData.witnesses.map((witness) => ({
    original: witness.fault,
    replay: reproduce(witness, workerData.physics),
  }));
  parentPort.postMessage({
    physics: workerData.physics,
    valid: results.filter(({ replay }) => replay.reason !== 'invalid').length,
    reproduced: results.filter(
      ({ original, replay }) =>
        replay.reason === 'invalid' && JSON.stringify(original) === JSON.stringify(replay.fault),
    ).length,
    seconds: (performance.now() - started) / 1000,
    results,
  });
}
