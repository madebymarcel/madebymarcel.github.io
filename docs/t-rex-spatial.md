# T. rex balance and walking experiment

Rebuild the walking experiment around a free spatial skeleton. Learn internal joint controls from scratch, track upright time and alternating forward footfalls, and test whether an articulated tail changes those outcomes. The overhead SVG and side diagnostic project one simulation.

## Anatomy and approximations

Hutchinson and colleagues reconstructed segment dimensions and mass distribution from scanned skeletons. Their reconstructions inform the large trunk and proximal hindlimbs and the decreasing bulk toward the tail tip. The authors report appreciable uncertainty from reconstructing soft tissues. [Hutchinson et al., 2011](https://doi.org/10.1371/journal.pone.0026037)

Van Bijlert and colleagues reconstructed a vertebral chain with passive elastic suspension and studied its vertical oscillation. Here six groups stand in for many caudal vertebrae. The model permits lateral bending as an experimental degree of freedom. The angular limits, stiffness, torque capacity and lateral control are engineering assumptions. [Van Bijlert et al., 2021](https://doi.org/10.1098/rsos.201441)

The 17 rigid bodies comprise a combined trunk/pelvis, neck, skull, six tapering tail bodies and two legs with thigh, shin, metatarsus and grouped toes. The simulation uses a hip height near one metre, box inertia, lumped masses, finite joint travel and bounded equal-and-opposite torque. Absolute masses, outlines and limb proportions are illustrative. Foot-ground friction and gravity act on a free root. Self-collision and individual toe joints are omitted.

## Reproduction

Use Node 24 and run these commands from the checkout.

```sh
npm ci
node --test scripts/rex-spatial.test.mjs
node scripts/rex-spatial-experiment.mjs 650 211
node scripts/rex-spatial-refine.mjs 1300
node scripts/rex-spatial-stand.mjs 1300
npm run build
npx playwright test tests/t-rex.spec.js --project=desktop-chromium --project=mobile-chromium
```

The experiment uses seed 211 to generate a fresh feedback policy and hill-climb its weights. Inputs include trunk tilt, angular velocity and foot contact. A shared bilateral hindlimb policy receives opposite phases of a clock with learned frequency. Training determines the sign and amplitude of leg commands. Tail and neck commands depend only on sensed state. Each joint combines the learned command with passive local stiffness and damping. Browser training starts independently with seed 536. The trial clock advances at 120 Hz and ends at five seconds or a fall. Trunk height, tilt or non-limb ground contact can end a trial. A counted step requires an airborne interval of six ticks, alternating contact, and a landing at least 5 cm ahead of the last accepted landing. The first accepted landing establishes the baseline.

The JSON checkpoint contains every paired evaluation with elapsed ticks, fall flag, signed trunk displacement and alternating step count. The five lateral velocity/friction combinations are excluded from candidate selection. The locked case replaces all six tail joints with rigid locks and preserves every segment's mass and starting pose. A successful sustained walk requires surviving the five seconds and several forward alternating steps. Individual reported footfalls during collapse are insufficient evidence.

## Persistent locomotion workbench

The browser now trains an expanded 529-weight feedback controller in waves of eight candidates.
Each candidate is evaluated in three starts, with different friction and lateral velocity.
A fixed proposal order makes a completed wave independent of worker count and completion order.
The policy uses joint displacement and angular rate, centre-of-mass offset from foot support,
foot position and estimated normal contact force, trunk velocity, and commanded speed and heading.
Only internal torque drives the simulation. The tail remains articulated and massive.
Separated leg and distal-tail collision groups interact; adjacent overlapping collision boxes
are deliberately excluded, so this is selective self-collision rather than full mesh collision.

Balance, counterbalance, weight transfer, stepping, walking, running, and turning/stopping
are successive skills. Advancing requires all three tests to pass. A run needs alternating
airborne strides, not just forward displacement. A fall disqualifies a trial.
The old 217-weight demonstrations remain available as explicitly historical baselines.
The new curriculum is experimental: passing these tests demonstrates performance on these
conditions only, and a trained walking or running policy is not guaranteed by implementing a trainer.

A compact checkpoint includes the policy version, RNG state, candidate and physics-step counters,
each skill's champion, 40 recent improvements, and personal records with exact replay conditions.
Completed waves are saved to localStorage every two seconds and on pause or leaving the page.
An unfinished wave is discarded on navigation and deterministically proposed again on resume.
Export/import uses the same versioned format. Export a backup before clearing browser data.
Concurrent tabs should not train the same local checkpoint.

For a reproducible headless experiment, run:

```sh
node scripts/rex-locomotion.mjs 100 rex-training.json
```

The output file can be imported into the browser. Rerunning the command resumes it.
Candidate rates now refer to three trials per candidate, so compare physics steps per second
rather than comparing the new candidate counter directly with the legacy single-trial trainer.

## Interactive workbench and adaptive search

Each skill can be selected directly. The current wave finishes before a requested
skill switch takes effect. A skill keeps its own champion, competing policies,
and improvement counters. Automatic progression is opt-in. Manual training stops
when a previously incomplete skill passes all three scenarios; starting it again
refines the completed skill. Selecting a historical policy supplies a new search
seed without replacing the champion.

The inspector and optimizer use the same qualification criteria and thresholds.
It displays the exact measurements for all three trial conditions, and each
condition can be replayed independently. The main viewer shows both projections
and optionally replays new best policies while the workers continue training.
This is replay of a completed candidate, not the worker's live simulation.

Search retains up to twelve parents per skill, including overall leaders,
scenario specialists and diverse policies. Candidates alternate local mutations,
other parents, recombination and broader exploration. Within the same pass count,
the worst and mean normalized qualification deficits take priority over fitness.
After 256 candidates without improvement, the optimizer increases exploration
and periodically refreshes the competing population while keeping the champion.
Earlier checkpoint files remain importable; per-skill statistics start with the
new implementation, because old checkpoints do not record exact per-skill counts.

To compare optimizers at the same candidate budget, initial state and seed:

```sh
node scripts/rex-locomotion-benchmark.mjs both 3504 536
```

The benchmark keeps balance selected even after success and reports first passing
candidate, best pass count, deficit, elapsed time and physics steps per second.
It does not lower the qualification thresholds. Walking and running still require
their own successful physical trials; a benchmark or passing CI is not evidence
that those skills have been mastered.
