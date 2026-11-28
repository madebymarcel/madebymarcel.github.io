import type { Metrics } from './servo-learning.mjs';

export type Candidate = {
  iteration: number;
  policy: number[];
  parent: number;
  local: boolean;
  lineage: number;
};
export type Evaluation = { metrics: Metrics; trials: Metrics[]; fitness: number };
export type Entry = { iteration: number; policy: number[] } & Evaluation;
export type Milestone = 'stand' | 'support' | 'step' | 'alternate' | 'walk';
export type Checkpoint = {
  format: string;
  rng: number;
  iteration: number;
  stale: number;
  mutationScale: number;
  successRate: number;
  best: Entry;
  population: Entry[];
  lineages: { entry: Entry; scale: number; stale: number }[];
  records: Partial<Record<Milestone, Entry>>;
};
export type Wave = { rng: number; candidates: Candidate[] };
export const FORMAT: string;
export const STORAGE_KEY: string;
export const WAVE_SIZE: number;
export const POPULATION_SIZE: number;
export function achievements(metrics: Metrics, trials?: Metrics[]): Milestone[];
export function milestoneLabel(key: Milestone): string;
export function robustFitness(metrics: Metrics, trials: Metrics[]): number;
export function emptyCheckpoint(seed?: number): Checkpoint;
export function assess(policy: number[]): Evaluation;
export function selectPopulation(entries: Entry[], champion: Entry): Entry[];
export function propose(state: Checkpoint): Wave;
export function better(candidate: Entry, incumbent: Entry): boolean;
export function completeWave(state: Checkpoint, wave: Wave, evaluations: Evaluation[]): Checkpoint;
export function parseCheckpoint(source: string): Checkpoint;
