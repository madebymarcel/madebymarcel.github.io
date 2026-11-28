# T. rex V2: continuous feedback experiment

V1 stays available and its checkpoints are untouched. V2 uses the same spatial
skeleton, collision geometry, tail, masses, position servos and rendering.
The experimental route is `/projects/t-rex-v2/`.

## Why another controller?

PR #62 already tried a 160-weight shared feedback policy and symmetric updates
on the unrestricted skeleton without demonstrating alternating steps. V2 is not
assumed to solve that failure. It isolates the extra lateral degrees of freedom
as a separate experimental condition. Planar mode constrains translation in Z
and rotation about X/Y using the physical engine's factors, with zero lateral
velocity at initialization. It is not evidence of unrestricted 3D walking.
Spatial mode has no such restrictions. The physical skeleton is not replaced.

The policy uses scaled torso, joint position/rate, centre-of-mass, heel/toe and
load observations, reflected across the two legs. Each joint has a bounded
position target from learned feedback. The tail and head also receive learned
feedback, sharing parameters within their respective groups. There is no phase
machine, scripted gait or injected forward propulsion. Commands update at 30 Hz;
the original 120 Hz physics solver executes them. Planar training masks inactive
spatial parameters. The policy starts at zero, and the two modes have separate
local-storage keys and independent policies. No V1 policy migration is possible.

The optimizer follows the working biped's ARS-style paired perturbations:
12 directions, 5 elite pairs, fixed 0.08 noise and normalized reward differences.
It maintains a centre policy separately from the best evaluated checkpoint.
Observation scales are fixed physical units rather than running normalization.
All 24 perturbations in an update use the same training scenario. The scenario
changes between updates. Workers evaluate candidates in parallel and only a
completed update plus evaluation is committed. Pausing discards incomplete work.

Reward caps credited instantaneous forward progress at 0.9 m/s, penalizes
velocity error, work, loaded slip, airborne time, lateral travel and falls.
Steps are independently detected using fixed thresholds and alternating forward
landings; they are not a reward multiplier or a gate that unlocks distance.

## Qualification and experimental evidence

Every qualified 12-second trial must travel at least 10 m, avoid falling, have
at least eight alternating steps, spend at least 85% of ticks upright, spend no
more than 15% of ticks airborne, have slip at most 25% of travel, and finish
within 0.5 m of the original lateral position. Three evaluation starts select
the replay champion by pass count first. Two additional holdout starts are
reserved for the final experimental report, never for policy updates or selection.
The UI labels planar and unrestricted modes explicitly; a planar pass is not
a spatial pass. Iterations mean ARS updates, not candidate evaluations.

Run locally, outside normal CI:

```sh
npm ci
node --test scripts/rex-v2.test.mjs
npm run experiment:rex-v2 -- planar 100 3 42 43
npm run experiment:rex-v2 -- spatial 100 3 42 43
```

Compare equal rollout budgets, individual seeds and holdout results. A separate
follow-up can test warm-starting spatial training from a qualified planar policy
versus starting from zero. Do not claim that the new trainer walks until the
unrestricted physical experiment qualifies. Normal CI contains only short
regression and physics smoke tests, not a convergence benchmark.
