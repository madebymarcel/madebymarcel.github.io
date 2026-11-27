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
