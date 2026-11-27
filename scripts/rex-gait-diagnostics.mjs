// Standalone, experimental harness. Never changes the production controller or checkpoint.
// Fixtures: exported trex-population-v5, iteration 1024, selected policies 401, 939, 1018.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate } from '../src/app/features/t-rex/servo-learning.mjs';

const fixtures = [
  {
    "iteration": 401,
    "policy": [
      -0.0659818848548457,
      0.02558506977334617,
      -0.023400145969353615,
      0.01561821458279155,
      0.4709059093991527,
      0.15201718013733626,
      1.4652247347403318,
      0.6648196375928819,
      -0.34235470434068704,
      -0.24340330669656396,
      0.620290198775474,
      0.49622038032393906,
      -0.4828549513360485,
      0.46318219406530264,
      -0.0013701415184186744,
      0.4011433043051511,
      -0.01877199037000537,
      -0.32532688143812494,
      0.16392811181140132,
      0,
      -0.0024071976682171225,
      -0.00008250727867002377,
      -0.03367777222301811,
      0.005683034564368428,
      0.00014935805365429044,
      0.05433239266986043,
      -0.07599825545874266,
      0,
      0.07,
      0.02519870641018419,
      0.05,
      0
    ],
    "expected": [
      [
        879,
        true,
        0.963118912481042,
        8,
        0.6658133735216858,
        841,
        8
      ],
      [
        316,
        true,
        0.4042659504201171,
        4,
        0.37701087790447124,
        250,
        6
      ],
      [
        324,
        true,
        0.1907048208580644,
        4,
        0.3862104528128982,
        249,
        6
      ]
    ]
  },
  {
    "iteration": 939,
    "policy": [
      -0.0659818848548457,
      0.019839279031075574,
      -0.023400145969353615,
      0.015466887231796613,
      0.4709059093991527,
      0.15201718013733626,
      1.4652247347403318,
      0.6648196375928819,
      -0.34235470434068704,
      -0.24439273925546606,
      0.6146877089011881,
      0.4969236415179758,
      -0.48265878905095433,
      0.46318219406530264,
      -0.0013701415184186744,
      0.4011433043051511,
      -0.01779292678316769,
      -0.32727017853429036,
      0.16392811181140132,
      0,
      -0.0024071976682171225,
      -0.0006235046072559689,
      -0.03367777222301811,
      0.003960944507747716,
      0.00019008126635699065,
      0.05447771463216341,
      -0.0759630471314905,
      0.0055898220961771794,
      0.07,
      0.025086304936471827,
      0.05,
      0
    ],
    "expected": [
      [
        384,
        true,
        0.14871379629658316,
        5,
        0.4529665179649753,
        304,
        6
      ],
      [
        720,
        false,
        0.3983027469301376,
        7,
        0.5344603056489643,
        720,
        8
      ],
      [
        471,
        true,
        0.6435420051406158,
        4,
        0.37150779621856184,
        455,
        7
      ]
    ]
  },
  {
    "iteration": 1018,
    "policy": [
      -0.0659818848548457,
      0.06368942074999212,
      -0.023400145969353615,
      0.01561821458279155,
      0.47165674113978256,
      0.15201718013733626,
      1.4652247347403318,
      0.6648196375928819,
      -0.34235470434068704,
      -0.18193170981604462,
      0.620290198775474,
      0.49622038032393906,
      -0.4828549513360485,
      0.46318219406530264,
      0.02871700077375863,
      0.4010010714176091,
      -0.018712665118426588,
      -0.317646962358057,
      0.16392811181140132,
      -0.008761977799236775,
      -0.0024071976682171225,
      -0.0011112508407092254,
      -0.03367777222301811,
      0.005208346589106733,
      0.007071889920700347,
      0.05433239266986043,
      -0.07599198287073523,
      0.00013060974585823716,
      0.06944558845060368,
      0.02599162241819661,
      0.05158793479395882,
      -0.00028673193519083555
    ],
    "expected": [
      [
        306,
        true,
        0.6236067109142229,
        3,
        0.2647371977865758,
        280,
        6
      ],
      [
        298,
        true,
        0.6049988773923545,
        3,
        0.2515540224790086,
        276,
        6
      ],
      [
        493,
        true,
        0.7775905416124644,
        5,
        0.4146912505553465,
        478,
        7
      ]
    ]
  }
];
const scenarios = [
  { seconds: 12 },
  { seconds: 6, startSplit: 0.04 },
  { seconds: 6, startSplit: 0.05, lateralVelocity: 0.015 },
];
const metricKeys = ['ticks', 'fell', 'distance', 'steps', 'slip', 'stableTicks', 'supportTicks'];
const continuous = new Set(['distance', 'slip']);
const sourceURL = new URL('../src/app/features/t-rex/servo-learning.mjs', import.meta.url);
const rigURL = new URL('./servo-rig.mjs', sourceURL).href;
const source = readFileSync(sourceURL, 'utf8');
const replaceOnce = (input, from, to) => {
  assert.equal(input.split(from).length, 2, 'Expected exactly one source anchor: ' + from);
  return input.replace(from, to);
};

