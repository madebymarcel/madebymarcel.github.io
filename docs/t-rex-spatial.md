# T. rex locomotion

The active experiment retains the spatial skeleton, six massive articulated tail
segments, leg geometry, gravity, collision shapes, and two projections of the
same 3D simulation. It changes the control and learning architecture, not the
anatomy. The previous torque-controller experiment remains in the legacy modules.

## Controller

The new 160-weight policy shares leg feedback across left and right, with own
and opposite observations swapped, and independently drives the neck, skull
and six tail segments with shared local feedback. Its inputs describe physical
joint angles and rates, contact loads, trunk movement and centre of mass
relative to support. The policy commands bounded joint position targets at 30 Hz.
Solver motor equations drive the joints at 120 Hz with limited angular speed
and torque impulse. There is no gait clock, external propulsion or predefined
animation. A zero-weight policy is an untrained baseline, not a standing policy.

Each skill starts independently on normal ground (friction 0.85, no initial
lateral disturbance). The initial stance has a 0.045 rad left/right split,
like the original biped, with unchanged joint anchors and level soles. Search uses symmetric perturbations of a centre policy
and normalized reward differences, following the original biped experiment.
Twelve candidates per generation run in workers. Dense rewards distinguish
forward displacement, supported foot lifts, alternating forward landings,
sliding, energy use, airtime and falls. Incremental clearance and forward swing
credit are bounded within each supported swing. The first generation explores
more widely; subsequent generations use the biped's 0.08 perturbation scale. Strict goal thresholds are separate
from the reward; a fall does not qualify. Robustness tests are deliberately
deferred until a basic gait has been demonstrated.

## Workbench

Select a skill directly, start/pause training, and watch the best evaluated
candidate or the untrained baseline. Both projections use the same live
physical replay. The headline metrics refer to the retained best candidate,
not independent records or the current playback frame. The graph uses saved
checkpoint improvements, with flat sections representing no new checkpoint.
A goal reached on normal ground is not proof of robust locomotion.
Training pauses on first qualification; restarting permits refinement.
Diagnostics, checkpoint history, and import/export are collapsed by default.

Servo checkpoints use a new version and local-storage key. The old weights have
different meaning and cannot be reused as servo weights. Older training remains
untouched and can be exported separately. Skills retain their own centre policy,
best evaluated checkpoint and recent improvements.

## Verification

```sh
node --test scripts/rex-servo.test.mjs
node scripts/rex-servo-experiment.mjs walk 10 3
```

The second command is an optional, local experiment; it is never called by
the CI workflow. The motor test checks commanded movement against the real
physics rig. The search tests check finite measurements, deterministic restore,
reward behaviour and independent skills. Successful joint motion and software
checks are not evidence of a sustained walking gait. No claim of mastery is
made until actual physical trials pass the goal.

For the earlier experiment see Git history for the previous version of this
document. Its old checkpoint and torque control files are retained for analysis.
