# Biped robot

Route: `/projects/biped/`. Selecting a skill opens its scene and plays its best checkpoint
(or the baseline before training). **Play** / **Pause** controls the viewer; **Start training**
updates the selected skill separately. An in-progress replay keeps its policy even when
training finds a better one. Reselect the skill or choose **Watch best** to see the update.

Each card shows the best result across five fixed test starts and the number of training
sessions ended after doing work (by pausing or by finishing a batch). **Training & replay
options** has baseline replay, test starts, sensors, batch training and **Restart selected
skill**. Restarting clears that skill's progress; reloading clears all progress. The browser
starts at seed 3 and does not load pretrained weights.

## Model

The sagittal-plane model uses Planck rigid bodies and 120 Hz physics. Body, legs and feet can
hit the floor, with friction and no artificial push along the track. The legs occupy separate
lateral lanes in this projection; there is no self-collision or sideways balance.
Each leg has three speed- and torque-limited position servos. The hip travels 20° back and 120°
forward; the knee bends toward the heel up to 140° without hyperextension; the ankle travels
15° toe-up and 55° toe-down. Joint limits are physical solver constraints, not animation clamps.
The 30 Hz policy observes torso tilt and motion, joint angles and speeds, and actual impulse
contacts split into heel/toe. There is no gait clock, scripted stepping, or jump action.

The trainer searches policy parameters with symmetric random perturbations ranked by
episode reward. A shared left/right controller gets each leg's own measurements first,
but produces six separate motor commands. The 12-second walking task rewards capped forward
progress and alternating forward foot placements. It penalizes falls, motor work, sliding
while loaded, and time with both feet off the floor. A counted step requires sole clearance
and a forward landing rather than a flickering contact.

## Joint debug

**Joint debug** pins the torso in a separate, gravity-free simulation with the same motors
and hard joint limits. It sweeps the minimum and maximum of each joint on each leg, then
visits all 64 combinations of the six endpoints, changing one endpoint at a time.
Pause and use **Next pose** to inspect the angles without waiting for the full sweep.

Hard limits and policy target ranges are separate: the current policy does not command
the full hip flexion or knee bend, although the solver allows both. The 12 rad/s motor
command ceiling (about 688°/s) is not a hard cap on measured joint velocity. Other
bodies can drive a joint faster, and this unloaded sweep does not measure running speed.
It does not change training or the normal replay.

## Verification

`npm run experiment:biped -- 120 42 43 44` runs the same trainer headlessly on Node 24.
It reports the untrained baseline and periodic results on five fixed starts separate from
the three used for training rollouts. A pass requires 5 m of rightward travel, no fall over
12 s, six alternating steps, at most 15% air time, and estimated maximum loaded foot slip
integrated over the run no more than 25% of the torso's travel. The page retains the best
checkpoint by passes, then median distance; these test starts are therefore not a blind
estimate of generalization.

Seed 42 at iteration 55 passed all five, with 10.19 m median travel and 25–26 alternating
steps per trial. The untrained median was −1.05 m, with zero passes. Seeds 43 and 44 did
not reproduce five passes within 120 iterations. This establishes that the model can
learn a walking gait on the test track, not that learning is yet robust across runs or
terrain. Those results are from the original flat-ground walking experiment.

The learner explores different trajectories between JavaScript engines. Chromium seed 3 reached
5/5 at iteration 85 (13.40 m median) and seed 2 did so at iteration 90. Chromium seed 42 did
not pass from scratch even though the Node-trained checkpoint passed 5/5 when evaluated in
Chromium. Seed settings make runs repeatable within the same environment, not across engines.

## Skill training and parkour

**Train all skills** runs up to 100 new iterations per skill, in order, keeping the best tested
checkpoint for each. Individual skills can be resumed or restarted with a separate seed.
A fresh Run trainer copies the best Walk weights when available; it does not modify Walk.
Run keeps training for the full batch even after five passes. Its reward gives credit for
uncapped forward progress and alternating airborne strides. Checkpoints rank by passes,
then valid runs, then median speed across valid runs. The viewer defaults to the fastest
valid start in the selected checkpoint; a fast walk or fall is not a valid run. The
1.55 m/s cutoff is a test threshold, not a reward cap.
The remaining trainers start from zero. Each lab has its own independent rollouts and five
fixed test starts.

| Skill        | What the test checks                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ |
| Walk         | Five metres with alternating steps, little slip or airtime, and no fall.                   |
| Run          | Average at least 1.55 m/s over 12 s, alternating airborne strides, and no fall.            |
| Jump         | Airborne crossing of a real gap, no foot below the lip, and a controlled landing.          |
| Climb stairs | Upward foot contact on each of three treads in order, then both feet on top.               |
| Get up       | Physical fallen starts in both directions; upright and stable for one second on both feet. |

**Run parkour** snapshots the five best checkpoints after each skill has trained. It evaluates
walk → run → jump and land → climb → recover from a standard trip impulse → walk to the finish,
in a single physics world with no resets or further training. A failure identifies the section
that blocked the remainder. A lab pass does not guarantee a parkour pass: each stage inherits
the position, joint motion and velocity left by the previous policy. The walking policy is
reused after recovery. No controller is nudged into a scripted pose at a transition.

Developer check: `npm run experiment:biped -- 100 42 --parkour` logs each lab's test results
and the combined course result. Not all labs are solved, and the course is intended to expose
the weakest skill or handoff rather than to demo a preprogrammed finish.