const instrumented = replaceOnce(
  replaceOnce(source, "'./servo-rig.mjs'", JSON.stringify(rigURL)),
  '    if (fell) return;\n    slip +=',
  '    options.observe?.({ rig, ticks, phase, swing, loads, contacts, bodyContact, fell });\n    if (fell) return;\n    slip +=',
);

const variants = [
  ['baseline', instrumented],
  [
    'weight-transfer-only',
    replaceOnce(
      instrumented,
      'loads[support] > p[4] && Math.abs(desiredZ - comZ) < p[5]',
      'loads[support] > Math.max(0.7, p[4]) && loads[swing] < 0.3 && Math.abs(desiredZ - comZ) < p[5]',
    ),
  ],
  [
    'stance-longitudinal-reference-only',
    replaceOnce(
      instrumented,
      'const desiredX = (feet[support].position.x + feet[swing].position.x) / 2;',
      'const desiredX = phase >= 2 ? feet[support].position.x : (feet[support].position.x + feet[swing].position.x) / 2;',
    ),
  ],
  [
    'transfer-momentum-only',
    replaceOnce(
      instrumented,
      'Math.abs(desiredZ - comZ) < p[5]',
      'Math.abs(desiredZ - (comZ + 0.15 * comVz)) < p[5]',
    ),
  ],
];

function snapshot({ rig, ticks, phase, swing, loads, contacts, bodyContact, fell }) {
  const com = [0, 0, 0];
  const momentum = [0, 0, 0];
  let mass = 0;
  const vec = (v) => [v.x, v.y, v.z];
  for (const { body } of rig.bones) {
    mass += body.mass;
    vec(body.position).forEach((v, i) => { com[i] += v * body.mass; });
    vec(body.velocity).forEach((v, i) => { momentum[i] += v * body.mass; });
  }
  return {
    ticks, phase, swing, fell, bodyContact, loads: [...loads], contacts: [...contacts],
    com: com.map((v) => v / mass), momentum,
    up: vec(rig.trunk.body.vectorToWorldFrame(rig.up)),
    feet: rig.bones.filter((b) => b.name.startsWith('toes')).map(({ name, body }) => ({
      name, position: vec(body.position), velocity: vec(body.velocity),
    })),
    joints: rig.observeJoints().map(({ angle }, i) => ({
      name: rig.motors[i].joint.name, angle,
      motorForce: rig.motors[i].items.map(({ axis, motor }) => ({ axis, force: motor.multiplier })),
    })),
  };
}

function passes(metrics, seconds) {
  return !metrics.fell &&
    metrics.ticks >= seconds * 120 &&
    metrics.stableTicks >= metrics.ticks * 0.85 &&
    metrics.distance >= seconds * 0.3 &&
    metrics.steps >= Math.ceil(seconds * 0.67) &&
    metrics.slip <= metrics.distance * 0.3 &&
    metrics.flightTicks <= metrics.ticks * 0.15;
}

