import { labWalker, recoveryStart, TaskProgress, validRun, type Skill } from './tasks';
import { ACTIONS, CONTROL_DT, OBSERVATIONS, TRACK_GOAL, Walker, type Start } from './walker';

export const DEFAULT_SEED = 3;
export const MAX_SEED = 0xffffffff;
const TERRAIN_INPUTS = 4;
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

export type Evaluation = {
  medianDistance: number;
  passes: number;
  medianReward: number;
  results: Trial[];
};
export type Trial = {
  distance: number;
  steps: number;
  flightFraction: number;
  alternatingFlights: number;
  validRun: boolean;
  slipDistance: number;
  fell: boolean;
  seconds: number;
  reward: number;
  passed: boolean;
};
export type Checkpoint = { iteration: number; policy: number[]; evaluation: Evaluation };

export function act(
  observation: Float64Array,
  weights: ArrayLike<number>,
  out: Float64Array = new Float64Array(ACTIONS),
): Float64Array {
  const stride = observation.length;
  for (let motor = 0; motor < ACTIONS; motor++) {
    let target = 0;
    for (let i = 0; i < stride; i++) {
      // Share a controller across both legs, with own-leg and opposite-leg inputs swapped.
      let input = i;
      if (motor >= 3 && i >= 4 && i < 16) input = 4 + ((i - 4 + 6) % 12);
      if (motor >= 3 && i >= 16 && i < 20) input = 16 + ((i - 16 + 2) % 4);
      target += weights[(motor % 3) * stride + i] * observation[input];
    }
    out[motor] = Math.tanh(target);
  }
  return out;
}

export function policyInputs(
  sim: Walker,
  skill: Skill,
  weights: ArrayLike<number>,
  outputs: Float64Array,
  inputs: Float64Array,
): Float64Array {
  sim.observe(inputs);
  if (skill !== 'walk') {
    const x = sim.distance;
    const current = sim.groundHeight(x);
    inputs[21] = current;
    inputs[22] = sim.groundHeight(x + 0.3) - current;
    inputs[23] = sim.groundHeight(x + 0.65) - current;
    inputs[24] = sim.torso.getPosition().y - current - 1;
  }
  return act(inputs, weights, outputs);
}

export function inputBuffer(skill: Skill) {
  return new Float64Array(OBSERVATIONS + (skill === 'walk' ? 0 : TERRAIN_INPUTS));
}

export function walkPassed(sim: Walker) {
  const time = sim.ticks * CONTROL_DT;
  return (
    !sim.fell &&
    sim.distance >= TRACK_GOAL &&
    sim.steps >= 6 &&
    sim.flightTime / time <= 0.15 &&
    sim.slipDistance <= sim.distance * 0.25
  );
}

export class Practice {
  readonly sim: Walker;
  private readonly progress: TaskProgress;
  private readonly observation: Float64Array;
  private readonly action = new Float64Array(ACTIONS);
  reward = 0;

  constructor(
    readonly skill: Skill,
    start: Start,
    private readonly weights: ArrayLike<number>,
  ) {
    this.sim = labWalker(skill, start);
    this.progress = new TaskProgress(skill);
    this.observation = inputBuffer(skill);
  }

  get passed() {
    return this.skill === 'walk' ? this.sim.done && walkPassed(this.sim) : this.progress.passed;
  }
  get done() {
    return this.sim.done || this.passed;
  }

  step() {
    if (!this.done) {
      const walkReward = this.sim.step(
        policyInputs(this.sim, this.skill, this.weights, this.action, this.observation),
      );
      this.reward += this.progress.update(this.sim, walkReward);
    }
  }
}

