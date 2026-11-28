import { collectRollouts } from './rollout-collection';
import { collectDepRollouts } from './dep-rollout';
import type { RolloutProgress } from './rollout-collection';
import type { BrainJob, BrainResult } from './training-protocol';

export type RolloutResponse =
  | { type: 'progress'; progress: RolloutProgress }
  | { type: 'result'; result: BrainResult }
  | { type: 'error'; round: number; message: string };

function send(message: RolloutResponse): void {
  postMessage(message);
}

addEventListener('message', ({ data }: MessageEvent<BrainJob>) => {
  try {
    const progress = (event: RolloutProgress) => send({ type: 'progress', progress: event });
    const result =
      'brain' in data ? collectDepRollouts(data, progress) : collectRollouts(data, progress);
    send({ type: 'result', result });
  } catch (error) {
    send({
      type: 'error',
      round: data.round,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