function assertMetrics(actual, expected, label) {
  for (const [i, key] of metricKeys.entries()) {
    if (continuous.has(key)) {
      assert.ok(Math.abs(actual[key] - expected[i]) <= 1e-8 * Math.max(1, Math.abs(expected[i])),
        label + ': ' + key + ' expected ' + expected[i] + ', got ' + actual[key]);
    } else {
      assert.equal(actual[key], expected[i], label + ': ' + key);
    }
  }
}

// Stage 1: reproduce the exported outcomes without instrumentation or controller edits.
for (const fixture of fixtures) {
  for (const [i, scenario] of scenarios.entries()) {
    const metrics = evaluate(fixture.policy, scenario);
    console.log('REPRODUCTION ' + JSON.stringify({ iteration: fixture.iteration, scenario: i, metrics }));
    assertMetrics(metrics, fixture.expected[i], 'original ' + fixture.iteration + '/' + i);
  }
}
console.log('REPRODUCTION PASS: 9/9 exported trials matched');

const results = [];
const traces = [];
for (const [variant, text] of variants) {
  // Source copies are kept in memory; all variants use exactly the same physics rig.
  const { trial } = await import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
  for (const fixture of fixtures) {
    for (const [i, scenario] of scenarios.entries()) {
      const trace = [];
      let lastPhase = -1;
      const run = trial(fixture.policy, {
        ...scenario,
        observe: (state) => {
          if (state.phase !== lastPhase || state.ticks % 6 === 0 || state.fell) {
            trace.push(snapshot(state));
            if (trace.length > 12) trace.shift();
          }
          lastPhase = state.phase;
        },
      });
      while (!run.done) run.advance();
      const metrics = run.metrics();
      if (variant === 'baseline') assertMetrics(metrics, fixture.expected[i], 'instrumented ' + fixture.iteration + '/' + i);
      const row = { variant, iteration: fixture.iteration, scenario: i, metrics, passes: passes(metrics, scenario.seconds) };
      results.push(row);
      traces.push({ variant, iteration: fixture.iteration, scenario: i, samples: trace });
      console.log('TRIAL ' + JSON.stringify(row));
      if (metrics.fell) {
        const last = trace.at(-1);
        console.log('FALL ' + JSON.stringify({
          variant, iteration: fixture.iteration, scenario: i, ticks: last.ticks,
          phase: last.phase, swing: last.swing, loads: last.loads, com: last.com,
          momentum: last.momentum, up: last.up, feet: last.feet, bodyContact: last.bodyContact,
        }));
      }
    }
  }
}

for (const [variant] of variants) {
  const rows = results.filter((r) => r.variant === variant);
  const mean = (get) => rows.reduce((sum, r) => sum + get(r), 0) / rows.length;
  console.log('SUMMARY ' + JSON.stringify({
    variant, trials: rows.length, falls: rows.filter((r) => r.metrics.fell).length,
    acceptancePasses: rows.filter((r) => r.passes).length,
    meanForwardMetersPerSecond: mean((r) => r.metrics.distance / scenarios[r.scenario].seconds),
    meanStableFraction: mean((r) => r.metrics.stableTicks / (120 * scenarios[r.scenario].seconds)),
    meanSteps: mean((r) => r.metrics.steps),
    meanSlip: mean((r) => r.metrics.slip),
    meanSupportTicks: mean((r) => r.metrics.supportTicks),
  }));
}
writeFileSync('rex-diagnostic-results.json', JSON.stringify({ results, traces }, null, 2));
// A variant is not a fix unless a single policy meets every acceptance condition.
// A successful screen still requires new holdout disturbances before deployment.
const passing = variants.flatMap(([variant]) => fixtures.filter((f) =>
  results.filter((r) => r.variant === variant && r.iteration === f.iteration).every((r) => r.passes),
).map((f) => ({ variant, iteration: f.iteration })));
console.log('ACCEPTANCE ' + JSON.stringify({ passing, deployable: false, reason: 'Independent holdout validation required' }));
