import { ACTIONS, CONTROL_DT, OBSERVATIONS, TRACK_GOAL, Walker, type Start } from './walker';

export const POLICY_SIZE = (ACTIONS / 2) * OBSERVATIONS;
const POPULATION = 12;
const ELITES = 5;
const NOISE = 0.08;
export const EVALUATION_STARTS: readonly Start[] = [
  { tilt: -0.04, vx: 0.06, friction: 0.83 },
  { tilt: 0.03, vx: -0.06, friction: 0.97 },
  { tilt: 0.055, vx: 0.02, friction: 0.76 },
  { tilt: -0.018, vx: -0.09, friction: 0.89 },
  { tilt: 0.01, vx: 0, friction: 1.02 },
];
const TRAINING_STARTS: readonly Start[] = [
  {},
  { tilt: 0.025, vx: 0.04, friction: 0.9 },
  { tilt: -0.025, vx: -0.04, friction: 0.94 },
];

export type Evaluation = { medianDistance: number; passes: number; results: Trial[] };
export type Trial = {
  distance: number;
  steps: number;
  flightFraction: number;
  slipDistance: number;
  fell: boolean;
  seconds: number;
  reward: number;
};
export type Checkpoint = { iteration: number; policy: number[]; evaluation: Evaluation };

export function act(
  observation: Float64Array,
  weights: ArrayLike<number>,
  out = new Float64Array(ACTIONS),
): Float64Array {
  for (let motor = 0; motor < ACTIONS; motor++) {
    let target = 0;
    for (let i = 0; i < OBSERVATIONS; i++) {
      // Share a controller across both legs, with own-leg and opposite-leg inputs swapped.
      let input = i;
      if (motor >= 3 && i >= 4 && i < 16) input = 4 + ((i - 4 + 6) % 12);
      if (motor >= 3 && i >= 16 && i < 20) input = 16 + ((i - 16 + 2) % 4);
      target += weights[(motor % 3) * OBSERVATIONS + i] * observation[input];
    }
    out[motor] = Math.tanh(target);
  }
  return out;
}

export function trial(weights: ArrayLike<number>, start: Start): Trial {
  const walker = new Walker(start);
  const observation = new Float64Array(OBSERVATIONS);
  const action = new Float64Array(ACTIONS);
  let reward = 0;
  while (!walker.done) reward += walker.step(act(walker.observe(observation), weights, action));
  const seconds = walker.ticks * CONTROL_DT;
  return {
    distance: walker.distance,
    steps: walker.steps,
    flightFraction: walker.flightTime / seconds,
    slipDistance: walker.slipDistance,
    fell: walker.fell,
    seconds,
    reward,
  };
}

export function evaluate(weights: ArrayLike<number>): Evaluation {
  const results = EVALUATION_STARTS.map((start) => trial(weights, start));
  const sorted = results.map((item) => item.distance).sort((a, b) => a - b);
  const passes = results.filter(
    (item) =>
      !item.fell &&
      item.distance >= TRACK_GOAL &&
      item.steps >= 6 &&
      item.flightFraction <= 0.15 &&
      item.slipDistance <= item.distance * 0.25,
  ).length;
  return { medianDistance: sorted[Math.floor(sorted.length / 2)], passes, results };
}

export class Trainer {
  private seed: number;
  private readonly weights = new Float64Array(POLICY_SIZE);
  iteration = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0 || 1;
  }

  private random(): number {
    let value = this.seed;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.seed = value >>> 0;
    return this.seed / 4294967296;
  }

  // Symmetric parameter perturbations. The policy gets only episode rewards, no target gait.
  train(): void {
    const start = TRAINING_STARTS[this.iteration % TRAINING_STARTS.length];
    const candidates = Array.from({ length: POPULATION }, () => {
      const direction = this.weights.map(() => Math.sqrt(12) * (this.random() - 0.5));
      const positive = trial(
        this.weights.map((weight, i) => weight + NOISE * direction[i]),
        start,
      ).reward;
      const negative = trial(
        this.weights.map((weight, i) => weight - NOISE * direction[i]),
        start,
      ).reward;
      return { direction, positive, negative };
    });
    candidates.sort((a, b) => Math.max(b.positive, b.negative) - Math.max(a.positive, a.negative));
    const elite = candidates.slice(0, ELITES);
    const scores = elite.flatMap(({ positive, negative }) => [positive, negative]);
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const deviation = Math.sqrt(
      scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length,
    );
    if (deviation > 1e-8) {
      for (let i = 0; i < this.weights.length; i++) {
        const update = elite.reduce(
          (sum, { positive, negative, direction }) => sum + (positive - negative) * direction[i],
          0,
        );
        this.weights[i] += (0.035 * update) / (ELITES * deviation);
      }
    }
    this.iteration++;
  }

  checkpoint(): Checkpoint {
    const policy = Array.from(this.weights);
    return { iteration: this.iteration, policy, evaluation: evaluate(policy) };
  }
}
