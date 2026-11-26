# Biped robot

Route: `/projects/biped/`. Motion and training stay on-device. On the project page,
choose **Start training** and then **Watch best** to compare with **Watch baseline**.
Both use the selected test start; a new checkpoint does not change the current replay.
**Restart learning** or a reload discards the current session. The browser starts at seed 3 and does not load
pretrained weights. Edit **Restart seed** before choosing **Restart learning** to try a new run.

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
terrain. Sprinting, terrain changes, and training to jump are outside this first task.

The learner explores different trajectories between JavaScript engines. Chromium seed 3 reached
5/5 at iteration 85 (13.40 m median) and seed 2 did so at iteration 90. Chromium seed 42 did
not pass from scratch even though the Node-trained checkpoint passed 5/5 when evaluated in
Chromium. Seed settings make runs repeatable within the same environment, not across engines.
