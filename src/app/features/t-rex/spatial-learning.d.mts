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
export type Stage = 'balance' | 'recover' | 'shift' | 'step' | 'walk' | 'run' | 'maneuver';
export type TrialOptions = {
  stage?: Stage;
  seconds?: number;
  lateralVelocity?: number;
  friction?: number;
  locked?: boolean;
  selfCollision?: boolean;
};
export type Metrics = {
  ticks: number;
  fell: boolean;
  distance: number;
  steps: number;
  maxDistance: number;
  pathDistance: number;
  stableTicks: number;
  settledTicks: number;
  supportedTicks: number;
  bothFeetTicks: number;
  shiftTicks: number;
  flights: number;
  flightTicks: number;
  slip: number;
  headingError: number;
  stoppingTicks: number;
  averageSpeed: number;
  score: number;
};
export const dimension: number;
export const sensorCount: number;
export const sensorDimension: number;
export function expandPolicy(policy: number[]): number[];
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
export function trainer(seed: number): () => { iteration: number; policy: number[]; score: number };
