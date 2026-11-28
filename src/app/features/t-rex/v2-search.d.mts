import type { TrialOptions } from './servo-learning.mjs';
import type { Metrics, Mode } from './v2-learning.mjs';

export type Assessment = {
  trials: Metrics[];
  passes: number;
  medianDistance: number;
  medianScore: number;
};
export type Checkpoint = {
  format: string;
  mode: Mode;
  rng: number;
  iteration: number;
  rollouts: number;
  evaluationRollouts: number;
  weights: number[];
  best: { iteration: number; policy: number[]; evaluation: Assessment } | null;
};
export type Wave = { rng: number; directions: number[][]; policies: number[][]; start: TrialOptions };
export const TEST_STARTS: TrialOptions[];
export function storageKey(mode: Mode): string;
export function emptyCheckpoint(mode: Mode, seed?: number, initialWeights?: number[]): Checkpoint;
export function propose(state: Checkpoint): Wave;
export function advanceWeights(state: Checkpoint, wave: Wave, rewards: number[]): Checkpoint;
export function assessment(weights: number[], mode: Mode, starts?: TrialOptions[]): Assessment;
export function recordEvaluation(state: Checkpoint, evaluation: Assessment): Checkpoint;
export function parseCheckpoint(source: string, mode: Mode): Checkpoint;
