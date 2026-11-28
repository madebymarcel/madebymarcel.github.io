export interface Forward {
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

export class Network {
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

  apply(gradient: Float64Array, count: number, learningRate = 0.0003): void {
    let squared = 0;
    for (const g of gradient) squared += (g / count) ** 2;
    const norm = Math.sqrt(squared);
    if (!Number.isFinite(norm)) throw new Error('Non-finite network gradient');
    const scale = Math.min(1, 0.5 / Math.max(norm, 1e-12)) / count;
    const t = ++this.updates;
    for (let i = 0; i < gradient.length; i++) {
      const g = gradient[i] * scale;
      this.first[i] = 0.9 * this.first[i] + 0.1 * g;
      this.second[i] = 0.999 * this.second[i] + 0.001 * g * g;
      const m = this.first[i] / (1 - 0.9 ** t);
      const v = this.second[i] / (1 - 0.999 ** t);
      this.weights[i] -= (learningRate * m) / (Math.sqrt(v) + 1e-8);
    }
    if (!this.weights.every(Number.isFinite)) throw new Error('Non-finite network weights');
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

