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
steps and returns a transition. No reward function or training algorithm
is implemented. A caller must reset after termination/truncation.

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
