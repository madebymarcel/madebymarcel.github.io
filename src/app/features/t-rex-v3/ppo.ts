import { Network } from './neural-network';
import type { NetworkState } from './neural-network';
export type { NetworkState } from './neural-network';

// Small dependency-free actor/critic. PPO operates on the latent Gaussian
// variable before tanh; the tanh Jacobian cancels in the likelihood ratio.
export const EXPLORATION_STD = 0.45;
export const DEFAULT_CORRELATION = 0.85;
const CLIP = 0.2;
const LAMBDA = 0.95;

export interface ExplorationHistory {
  readonly observation: readonly number[];
  readonly latent: readonly number[];
}

export interface Sample {
  readonly observation: readonly number[];
  readonly latent: readonly number[];
  readonly logProbability: number;
  readonly value: number;
  readonly reward: number;
  readonly history?: ExplorationHistory;
}

export interface TrainingSample extends Sample {
  readonly advantage: number;
  readonly target: number;
}

export interface Decision {
  readonly action: number[];
  readonly latent: number[];
  readonly logProbability: number;
  readonly value: number;
  readonly history?: ExplorationHistory;
}

export function gaussianLogProbability(
  latent: readonly number[],
  mean: readonly number[],
  std = EXPLORATION_STD,
): number {
  return latent.reduce((sum, value, i) => {
    const z = (value - mean[i]) / std;
    return sum - 0.5 * z * z - Math.log(std * Math.sqrt(2 * Math.PI));
  }, 0);
}

// z_t = mu(s_t) + rho * (z_(t-1) - mu(s_(t-1))) + sigma * sqrt(1-rho^2) * N(0,1).
// The history is fixed when evaluating a likelihood ratio, but BOTH means
// depend on current network parameters. At an episode boundary use the
// stationary marginal. The deterministic policy remains tanh(mu(s_t)).
export function conditionalGaussian(
  mean: readonly number[],
  previousMean: readonly number[] | undefined,
  previousLatent: readonly number[] | undefined,
  rho: number,
): { mean: number[]; std: number } {
  if (!previousMean || !previousLatent || rho === 0) {
    return { mean: [...mean], std: EXPLORATION_STD };
  }
  return {
    mean: mean.map((value, i) => value + rho * (previousLatent[i] - previousMean[i])),
    std: EXPLORATION_STD * Math.sqrt(1 - rho ** 2),
  };
}

// Undiscounted displacement objective. A fall has no bootstrap; a
// time-limited rollout bootstraps the value of the last observation.
export function advantages(episode: readonly Sample[], bootstrap: number): TrainingSample[] {
  let next = bootstrap;
  let gae = 0;
  const output: TrainingSample[] = new Array(episode.length);
  for (let i = episode.length - 1; i >= 0; i--) {
    const item = episode[i];
    gae = item.reward + next - item.value + LAMBDA * gae;
    output[i] = { ...item, advantage: gae, target: item.value + gae };
    next = item.value;
  }
  return output;
}

export function clippedPolicyDerivative(ratio: number, advantage: number): number {
  if ((advantage >= 0 && ratio > 1 + CLIP) || (advantage < 0 && ratio < 1 - CLIP)) return 0;
  return -advantage * ratio;
}

export interface InferenceState {
  readonly actor: readonly number[];
  readonly critic: readonly number[];
}

export class PpoAgent {
  private readonly actor: Network;
  private readonly critic: Network;

  constructor(
    inputs: number,
    outputs: number,
    private readonly random: () => number,
    readonly correlation = 0,
  ) {
    if (!Number.isFinite(correlation) || correlation < 0 || correlation >= 1) {
      throw new Error('Invalid exploration correlation');
    }
    this.actor = new Network(inputs, 64, outputs, random, 0.01);
    this.critic = new Network(inputs, 64, 1, random, 0.1);
  }

