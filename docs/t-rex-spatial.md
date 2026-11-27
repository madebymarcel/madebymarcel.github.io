# T. rex locomotion

The page replays the best evaluated policy continuously, including while training is paused. Start
and pause are the only controls. Parallel workers explore one persistent policy; newly retained
policies become visible at the next replay boundary. Milestones are detected from physical outcomes,
not selectable training modes. Old torque and independent-skill checkpoint formats are incompatible
and are not loaded.

## Physical model

The 17-body spatial skeleton and continuous articulated-tail artwork are retained. Loaded tests
identified saturation of the lower-leg motor at 18 Nm. Hip, knee, metatarsus and toe torque limits
are now 120, 60, 45 and 22 Nm respectively. The hip's lateral target range is 0.32 radians; sagittal
travel was widened. These remain engineering estimates, not fossil measurements. The solver uses
30 iterations at 120 Hz. The final world has no root constraint, external propulsion or balance rail.

The feedback controller uses load-bearing foot contacts, centre-of-mass position and lateral motion,
trunk attitude, swing clearance and forward placement. Transfer, lift, swing and plant goals change
only in response to measured physical state. Joint target offsets and gains are searched parameters;
there is no timed pose sequence. Tail and neck motors have learned feedback gains. Each candidate
has a bounded eight-second physical trial. Sparse symmetric perturbations explore the same retained
policy and widen when learning stagnates. A sustained walking checkpoint is never replaced by a
nonqualifying one. Achieved milestones are retained internally.

The initial checkpoint was learned by evaluating actual candidates on this rig. Its recorded
normal-ground result is five alternating forward steps, 0.76 m travel, about 4.9 seconds before
falling. It is a stepping checkpoint, not a claim of sustained walking or robust locomotion.
Walking requires eight seconds without a fall, eight forward alternating steps, at least 2.4 m
travel and bounded sliding and airborne time.

## Development verification

```sh
node --test scripts/rex-servo.test.mjs
node scripts/rex-servo-experiment.mjs 10 3
```

The first command replays a learned checkpoint on the actual free rig, checks anatomy and active
tail articulation, and verifies state retention and milestone rules. The second is an optional
developer experiment, never a CI step. Browser tests verify the minimal controls, continuous
playback and persistence. The obsolete torque implementation, benchmark and stored policies are
available in Git history only.
