// Differential extrinsic plasticity (DEP), adapted to signed joint torques.
// Reference: martius-lab/depRL, commit 790df8652f7ce7bae432435e44e509a5b427433e,
// deprl/dep_controller.py and experiments/deprl_paper/ostrich_dep_running.json.
// MIT license and attribution: docs/third-party/deprl-license.txt.
import { ACTIONS, OBSERVATIONS } from './balance-environment';

export interface DepOptions {
  readonly kappa: number;
  readonly tau: number;
  readonly delay: number;
  readonly biasRate: number;
  readonly regularization: number;
}

export const OSTRICH_DEP: DepOptions = {
  kappa: 20,
  tau: 8,
  delay: 5,
  biasRate: 0.03,
  regularization: 1e-32,
};

export interface DepState {
  readonly matrix: number[];
  readonly bias: number[];
}

// The paper's inverse model M = -I assumes a positive actuator command
// shortens its corresponding sensor. Our actuator increases signed angle,
// so the corresponding length proxy is minus the angle (radians / pi).
// No force term or fictitious anatomical muscle length is introduced.
export function depSensors(observation: readonly number[]): number[] {
  if (observation.length !== OBSERVATIONS.length) throw new Error('Invalid DEP observation');
  return ACTIONS.map((_, i) => -observation[i * 4]);
}

export class DepController {
  private readonly matrix: Float64Array;
  private readonly bias: Float64Array;
  private history: number[][] = [];
  private lastOutput: number[];
  private samples = 0;

  constructor(
    readonly size: number,
    readonly options: DepOptions = OSTRICH_DEP,
  ) {
    if (
      !Number.isSafeInteger(size) || size < 1 ||
      !Number.isFinite(options.kappa) || options.kappa <= 0 ||
      !Number.isSafeInteger(options.tau) || options.tau < 3 ||
      !Number.isSafeInteger(options.delay) || options.delay < 0 ||
      !Number.isFinite(options.biasRate) || options.biasRate < 0 ||
      !Number.isFinite(options.regularization) || options.regularization <= 0
    ) throw new Error('Invalid DEP settings');
    this.matrix = new Float64Array(size * size);
    this.bias = new Float64Array(size);
    this.lastOutput = Array(size).fill(0);
  }

  // Clear temporal differences across teleports. Retain the adapted
  // controller and bias across valid episodes, unlike an RL reset.
  resetHistory(): void {
    this.history = [];
    this.samples = 0;
    this.lastOutput = Array(this.size).fill(0);
  }

  step(sensor: readonly number[]): number[] {
    if (sensor.length !== this.size || !sensor.every(Number.isFinite)) {
      throw new Error('Invalid DEP sensor vector');
    }
    const { tau, delay, kappa, biasRate, regularization } = this.options;
    this.history.push([...sensor]);
    if (this.history.length > tau + delay + 2) this.history.shift();
    // Reference finite-window differential outer-product rule:
    // C = sum_s (-delta x(t-s)) delta x(t-s-delay)^T.
    // Recompute only after enough genuine adjacent observations.
    if (this.history.length > 2 + delay) {
      const c = new Float64Array(this.matrix.length);
      for (let s = 2; s < Math.min(this.samples - delay, tau); s++) {
        const current = this.history.at(-s)!;
        const previous = this.history.at(-s - 1)!;
        const delayed = this.history.at(-s - delay)!;
        const beforeDelayed = this.history.at(-s - delay - 1)!;
        for (let i = 0; i < this.size; i++) {
          const change = previous[i] - current[i];
          const row = i * this.size;
          for (let j = 0; j < this.size; j++) {
            c[row + j] += change * (delayed[j] - beforeDelayed[j]);
          }
        }
      }
      // Independent row normalization, R = C M^T = -C.
      if (this.samples - delay > 2) {
        for (let i = 0; i < this.size; i++) {
          const row = i * this.size;
          let squared = 0;
          for (let j = 0; j < this.size; j++) squared += c[row + j] ** 2;
          const scale = kappa / (Math.sqrt(squared) + regularization);
          for (let j = 0; j < this.size; j++) this.matrix[row + j] = c[row + j] * scale;
        }
        for (let i = 0; i < this.size; i++) {
          const change = Math.max(-0.05, Math.min(0.05, this.lastOutput[i] * biasRate));
          this.bias[i] -= change + this.bias[i] * 0.001;
        }
      }
    }
    const q = Array.from({ length: this.size }, (_, i) => {
      let sum = 0;
      for (let j = 0; j < this.size; j++) sum += this.matrix[i * this.size + j] * sensor[j];
      return sum;
    });
    const norm = Math.hypot(...q) + regularization;
    const action = q.map((value, i) => Math.tanh((kappa * value) / norm + this.bias[i]));
    if (!action.every(Number.isFinite)) throw new Error('Non-finite DEP action');
    this.lastOutput = action;
    this.samples++;
    return action;
  }

  state(): DepState {
    return { matrix: Array.from(this.matrix), bias: Array.from(this.bias) };
  }

  restore(state: DepState): void {
    if (
      !state ||
      !Array.isArray(state.matrix) ||
      state.matrix.length !== this.matrix.length ||
      !state.matrix.every(Number.isFinite) ||
      !Array.isArray(state.bias) ||
      state.bias.length !== this.bias.length ||
      !state.bias.every(Number.isFinite)
    ) throw new Error('Invalid DEP controller state');
    this.matrix.set(state.matrix);
    this.bias.set(state.bias);
    this.resetHistory();
  }
}
