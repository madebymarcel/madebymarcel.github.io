type Point = { x: number; y: number; z: number };

export type Segment = {
  outline: Point[];
  eyes: Point[];
  name: string;
  width: number;
  depth: number;
  start: Point;
  end: Point;
};

export type TrialOptions = {
  seconds?: number;
  startSplit?: number;
  lateralVelocity?: number;
  friction?: number;
  locked?: boolean;
};

export type Metrics = {
  ticks: number;
  fell: boolean;
  distance: number;
  steps: number;
  lifts: number;
  maxClearance: number;
  maxForward: number;
  stableTicks: number;
  settledTicks: number;
  supportTicks: number;
  slip: number;
  work: number;
  flightTicks: number;
  phaseProgress: number;
  score: number;
};

export const POLICY_SIZE: number;
export const TRIAL_SECONDS: number;
export const PARAMETER_SCALE: number[];
export function boundPolicy(policy: number[]): number[];
export function trial(
  policy: number[],
  options?: TrialOptions,
): {
  rig: { frame(): Segment[] };
  advance(): void;
  metrics(): Metrics;
  readonly done: boolean;
};
export function evaluate(policy: number[], options?: TrialOptions): Metrics;
