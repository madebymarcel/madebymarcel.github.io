import type { Metrics } from './servo-learning.mjs';

export type Candidate = { iteration: number; policy: number[] };
export type Entry = Candidate & { metrics: Metrics };
export type Milestone = 'stand' | 'support' | 'step' | 'alternate' | 'walk';
export type Checkpoint = {
  format: string;
  rng: number;
  iteration: number;
  stale: number;
  best: Entry;
  records: Partial<Record<Milestone, Entry>>;
};
export type Wave = { rng: number; candidates: Candidate[] };
export const FORMAT: string;
export const STORAGE_KEY: string;
export const WAVE_SIZE: number;
export function achievements(metrics: Metrics): Milestone[];
export function milestoneLabel(key: Milestone): string;
export function emptyCheckpoint(seed?: number): Checkpoint;
export function assess(policy: number[]): Metrics;
export function propose(state: Checkpoint): Wave;
export function better(candidate: Entry, incumbent: Entry): boolean;
export function completeWave(state: Checkpoint, wave: Wave, evaluations: Metrics[]): Checkpoint;
export function parseCheckpoint(source: string): Checkpoint;
