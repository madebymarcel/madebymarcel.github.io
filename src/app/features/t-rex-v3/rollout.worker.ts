import { collectRollouts } from './rollout-collection';
import type { RolloutJob, RolloutProgress, RolloutResult } from './rollout-collection';

export type RolloutResponse =
  | { type: 'progress'; progress: RolloutProgress }
  | { type: 'result'; result: RolloutResult }
  | { type: 'error'; round: number; message: string };

function send(message: RolloutResponse): void {
  postMessage(message);
}

addEventListener('message', ({ data }: MessageEvent<RolloutJob>) => {
  try {
    const result = collectRollouts(data, (progress) => send({ type: 'progress', progress }));
    send({ type: 'result', result });
  } catch (error) {
    send({
      type: 'error',
      round: data.round,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
