# T. rex locomotion

The page replays the distance champion while independent search lineages train in workers. The
17-body physical skeleton, constraints, collision geometry, motor limits and UI are unchanged.
All movement comes from physical joint motors, not scripted translations or root forces.

## Training v7

The 32 previous controller weights are extended with 20 optional, bounded feedback parameters.
These independently adjust stance propulsion, swing correction, lateral capture, step length,
stalled-phase recovery, weight transfer and tail balance. Zero residuals reproduce previous
policies. This remains optimization of a contact-driven feedback controller, not unrestricted RL.

Four persistent lineages each receive four candidates per wave. They optimize nominal upright
walking distance, worst-condition distance, average progress and a nominal/robust combination.
Related parameter groups mutate together in opposite directions. Unsuccessful waves increase
mutation scale; after four stalled waves exploration broadens, and after eight stalled waves
non-champion lineages may restart from a distinct archive strategy. The distance champion never
loses to a shorter walk because of slip or shaped score. Robustness has its own archive objective;
exploratory archive entries must be meaningfully separated in scaled parameter space.

The 12-second nominal and two six-second disturbed evaluations remain comparable. Zero-step
sliding cannot replace a walking champion. The milestone for sustained walking still requires
stable, low-slip completion in all three conditions. A successful milestone is not evidence of
a 10-metre walk; use the longer physical replay to verify that separately.

The existing browser storage key is preserved. V4 policies are re-evaluated with neutral gait
and adaptive defaults; v5/v6 policies are extended with zero residuals and their comparable
metrics rescored. Iteration and RNG are retained and the old checkpoint is backed up. The
mutation scale and island state are initialized afresh.

## Verification

```sh
node --test scripts/rex-servo.test.mjs
node scripts/rex-servo-experiment.mjs 10 3 /path/to/checkpoint.json
```

The optional experiment reports the champion and a 60-second physical verification replay.
No long-running training comparison is added to CI. Unit tests exercise the actual seed,
migration, search invariants, diversity, distance priority and adaptive motor feedback.
