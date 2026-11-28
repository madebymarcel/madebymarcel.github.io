// A small browser MPO variant, based on Abdolmaleki et al. (2018)
// and the DEP-RL reference Tonic implementation. It uses a tanh-squashed
// Gaussian, a scalar Q critic, 3-step undiscounted returns, expected SARSA,
// target networks, a nonparametric KL-constrained E-step and decomposed
// per-action Gaussian KL constraints in the parametric M-step.
// Not a bit-for-bit port of the PyTorch research agent.
import { Network } from './neural-network';
import type { NetworkState } from './neural-network';
import type { Experience } from './replay-buffer';

const HIDDEN = 64;
const CANDIDATES = 20;
const EPSILON = 0.1;
const EPSILON_MEAN = 0.001;
const EPSILON_STD = 0.000001;
const POLYAK = 0.005;

interface Gaussian {
  readonly mean: number[];
  readonly logStd: number[];
  readonly std: number[];
  readonly logStdDerivative: number[];
}

function distribution(output: readonly number[], actions: number): Gaussian {
  const mean = output.slice(0, actions);
  const bounded = output.slice(actions).map((value) => Math.tanh(value + 0.45));
  const logStd = bounded.map((value) => -1.75 + 2.25 * value);
  return {
    mean,
    logStd,
    std: logStd.map(Math.exp),
    logStdDerivative: bounded.map((value) => 2.25 * (1 - value ** 2)),
  };
}

function normal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random());
}

function latentSample(gaussian: Gaussian, random: () => number): number[] {
  return gaussian.mean.map((mean, i) => mean + gaussian.std[i] * normal(random));
}

