# T. rex V3: physical environment contract

The sole maintained dinosaur is `/projects/t-rex-v3/`. Earlier implementations
are removed from the active tree; Git history is retained.

## Body and physics

- One shared deterministic rigid-body simulation for UI and learning.
- Physics 480 Hz, control 30 Hz (16 fixed integration steps). No wall-clock
  stepping in the learning environment.
- Bounded signed muscle activations with 60 ms activation lag and a finite
  force-velocity law. No position motors or hidden balance controller.
- Contact-normal-dependent circular friction cone, coefficient 0.65.
  The native reduced-mass approximation is disabled.
- No arbitrary world-frame linear/angular velocity damping. Dissipation
  comes from contact, passive ligaments when enabled, and actuator behavior.
- Only parent/child and documented proximal overlaps are excluded.
  Rib-cage boxes around the shoulder are narrower to avoid permanent
  distal arm exemptions. This changes collision/inertia approximations,
  not the skeleton or mass allocation.
- Fixed muscle limits use a 1.5x reserve on sampled gravity and contact
  loads across multiple reference postures. This is not anatomical evidence
  or a guarantee throughout the entire range of motion.

## Environment

`BalanceEnvironment.reset(seed, perturbationDegrees)` initializes the same
body and returns an observation with no commands applied. The seed is a
32-bit unsigned integer. A balanced reference posture is used only to
initialize the episode, never to drive muscles. All observable and action
channels have named, fixed order in `OBSERVATIONS` and `ACTIONS`.
`step(action)` applies the supplied action vector for up to 16 physics
steps and returns a transition. The environment itself has no reward function or policy. A caller must reset after termination/truncation.

An invalid numerical/constraint state is a distinct termination with a
null observation, not a learnable fall. Valid falls and time limits are
separate. Support requires measured positive foot normal load and upright
posture; airborne time cannot count. Standing is measured continuously,
using the 30 Hz interval-averaged load and COM speed.

## Validation

Unit tests cover known loaded/sliding block friction, circular cone
bounds, declared collision exclusions, pose geometry, muscle torque
capacities, bounded actuation, seeded resets and replay, and actual support
measurement. The randomized full-body and passive drop audits print
momentum, energy/work and constraint measurements. Report-only gates
are explicitly marked; a green CI run is not a guarantee that every
randomized trajectory is valid. The physics engine's angular integration,
contact proxies and calibration remain approximate. Do not claim
reinforcement-learning readiness from a finite trajectory alone.

## Distance learning

The separate worker implements Gaussian PPO with independent 64-unit actor
and critic networks, a bounded tanh action, fixed marginal exploration variance,
clipped updates, GAE and Adam. All training decisions use the same 30 Hz
environment as deterministic evaluation. The only reward is the signed
change in world-forward centre of mass position (metres), excluding the
transition on which the dinosaur falls. A time limit truncates the rollout
and bootstraps the value rather than recording a fall. Training uses a
configurable 5–120 second horizon; replay of the best evaluated policy has
no time limit. It ends on a fall, invalid physics, or user interruption.

Complete invalid episodes are discarded before any PPO update. Frequent
invalid physics stops training and must be investigated. Evaluation uses
two fixed seeds with the Gaussian mean, and is not an unseen-seed guarantee
of generalization. Training distance and evaluation distance are reported
separately. No balance or survival reward, gait target, imitation data, or
scripted motor controller is used. Forward distance alone can favor a
lunge instead of a sustainable gait; this is the requested objective.

Save/load checkpoints carry network and Adam state, random generator state,
scores, and best policy. Import requires the same action/observation schema
and format. Loading starts a new episode and discards unfinished rollout
data; it is not exact in-flight simulation resumption.

## Correlated exploration and parallel collection

The new default sampler is autoregressive Gaussian exploration (rho = 0.85)
in latent action space. With the actor mean denoted by mu, the residual
between a sampled latent action and its mean follows

`e(t) = rho * e(t-1) + sigma * sqrt(1 - rho^2) * N(0, 1)`.

At episode reset the residual is sampled from the stationary marginal.
PPO computes conditional likelihoods using the recorded previous latent
action and both the current and previous observation's means under the
updated actor, including the gradient through the previous mean. The
critic remains an approximate function of the current observation. The
deterministic policy remains tanh of the actor mean. This is an
autoregressive exploration variant inspired by correlated-exploration
research, not DEP-RL or a scripted movement generator.

A coordinator freezes one actor and critic while 1–4 independent Web
Workers collect complete episodes. Each worker has separate seed streams
for exploration and body resets. Results are committed in lane order,
with whole invalid episodes excluded. The next PPO update uses only
experiences from the frozen policy. Pausing cancels an in-flight round;
completed updates and previously committed statistics are preserved.
A worker's nominal action count is a minimum, not an episode time limit.
Checkpoint format 2 stores the rollout seed, round number and correlation.
Version 1 checkpoints can be imported with their old parameters and
optimizer state, then use the new exploration strategy.

The separate exploration benchmark workflow compares IID noise (rho = 0)
with correlated noise (rho = 0.85) in the same collector, at 768 attempted
actions per mode for each of two training seeds. Only for this benchmark,
an exact collection budget discards any unfinished episode; no partial
invalid episode is trained on. Evaluation is deterministic on three
held-out seeds, with an initial and passive baseline. A serial/parallel
probe verifies deterministic records and reports wall-clock throughput.
The benchmark is a short screening experiment, not proof of sustained
walking; a passing workflow alone does not establish an improvement.
