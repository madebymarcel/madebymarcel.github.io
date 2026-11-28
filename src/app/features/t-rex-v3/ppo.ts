// Small dependency-free actor/critic. PPO operates on the latent Gaussian
// variable before tanh; the tanh Jacobian cancels in the likelihood ratio.
export const EXPLORATION_STD = 0.45;
export const DEFAULT_CORRELATION = 0.85;
const CLIP = 0.2;
const LAMBDA = 0.95;
const LR = 0.0003;

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

interface Forward {
  input: number[];
  hidden: number[];
  output: number[];
}

export interface NetworkState {
  readonly weights: number[];
  readonly first: number[];
  readonly second: number[];
  readonly updates: number;
}

class Network {
  readonly weights: Float64Array;
  private readonly first: Float64Array;
  private readonly second: Float64Array;
  private readonly offset: number;
  private updates = 0;

  constructor(
    readonly inputs: number,
    readonly hiddenSize: number,
    readonly outputs: number,
    random: () => number,
    outputScale: number,
  ) {
    this.offset = hiddenSize * (inputs + 1);
    this.weights = new Float64Array(this.offset + outputs * (hiddenSize + 1));
    this.first = new Float64Array(this.weights.length);
    this.second = new Float64Array(this.weights.length);
    for (let j = 0; j < hiddenSize; j++) {
      for (let i = 0; i < inputs; i++) {
        this.weights[j * (inputs + 1) + i] =
          ((random() * 2 - 1) * Math.sqrt(3)) / Math.sqrt(inputs);
      }
    }
    for (let j = 0; j < outputs; j++) {
      for (let i = 0; i < hiddenSize; i++) {
        this.weights[this.offset + j * (hiddenSize + 1) + i] =
          ((random() * 2 - 1) * outputScale) / Math.sqrt(hiddenSize);
      }
    }
  }

  forward(observation: readonly number[], weights: ArrayLike<number> = this.weights): Forward {
    if (observation.length !== this.inputs) throw new Error('Observation size mismatch');
    const input = observation.map((x) => Math.max(-5, Math.min(5, x)));
    const hidden = Array.from({ length: this.hiddenSize }, (_, j) => {
      const k = j * (this.inputs + 1);
      let x = weights[k + this.inputs];
      for (let i = 0; i < this.inputs; i++) x += weights[k + i] * input[i];
      return Math.tanh(x);
    });
    const output = Array.from({ length: this.outputs }, (_, j) => {
      const k = this.offset + j * (this.hiddenSize + 1);
      let x = weights[k + this.hiddenSize];
      for (let i = 0; i < this.hiddenSize; i++) x += weights[k + i] * hidden[i];
      return x;
    });
    return { input, hidden, output };
  }

  accumulate(frame: Forward, derivative: readonly number[], gradient: Float64Array): void {
    const hiddenGradient = new Float64Array(this.hiddenSize);
    for (let j = 0; j < this.outputs; j++) {
      const k = this.offset + j * (this.hiddenSize + 1);
      for (let i = 0; i < this.hiddenSize; i++) {
        gradient[k + i] += derivative[j] * frame.hidden[i];
        hiddenGradient[i] += derivative[j] * this.weights[k + i];
      }
      gradient[k + this.hiddenSize] += derivative[j];
    }
    for (let j = 0; j < this.hiddenSize; j++) {
      const k = j * (this.inputs + 1);
      const d = hiddenGradient[j] * (1 - frame.hidden[j] ** 2);
      for (let i = 0; i < this.inputs; i++) gradient[k + i] += d * frame.input[i];
      gradient[k + this.inputs] += d;
    }
  }

  apply(gradient: Float64Array, count: number): void {
    let squared = 0;
    for (const g of gradient) squared += (g / count) ** 2;
    const norm = Math.sqrt(squared);
    if (!Number.isFinite(norm)) throw new Error('Non-finite PPO gradient');
    const scale = Math.min(1, 0.5 / Math.max(norm, 1e-12)) / count;
    const t = ++this.updates;
    for (let i = 0; i < gradient.length; i++) {
      const g = gradient[i] * scale;
      this.first[i] = 0.9 * this.first[i] + 0.1 * g;
      this.second[i] = 0.999 * this.second[i] + 0.001 * g * g;
      const m = this.first[i] / (1 - 0.9 ** t);
      const v = this.second[i] / (1 - 0.999 ** t);
      this.weights[i] -= (LR * m) / (Math.sqrt(v) + 1e-8);
    }
    if (!this.weights.every(Number.isFinite)) throw new Error('Non-finite PPO weights');
  }

  restoreWeights(weights: readonly number[]): void {
    if (weights.length !== this.weights.length || !weights.every(Number.isFinite)) {
      throw new Error('Invalid inference weights');
    }
    this.weights.set(weights);
  }

  state(): NetworkState {
    return {
      weights: Array.from(this.weights),
      first: Array.from(this.first),
      second: Array.from(this.second),
      updates: this.updates,
    };
  }

  restore(state: NetworkState): void {
    if (
      !state ||
      ![state.weights, state.first, state.second].every(
        (values) =>
          Array.isArray(values) &&
          values.length === this.weights.length &&
          values.every(Number.isFinite),
      ) ||
      state.second.some((value) => value < 0) ||
      !Number.isSafeInteger(state.updates) ||
      state.updates < 0
    ) {
      throw new Error('Invalid network checkpoint');
    }
    this.weights.set(state.weights);
    this.first.set(state.first);
    this.second.set(state.second);
    this.updates = state.updates;
  }
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