function weightsFor(values: readonly number[], temperature: number): number[] {
  const peak = Math.max(...values);
  const weights = values.map((value) => Math.exp((value - peak) / temperature));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

export function uniformKl(weights: readonly number[]): number {
  return weights.reduce(
    (sum, value) => (value > 0 ? sum + value * Math.log(value * weights.length) : sum),
    0,
  );
}

// Solve the E-step temperature dual via monotone bisection of its KL
// constraint, shared over the entire minibatch, not per action dimension.
export function mpoWeights(
  rows: readonly (readonly number[])[],
  epsilon = EPSILON,
): { temperature: number; weights: number[][]; kl: number } {
  if (
    !rows.length ||
    rows.some((row) => !row.length || !row.every(Number.isFinite)) ||
    !Number.isFinite(epsilon) ||
    epsilon <= 0
  )
    throw new Error('Invalid MPO E-step');
  const evaluate = (temperature: number) => {
    const weights = rows.map((row) => weightsFor(row, temperature));
    return {
      temperature,
      weights,
      kl: weights.reduce((sum, row) => sum + uniformKl(row), 0) / rows.length,
    };
  };
  const low = 1e-8;
  const minimum = evaluate(low);
  if (minimum.kl <= epsilon) return minimum;
  let left = low;
  let right = Math.max(1, ...rows.map((row) => Math.max(...row) - Math.min(...row)));
  while (evaluate(right).kl > epsilon) right *= 2;
  for (let i = 0; i < 36; i++) {
    const middle = (left + right) / 2;
    if (evaluate(middle).kl > epsilon) left = middle;
    else right = middle;
  }
  return evaluate(right);
}

export interface MpoState {
  readonly actor: NetworkState;
  readonly critic: NetworkState;
  readonly targetActor: number[];
  readonly targetCritic: number[];
  readonly logAlphaMean: number[];
  readonly logAlphaStd: number[];
  readonly updates: number;
}

export interface MpoUpdate {
  readonly criticLoss: number;
  readonly temperature: number;
  readonly nonparametricKl: number;
  readonly meanKl: number;
  readonly stdKl: number;
}

export class MpoPolicy {
  protected readonly actor: Network;

  constructor(
    readonly inputs: number,
    readonly actions: number,
    protected readonly random: () => number,
  ) {
    this.actor = new Network(inputs, HIDDEN, 2 * actions, random, 0.01);
  }

  action(observation: readonly number[], stochastic = false): number[] {
    const gaussian = distribution(this.actor.forward(observation).output, this.actions);
    return (stochastic ? latentSample(gaussian, this.random) : gaussian.mean).map(Math.tanh);
  }

  policy(): number[] {
    return Array.from(this.actor.weights);
  }

  restorePolicy(weights: readonly number[]): void {
    this.actor.restoreWeights(weights);
  }
}

export class MpoAgent extends MpoPolicy {
  private readonly critic: Network;
  private readonly targetActor: Float64Array;
  private readonly targetCritic: Float64Array;
  private readonly logAlphaMean: Float64Array;
  private readonly logAlphaStd: Float64Array;
  private updates = 0;

  constructor(inputs: number, actions: number, random: () => number) {
    super(inputs, actions, random);
    this.critic = new Network(inputs + actions, HIDDEN, 1, random, 0.1);
    this.targetActor = this.actor.weights.slice();
    this.targetCritic = this.critic.weights.slice();
    this.logAlphaMean = new Float64Array(actions);
    this.logAlphaStd = new Float64Array(actions).fill(Math.log(10));
  }

  private targetDistribution(observation: readonly number[]): Gaussian {
    return distribution(this.actor.forward(observation, this.targetActor).output, this.actions);
  }

  private targetValue(observation: readonly number[], latent: readonly number[]): number {
    return this.critic.forward([...observation, ...latent.map(Math.tanh)], this.targetCritic)
      .output[0];
  }

  update(batch: readonly Experience[]): MpoUpdate {
    if (!batch.length) throw new Error('Empty MPO batch');
    const criticGradient = new Float64Array(this.critic.weights.length);
    let criticLoss = 0;
    const candidates = batch.map((item) => {
      let target = item.reward;
      if (item.discount !== 0) {
        const next = this.targetDistribution(item.nextObservation);
        for (let k = 0; k < CANDIDATES; k++) {
          target +=
            (item.discount *
              this.targetValue(item.nextObservation, latentSample(next, this.random))) /
            CANDIDATES;
        }
      }
      const frame = this.critic.forward([...item.observation, ...item.action]);
      const difference = frame.output[0] - target;
      criticLoss += difference ** 2 / batch.length;
      this.critic.accumulate(frame, [2 * difference], criticGradient);
      const old = this.targetDistribution(item.observation);
      const latents = Array.from({ length: CANDIDATES }, () => latentSample(old, this.random));
      const values = latents.map((latent) => this.targetValue(item.observation, latent));
      return { observation: item.observation, old, latents, values };
    });
    const e = mpoWeights(candidates.map((item) => item.values));
    this.critic.apply(criticGradient, batch.length, 0.0003);
    const actorGradient = new Float64Array(this.actor.weights.length);
    const meanKl = new Float64Array(this.actions);
    const stdKl = new Float64Array(this.actions);
    candidates.forEach(({ observation, old, latents }, row) => {
      const frame = this.actor.forward(observation);
      const current = distribution(frame.output, this.actions);
      const gradient = new Array<number>(2 * this.actions).fill(0);
      for (let j = 0; j < this.actions; j++) {
        const oldVariance = old.std[j] ** 2;
        const variance = current.std[j] ** 2;
        const diff = current.mean[j] - old.mean[j];
        meanKl[j] += diff ** 2 / (2 * oldVariance * batch.length);
        stdKl[j] +=
          (current.logStd[j] - old.logStd[j] + oldVariance / (2 * variance) - 0.5) / batch.length;
        let meanGradient = (Math.exp(this.logAlphaMean[j]) * diff) / oldVariance;
        let stdGradient = Math.exp(this.logAlphaStd[j]) * (1 - oldVariance / variance);
        for (let k = 0; k < CANDIDATES; k++) {
          const weight = e.weights[row][k];
          // Separate means and variances exactly as in decomposed MPO:
          // fixed old std for mean MLE; fixed old mean for variance MLE.
          meanGradient += (weight * (current.mean[j] - latents[k][j])) / oldVariance;
          stdGradient += weight * (1 - (latents[k][j] - old.mean[j]) ** 2 / variance);
        }
        gradient[j] = meanGradient;
        gradient[this.actions + j] = stdGradient * current.logStdDerivative[j];
      }
      this.actor.accumulate(frame, gradient, actorGradient);
    });
    this.actor.apply(actorGradient, batch.length, 0.0001);
    // Projected log-dual ascent. KL above its target increases the penalty.
    for (let j = 0; j < this.actions; j++) {
      this.logAlphaMean[j] = this.updateDual(this.logAlphaMean[j], meanKl[j] - EPSILON_MEAN);
      this.logAlphaStd[j] = this.updateDual(this.logAlphaStd[j], stdKl[j] - EPSILON_STD);
    }
    for (let i = 0; i < this.targetActor.length; i++) {
      this.targetActor[i] += POLYAK * (this.actor.weights[i] - this.targetActor[i]);
    }
    for (let i = 0; i < this.targetCritic.length; i++) {
      this.targetCritic[i] += POLYAK * (this.critic.weights[i] - this.targetCritic[i]);
    }
    this.updates++;
    return {
      criticLoss,
      temperature: e.temperature,
      nonparametricKl: e.kl,
      meanKl: meanKl.reduce((sum, value) => sum + value, 0) / this.actions,
      stdKl: stdKl.reduce((sum, value) => sum + value, 0) / this.actions,
    };
  }

  private updateDual(logAlpha: number, error: number): number {
    return Math.max(-12, Math.min(12, logAlpha + 0.01 * Math.exp(logAlpha) * error));
  }

  state(): MpoState {
    return {
      actor: this.actor.state(),
      critic: this.critic.state(),
      targetActor: Array.from(this.targetActor),
      targetCritic: Array.from(this.targetCritic),
      logAlphaMean: Array.from(this.logAlphaMean),
      logAlphaStd: Array.from(this.logAlphaStd),
      updates: this.updates,
    };
  }

  restore(state: MpoState): void {
    if (
      !state ||
      !Number.isSafeInteger(state.updates) ||
      state.updates < 0 ||
      ![
        [state.targetActor, this.targetActor],
        [state.targetCritic, this.targetCritic],
        [state.logAlphaMean, this.logAlphaMean],
        [state.logAlphaStd, this.logAlphaStd],
      ].every(
        ([source, target]) =>
          Array.isArray(source) && source.length === target.length && source.every(Number.isFinite),
      ) ||
      [...state.logAlphaMean, ...state.logAlphaStd].some((value) => Math.abs(value) > 12)
    )
      throw new Error('Invalid MPO checkpoint');
    this.actor.restore(state.actor);
    this.critic.restore(state.critic);
    this.targetActor.set(state.targetActor);
    this.targetCritic.set(state.targetCritic);
    this.logAlphaMean.set(state.logAlphaMean);
    this.logAlphaStd.set(state.logAlphaStd);
    this.updates = state.updates;
  }
}
