import { Practice, startFor, Trainer } from '../biped/training';
import { RADIANS_PER_DEGREE as rad, Walker, type Morphology, type Start } from '../biped/walker';

// A sagittal-plane approximation with a rigid head and articulated counterbalancing tail.
// Angles and mass distribution are tuned for this simulation, not fossil measurements.
const T_REX: Morphology = {
  torso: [
    { x: 0, y: 0, halfWidth: 0.27, halfHeight: 0.13, density: 245 },
    { x: 0.44, y: 0.13, halfWidth: 0.22, halfHeight: 0.12, density: 95 },
  ],
  // Same mass and neutral geometry as the original rigid tail, now a separate body.
  tail: {
    anchor: { x: -0.17, y: -0.03 },
    length: 0.76,
    halfHeight: 0.06,
    density: 95,
    limit: 25 * rad,
    maxTorque: 80,
    pitchGain: 0.3,
    velocityGain: 0.06,
  },
  hip: -0.1,
  upper: 0.41,
  lower: 0.46,
  heel: -0.055,
  toe: 0.2,
  sole: -0.05,
  neutral: [15 * rad, -28 * rad, 13 * rad],
  limits: [
    [-50 * rad, 85 * rad],
    [-135 * rad, 0],
    [-65 * rad, 30 * rad],
  ],
};

export const T_REX_SEED = 3;
export const rexWalker = (start: Start) => new Walker(start, { morphology: T_REX });
export const rexTrainer = (seed = T_REX_SEED) => new Trainer(seed, 'walk', undefined, rexWalker);
export const rexReplay = (policy: ArrayLike<number>, index: number) =>
  new Practice('walk', startFor('walk', index), policy, rexWalker);
