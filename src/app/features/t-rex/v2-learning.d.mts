import type { Segment, TrialOptions } from './servo-learning.mjs';
export type Mode = 'planar' | 'spatial';
export type Metrics = {
  ticks: number;
  fell: boolean;
  distance: number;
  steps: number;
  slip: number;
  work: number;
  flightTicks: number;
  stableTicks: number;
  lateralDistance: number;
  score: number;
};
export const SECONDS: number;
export const DT: number;
export function trial(
  weights: number[],
  mode?: Mode,
  options?: TrialOptions,
): {
  rig: { frame(): Segment[] };
  advance(): void;
  metrics(): Metrics;
  readonly done: boolean;
};
export function evaluate(weights: number[], mode: Mode, options?: TrialOptions): Metrics;
export function passed(metrics: Metrics): boolean;
