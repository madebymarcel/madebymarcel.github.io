export interface Experience {
  readonly observation: readonly number[];
  readonly action: readonly number[];
  readonly nextObservation: readonly number[];
  readonly reward: number;
  readonly discount: number;
  readonly source: 'dep' | 'policy';
}

export interface ReplayState {
  readonly capacity: number;
  readonly count: number;
  readonly cursor: number;
  readonly data: string;
}

// Build n-step targets within one completed, valid episode. Terminal falls
// stop bootstrapping; time-limit truncations still bootstrap. Never cross resets.
export function nStepExperiences(episode: readonly Experience[], n = 3): Experience[] {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid n-step horizon');
  return episode.map((first, i) => {
    let reward = 0;
    let discount = 1;
    let last = first;
    for (let k = i; k < Math.min(episode.length, i + n) && discount > 0; k++) {
      last = episode[k];
      reward += discount * last.reward;
      discount *= last.discount;
    }
    return { ...first, reward, discount, nextObservation: last.nextObservation };
  });
}

function encode(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  }
  return btoa(binary);
}

function decode(data: string, length: number): Float32Array {
  if (typeof data !== 'string' || data.length !== 4 * Math.ceil((length * 4) / 3)) {
    throw new Error('Invalid replay byte length');
  }
  const binary = atob(data);
  if (binary.length !== length * 4) throw new Error('Invalid replay payload');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export class ReplayBuffer {
  private readonly data: Float32Array;
  private readonly width: number;
  private cursor = 0;
  private count = 0;

  constructor(
    readonly inputs: number,
    readonly actions: number,
    readonly capacity = 8192,
  ) {
    if (![inputs, actions, capacity].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Invalid replay dimensions');
    }
    this.width = inputs * 2 + actions + 3;
    this.data = new Float32Array(capacity * this.width);
  }

  get size(): number {
    return this.count;
  }

  add(experience: Experience): void {
    const { observation, action, nextObservation, reward, discount, source } = experience;
    if (
      observation.length !== this.inputs ||
      nextObservation.length !== this.inputs ||
      action.length !== this.actions ||
      !observation.every(Number.isFinite) ||
      !nextObservation.every(Number.isFinite) ||
      !action.every((value) => Number.isFinite(value) && Math.abs(value) <= 1) ||
      !Number.isFinite(reward) ||
      (discount !== 0 && discount !== 1) ||
      (source !== 'dep' && source !== 'policy')
    )
      throw new Error('Invalid replay experience');
    const row = this.cursor * this.width;
    this.data.set(observation, row);
    this.data.set(action, row + this.inputs);
    this.data.set(nextObservation, row + this.inputs + this.actions);
    this.data[row + this.width - 3] = reward;
    this.data[row + this.width - 2] = discount;
    this.data[row + this.width - 1] = source === 'dep' ? 1 : 0;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  get(index: number): Experience {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.count) {
      throw new Error('Invalid replay index');
    }
    const row = index * this.width;
    const end = row + this.width;
    return {
      observation: Array.from(this.data.subarray(row, row + this.inputs)),
      action: Array.from(this.data.subarray(row + this.inputs, row + this.inputs + this.actions)),
      nextObservation: Array.from(this.data.subarray(row + this.inputs + this.actions, end - 3)),
      reward: this.data[end - 3],
      discount: this.data[end - 2],
      source: this.data[end - 1] === 1 ? 'dep' : 'policy',
    };
  }

  sample(count: number, random: () => number): Experience[] {
    if (!this.count) throw new Error('Cannot sample an empty replay buffer');
    return Array.from({ length: count }, () => this.get(Math.floor(random() * this.count)));
  }

  state(): ReplayState {
    return {
      capacity: this.capacity,
      count: this.count,
      cursor: this.cursor,
      data: encode(this.data.subarray(0, this.count * this.width)),
    };
  }

  restore(state: ReplayState): void {
    if (
      !state ||
      state.capacity !== this.capacity ||
      !Number.isSafeInteger(state.count) ||
      state.count < 0 ||
      state.count > this.capacity ||
      !Number.isSafeInteger(state.cursor) ||
      state.cursor < 0 ||
      state.cursor >= this.capacity ||
      (state.count < this.capacity && state.cursor !== state.count)
    )
      throw new Error('Invalid replay checkpoint');
    const values = decode(state.data, state.count * this.width);
    if (!values.every(Number.isFinite)) throw new Error('Non-finite replay checkpoint');
    for (let i = 0; i < state.count; i++) {
      const row = i * this.width;
      const discount = values[row + this.width - 2];
      const source = values[row + this.width - 1];
      if (
        (discount !== 0 && discount !== 1) ||
        (source !== 0 && source !== 1) ||
        !values
          .subarray(row + this.inputs, row + this.inputs + this.actions)
          .every((value) => Math.abs(value) <= 1)
      )
        throw new Error('Invalid replay row');
    }
    this.data.fill(0);
    this.data.set(values);
    this.count = state.count;
    this.cursor = state.cursor;
  }
}
