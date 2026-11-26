import { Component, DestroyRef, inject, signal } from '@angular/core';
import { type Checkpoint, type Practice } from '../biped/training';
import { CONTROL_DT, type Frame } from '../biped/walker';
import { REX_DEMO } from './t-rex-demo';
import { rexReplay } from './t-rex-walker';
import { type RexTrainingUpdate } from './t-rex.worker';

function overhead(frame: Frame) {
  return frame.legs.map(({ hip, knee, ankle, toe }, side) => {
    const flip = side === 0 ? -1 : 1;
    const x = (offset: number) => 210 + offset * flip;
    const y = (point: { x: number }) => 305 - (point.x - frame.torso.x) * 162;
    const points = {
      hip: [x(42), y(hip)],
      knee: [x(68), y(knee)],
      ankle: [x(72), y(ankle)],
      toe: [x(73), y(toe)],
    };
    return {
      shin: `M ${points.knee.join(' ')} L ${points.ankle.join(' ')}`,
      thigh: `M ${points.hip.join(' ')} Q ${x(67)} ${points.hip[1]} ${points.knee.join(' ')}`,
      foot: `translate(${points.toe.join(' ')}) scale(${-flip} 1)`,
    };
  });
}

@Component({
  templateUrl: './t-rex-page.html',
  styleUrl: './t-rex-page.scss',
})
export class TRexPage {
  readonly training = signal(false);
  readonly playing = signal(false);
  readonly iteration = signal(0);
  readonly best = signal<Checkpoint | undefined>(undefined);
  readonly limbs = signal<ReturnType<typeof overhead> | null>(null);
  readonly distance = signal(0);
  readonly steps = signal(0);
  readonly replayResult = signal('');
  readonly trainingError = signal('');
  private worker?: Worker;
  private replay?: Practice;
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.worker?.terminate();
      this.stopReplay();
    });
  }

  toggleTraining() {
    if (this.training()) {
      this.worker?.postMessage('pause');
      this.training.set(false);
      return;
    }
    try {
      this.worker ??= new Worker(new URL('./t-rex.worker', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }: MessageEvent<RexTrainingUpdate>) => {
        this.iteration.set(data.iteration);
        this.best.set(data.best);
      };
      this.worker.onerror = () => {
        this.training.set(false);
        this.trainingError.set('Training could not continue in this browser.');
        this.worker?.terminate();
        this.worker = undefined;
      };
      this.trainingError.set('');
      this.worker.postMessage('start');
      this.training.set(true);
    } catch {
      this.trainingError.set('Background training is unavailable in this browser.');
    }
  }

  playDemo() {
    this.play(REX_DEMO);
  }

  playBest() {
    const best = this.best();
    if (best) this.play(best);
  }

  private play(best: Checkpoint) {
    const { results } = best.evaluation;
    const index = results.reduce((selected, trial, i) => {
      const current = results[selected];
      return Number(trial.passed) > Number(current.passed) ||
        (trial.passed === current.passed && trial.distance > current.distance)
        ? i
        : selected;
    }, 0);
    this.stopReplay();
    this.replay = rexReplay(best.policy, index);
    this.replayResult.set('');
    this.publishPose(this.replay);
    this.playing.set(true);
    this.timer = setInterval(() => {
      if (!this.replay) return;
      this.replay.step();
      this.publishPose(this.replay);
      if (this.replay.done) {
        this.replayResult.set(
          this.replay.sim.fell
            ? 'Fell'
            : this.replay.passed
              ? 'Walk test passed'
              : 'Trial finished',
        );
        this.stopReplay();
      }
    }, CONTROL_DT * 1000);
  }

  stopReplay() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.playing.set(false);
  }

  private publishPose(replay: Practice) {
    this.limbs.set(overhead(replay.sim.frame()));
    this.distance.set(replay.sim.distance);
    this.steps.set(replay.sim.steps);
  }
}
