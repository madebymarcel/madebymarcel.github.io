export const PITCH = { length: 35, width: 23, goalWidth: 1.5, goalBottom: 2, goalTop: 3 };
export const DT = 0.1;
export const RULESET = 'icf-2025-prototype-v2';
export const HALF_TICKS = 600 / DT;
export const SHOT_TICKS = 60 / DT;
export const POSSESSION_TICKS = 5 / DT;
export const BALL_RADIUS = 0.11;

export type Team = 0 | 1;
export type Phase = 'play' | 'restart' | 'half-time' | 'finished';
export type RestartKind = 'free-shot' | 'free-throw' | 'corner' | 'goal-line' | 'centre';

export interface Point {
  x: number;
  y: number;
}

export interface Player extends Point {
  id: number;
  team: Team;
  heading: number;
  yawRate: number;
  stroke: number;
  strokeTicks: number;
  vx: number;
  vy: number;
}

export interface Ball extends Point {
  z: number;
  vx: number;
  vy: number;
  vz: number;
  owner: number | null;
  lastTouch: number | null;
  restrictedThrower: number | null;
}

export interface Action {
  paddle: number;
  ball: number;
  aim?: number;
  power?: number;
}

export interface Decision {
  tick: number;
  kind: 'start' | 'goal' | 'foul' | 'out' | 'half-time' | 'finish' | 'restart';
  message: string;
  rule: string;
  team?: Team;
  player?: number;
}

export interface Restart extends Point {
  team: Team;
  kind: RestartKind;
  ticks: number;
}

export interface MatchState {
  players: Player[];
  ball: Ball;
  score: [number, number];
  fouls: [number, number];
  half: 1 | 2;
  ticks: number;
  phase: Phase;
  restart: Restart | null;
  pauseTicks: number;
  possessionTicks: number;
  possessionTeam: Team | null;
  shotTicks: number;
  events: Decision[];
}

export function other(team: Team): Team {
  return team === 0 ? 1 : 0;
}

export function attackDirection(team: Team, half: 1 | 2): number {
  return (team === 0 ? 1 : -1) * (half === 1 ? 1 : -1);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
