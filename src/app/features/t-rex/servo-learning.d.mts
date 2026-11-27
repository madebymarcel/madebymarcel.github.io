import type { TrialOptions, Segment } from './spatial-learning.mjs';
import type { Metrics } from './servo-search.mjs';
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