export function startFor(skill: Skill, index: number, training = false, iteration = 0): Start {
  const start = (training ? TRAINING_STARTS : EVALUATION_STARTS)[index];
  if (skill === 'recover') {
    const offset = training ? 0 : 3;
    const pose = recoveryStart(start, index + offset);
    const difficulty = training ? Math.min(1, iteration / 65) : 1;
    return {
      ...pose,
      tilt: (pose.tilt ?? 0) * (0.82 + 0.18 * difficulty) + (training ? 0 : 0.025),
      crouch: training ? 0.42 : 0.32 + index * 0.04,
    };
  }
  if (skill === 'jump') {
    const speed = training
      ? 0.25 + (index === 2 ? Math.min(0.55, iteration * 0.008) : 0)
      : [0.21, 0.34, 0.52, 0.72, 0.92][index];
    return {
      ...start,
      crouch: training ? 0.23 : 0.18 + index * 0.035,
      vx: speed + (start.vx ?? 0),
    };
  }
  return start;
}

export function trial(weights: ArrayLike<number>, start: Start, skill: Skill = 'walk'): Trial {
  const practice = new Practice(skill, start, weights);
  const { sim } = practice;
  while (!practice.done) practice.step();
  const seconds = sim.ticks * CONTROL_DT;
  return {
    distance: sim.distance,
    steps: sim.steps,
    flightFraction: sim.flightTime / seconds,
    alternatingFlights: sim.alternatingFlights,
    validRun: skill === 'run' && validRun(sim),
    slipDistance: sim.slipDistance,
    fell: sim.fell,
    seconds,
    reward: practice.reward,
    passed: practice.passed,
  };
}

function median(values: number[]) {
  const sorted = values.sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function evaluate(weights: ArrayLike<number>, skill: Skill = 'walk'): Evaluation {
  const results = EVALUATION_STARTS.map((_, index) =>
    trial(weights, startFor(skill, index), skill),
  );
  return {
    medianDistance: median(results.map((item) => item.distance)),
    medianReward: median(results.map((item) => item.reward)),
    passes: results.filter((item) => item.passed).length,
    results,
  };
}

function runSpeeds(evaluation: Evaluation) {
  return evaluation.results.flatMap((item) =>
    item.validRun ? [item.distance / item.seconds] : [],
  );
}

export function fastestRun(evaluation?: Evaluation): { index: number; speed: number } | undefined {
  let best: { index: number; speed: number } | undefined;
  evaluation?.results.forEach((item, index) => {
    const speed = item.distance / item.seconds;
    if (item.validRun && (!best || speed > best.speed)) best = { index, speed };
  });
  return best;
}

export function better(candidate: Checkpoint, best: Checkpoint | undefined, skill: Skill) {
  if (!best) return true;
  const a = candidate.evaluation;
  const b = best.evaluation;
  if (a.passes !== b.passes) return a.passes > b.passes;
  if (skill === 'run') {
    const speedsA = runSpeeds(a);
    const speedsB = runSpeeds(b);
    if (speedsA.length !== speedsB.length) return speedsA.length > speedsB.length;
    if (speedsA.length) return median(speedsA) > median(speedsB);
  }
  return skill === 'walk' ? a.medianDistance > b.medianDistance : a.medianReward > b.medianReward;
}

export class Trainer {
  private seed: number;
  private readonly weights: Float64Array;
  iteration = 0;

  constructor(
    seed: number,
    readonly skill: Skill = 'walk',
    walkPolicy?: number[],
  ) {
    this.seed = seed >>> 0 || 1;
    const stride = inputBuffer(skill).length;
    this.weights = new Float64Array(3 * stride);
    if (skill === 'run' && walkPolicy?.length === POLICY_SIZE) {
      for (let i = 0; i < 3; i++)
        this.weights.set(walkPolicy.slice(i * OBSERVATIONS, (i + 1) * OBSERVATIONS), i * stride);
    }
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
    const start = startFor(
      this.skill,
      this.iteration % TRAINING_STARTS.length,
      true,
      this.iteration,
    );
    const candidates = Array.from({ length: POPULATION }, () => {
      const direction = this.weights.map(() => Math.sqrt(12) * (this.random() - 0.5));
      const positive = trial(
        this.weights.map((weight, i) => weight + NOISE * direction[i]),
        start,
        this.skill,
      ).reward;
      const negative = trial(
        this.weights.map((weight, i) => weight - NOISE * direction[i]),
        start,
        this.skill,
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
    return { iteration: this.iteration, policy, evaluation: evaluate(policy, this.skill) };
  }
}
