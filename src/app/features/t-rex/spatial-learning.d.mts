type Point = { x: number; y: number; z: number };
export type Segment = {
  outline: Point[];
  name: string;
  width: number;
  depth: number;
  start: Point;
  end: Point;
};
export type Metrics = {
  ticks: number;
  fell: boolean;
  distance: number;
  steps: number;
  score: number;
};
export function trial(policy: number[]): {
  rig: { frame(): Segment[] };
  advance(): void;
  metrics(): Metrics;
  readonly done: boolean;
};
export function trainer(seed: number): () => { iteration: number; policy: number[]; score: number };
