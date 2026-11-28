import { evaluate, type Mode } from './v2-learning.mjs';
import { assessment, type Assessment } from './v2-search.mjs';
import type { TrialOptions } from './servo-learning.mjs';

export type Request =
  | { id: number; mode: Mode; policies: number[][]; start: TrialOptions }
  | { id: number; mode: Mode; policy: number[] };
export type Response =
  | { id: number; rewards: number[] }
  | { id: number; evaluation: Assessment }
  | { id: number; error: string };

addEventListener('message', ({ data }: MessageEvent<Request>) => {
  try {
    const response: Response =
      'policies' in data
        ? {
            id: data.id,
            rewards: data.policies.map((policy) => evaluate(policy, data.mode, data.start).score),
          }
        : { id: data.id, evaluation: assessment(data.policy, data.mode) };
    postMessage(response);
  } catch {
    postMessage({ id: data.id, error: 'Physics evaluation failed.' } satisfies Response);
  }
});
