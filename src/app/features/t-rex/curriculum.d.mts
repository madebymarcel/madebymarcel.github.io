import type { Metrics, Stage, TrialOptions } from './spatial-learning.mjs';
export type { Stage };
export type Evaluation = { score: number; passes: number; trials: Metrics[] };
export type Candidate = { iteration: number; policy: number[] };
export type Entry = Candidate & { stage: Stage; evaluation: Evaluation };
export type RecordKey = 'distance' | 'path' | 'upright' | 'steps' | 'speed' | 'flights';
export type SearchProgress = {
  attempts: number;
  sinceImprovement: number;
  restarts: number;
  population: Entry[];
  focus?: Entry;
};
export type Checkpoint = {
  format: string;
  rng: number;
  iteration: number;
  physicsSteps: number;
  stage: Stage;
  best: Partial<Record<Stage, Entry>>;
  records: Partial<Record<RecordKey, { value: number; entry: Entry; trialIndex: number }>>;
  history: Entry[];
  search?: Partial<Record<Stage, SearchProgress>>;
  autoAdvance?: boolean;
};
export type Wave = { rng: number; candidates: Candidate[]; restart?: boolean };
export const STAGES: readonly Stage[];
export const LABELS: Record<Stage, string>;
export const SECONDS: Record<Stage, number>;
export const FORMAT: string;
export const STORAGE_KEY: string;
export const WAVE_SIZE: number;
export function scenarios(stage: Stage): TrialOptions[];
export type TrialCheck = {
  label: string;
  value: number;
  limit: number;
  operator: '>=' | '>' | '<=' | '<';
  unit: string;
  passed: boolean;
  deficit: number;
};
export const STAGNATION: number;
export function trialChecks(stage: Stage, metrics: Metrics): TrialCheck[];
export function evaluationDeficit(stage: Stage, evaluation: Evaluation): number;
export function qualifies(stage: Stage, metrics: Metrics): boolean;
export function selectSkill(checkpoint: Checkpoint, stage: Stage): Checkpoint;
export function seedFromEntry(checkpoint: Checkpoint, entry: Entry): Checkpoint;
export function skillProgress(checkpoint: Checkpoint): SearchProgress;
export function assess(stage: Stage, policy: number[]): Evaluation;
export function emptyCheckpoint(seed?: number): Checkpoint;
export function propose(checkpoint: Checkpoint, initial: number[], gaitSeed?: number[]): Wave;
export function legacyPropose(checkpoint: Checkpoint, initial: number[]): Wave;
export function completeWave(
  checkpoint: Checkpoint,
  wave: Wave,
  evaluations: Evaluation[],
  legacy?: boolean,
): Checkpoint;
export function nextStage(checkpoint: Checkpoint): Checkpoint;
export function parseCheckpoint(source: string): Checkpoint;
