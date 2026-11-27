# T. rex locomotion

The page continuously replays the best physically evaluated policy, including while training is
paused. Start/pause, export and the iteration counter are unchanged. New policies appear at the next
replay boundary. No training modes or new visual controls are exposed.

## Physical model and learning objective

The 17-body spatial skeleton, solver, motor limits, collision shapes and six-segment articulated tail
are unchanged. The feedback controller still uses real load, foot contact, centre of mass and trunk
attitude. Its 28 original weights are extended by four bounded, learnable parameters: swing travel,
clearance, landing placement and fore-aft centre-of-mass bias. Their defaults reproduce the v4
controller exactly.

Fitness is based on upright forward displacement, stable time, effective single-foot support,
contact-point slip, lateral drift, work and falls. The total bonus for counting steps is capped at
0.3, rather than awarding five points per step. Steps remain a diagnostic and milestone.

Each candidate is evaluated on three deterministic, comparable trials: a 12-second nominal trial
and two six-second variations of stance split, one with a small lateral disturbance. Each ends
immediately on a fall. The scores are normalized to the nominal duration and combined with a
worst-variation term. A bounded eight-member population retains complementary leaders for robust
fitness, progress, traction, support, stride and stability. Candidates include tiny local mutations,
broader exploration of archive parents and occasional recombination. Local mutation size adapts
to measured parent-improvement rate; broad exploration is separate. The displayed champion is
protected against substantial regressions in nominal travel and survival.

The v5 checkpoint uses the existing storage key. V4 policies are migrated by appending the four
default gait parameters and replaying their best and milestone weights under the new evaluation.
The iteration count and RNG are retained; old incompatible scores are not compared with new scores.
A copy of the previous checkpoint is kept under the legacy-backup key.

Sustained walking is credited only when the nominal 12-second trial and both six-second variations
complete without a fall, with average forward speed at least 0.3 m/s, bounded sliding and airborne
time, stable body attitude and alternating forward landings. The initial seed is still only a
stepping policy, not a claim of robust walking.

## Development verification

```sh
node --test scripts/rex-servo.test.mjs
node scripts/rex-servo-experiment.mjs 10 3
# Or continue from a browser export:
node scripts/rex-servo-experiment.mjs 10 3 /path/to/checkpoint.json
```

Unit tests check the real seed replay, variation evaluations, anatomy, checkpoint migration,
population retention and milestone criteria. The optional search experiment is developer-only and
never runs in CI.