  sample(observation: readonly number[], previous?: ExplorationHistory): Decision {
    const history =
      this.correlation > 0 && previous
        ? { observation: previous.observation, latent: previous.latent }
        : undefined;
    const gaussian = conditionalGaussian(
      this.actor.forward(observation).output,
      history ? this.actor.forward(history.observation).output : undefined,
      history?.latent,
      this.correlation,
    );
    const latent = gaussian.mean.map((m) => {
      const u = Math.max(1e-12, this.random());
      const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random());
      return m + gaussian.std * normal;
    });
    return {
      action: latent.map(Math.tanh),
      latent,
      history,
      logProbability: gaussianLogProbability(latent, gaussian.mean, gaussian.std),
      value: this.value(observation),
    };
  }

  logProbability(sample: Pick<Sample, 'observation' | 'latent' | 'history'>): number {
    const gaussian = conditionalGaussian(
      this.actor.forward(sample.observation).output,
      sample.history ? this.actor.forward(sample.history.observation).output : undefined,
      sample.history?.latent,
      this.correlation,
    );
    return gaussianLogProbability(sample.latent, gaussian.mean, gaussian.std);
  }

  inference(): InferenceState {
    return { actor: this.policy(), critic: Array.from(this.critic.weights) };
  }

  restoreInference(state: InferenceState): void {
    this.actor.restoreWeights(state.actor);
    this.critic.restoreWeights(state.critic);
  }

  action(observation: readonly number[], weights?: readonly number[]): number[] {
    return this.actor.forward(observation, weights).output.map(Math.tanh);
  }

  value(observation: readonly number[]): number {
    return this.critic.forward(observation).output[0];
  }

  policy(): number[] {
    return Array.from(this.actor.weights);
  }

  update(data: readonly TrainingSample[]): void {
    if (data.length < 2) return;
    const avg = data.reduce((sum, item) => sum + item.advantage, 0) / data.length;
    const deviation = Math.sqrt(
      data.reduce((sum, item) => sum + (item.advantage - avg) ** 2, 0) / data.length + 1e-8,
    );
    const order = data.map((_, i) => i);
    for (let epoch = 0; epoch < 4; epoch++) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (let begin = 0; begin < order.length; begin += 32) {
        const indices = order.slice(begin, begin + 32);
        const actorGradient = new Float64Array(this.actor.weights.length);
        const criticGradient = new Float64Array(this.critic.weights.length);
        for (const index of indices) {
          const item = data[index];
          const actor = this.actor.forward(item.observation);
          const previous = item.history ? this.actor.forward(item.history.observation) : undefined;
          const gaussian = conditionalGaussian(
            actor.output,
            previous?.output,
            item.history?.latent,
            this.correlation,
          );
          const logp = gaussianLogProbability(item.latent, gaussian.mean, gaussian.std);
          const ratio = Math.exp(Math.max(-20, Math.min(20, logp - item.logProbability)));
          const factor = clippedPolicyDerivative(ratio, (item.advantage - avg) / deviation);
          const derivative = gaussian.mean.map(
            (mean, i) => (factor * (item.latent[i] - mean)) / gaussian.std ** 2,
          );
          this.actor.accumulate(actor, derivative, actorGradient);
          if (previous) {
            this.actor.accumulate(
              previous,
              derivative.map((value) => -this.correlation * value),
              actorGradient,
            );
          }
          const critic = this.critic.forward(item.observation);
          this.critic.accumulate(critic, [critic.output[0] - item.target], criticGradient);
        }
        this.actor.apply(actorGradient, indices.length);
        this.critic.apply(criticGradient, indices.length);
      }
    }
  }

  state(): { actor: NetworkState; critic: NetworkState } {
    return { actor: this.actor.state(), critic: this.critic.state() };
  }

  restore(state: { actor: NetworkState; critic: NetworkState }): void {
    this.actor.restore(state.actor);
    this.critic.restore(state.critic);
  }
}
