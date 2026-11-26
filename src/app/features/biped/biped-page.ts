import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { CONTROL_DT, JOINT_NAMES, TRACK_GOAL } from './walker';
import { Parkour, SECTIONS, type CourseResult, type PolicyBook } from './course';
import { GOALS, NAMES, SKILLS, type Skill } from './tasks';
import {
  DEFAULT_SEED,
  EVALUATION_STARTS,
  inputBuffer,
  MAX_SEED,
  Practice,
  startFor,
} from './training';
import type { TrainingMessage, TrainingUpdate } from './biped.worker';

@Component({
  imports: [DecimalPipe],
  templateUrl: './biped-page.html',
  styleUrl: './biped-page.scss',
})
export class BipedPage {
  private readonly destroy = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly viewerHeading =
    viewChild.required<ElementRef<HTMLHeadingElement>>('viewerHeading');
  private worker?: Worker;
  private simulation: Practice | Parkour = this.practice('walk', null, 0);
  private replayKind: 'baseline' | 'best' = 'best';
  private hasPlayed = false;
  private animation?: number;
  private lastFrame?: number;
  private accumulator = 0;
  readonly seedInput = signal(String(DEFAULT_SEED));
  readonly seedValid = computed(() => {
    const seed = Number(this.seedInput());
    return Number.isInteger(seed) && seed >= 1 && seed <= MAX_SEED;
  });
  readonly maxSeed = MAX_SEED;
  readonly ready = signal(false);
  readonly playing = signal(false);
  readonly active = signal<Skill | null>(null);
  readonly awaitingWorker = signal(false);
  readonly selected = signal<Skill>('walk');
  readonly checkpoints = signal<Partial<Record<Skill, TrainingUpdate>>>({});
  readonly current = computed(() => this.checkpoints()[this.selected()]);
  readonly allTrained = computed(() => SKILLS.every((skill) => !!this.checkpoints()[skill]?.best));
  readonly replayIteration = signal(0);
  readonly trialIndex = signal(0);
  readonly frame = signal(this.simulation.sim.frame());
  readonly ground = signal(this.simulation.sim.ground);
  readonly distance = signal(0);
  readonly steps = signal(0);
  readonly finish = signal('');
  readonly course = signal<CourseResult | null>(null);
  readonly showSensors = signal(false);
  readonly viewing = computed(() => (this.course() ? 'Parkour' : NAMES[this.selected()]));
  readonly trainingError = signal('');
  readonly jointNames = JOINT_NAMES;
  readonly trackGoal = TRACK_GOAL;
  readonly trials = EVALUATION_STARTS;
  readonly skills = SKILLS;
  readonly names = NAMES;
  readonly goals = GOALS;
  readonly sections = SECTIONS;

  constructor() {
    afterNextRender(() => {
      try {
        this.worker = new Worker(new URL('./biped.worker', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({
          data,
        }: MessageEvent<TrainingUpdate | { active: Skill | null }>) => {
          this.awaitingWorker.set(false);
          if ('active' in data) {
            this.active.set(data.active);
          } else {
            this.checkpoints.update((old) => ({ ...old, [data.skill]: data }));
            this.ready.set(true);
          }
        };
        this.worker.onerror = () => this.failTraining();
      } catch {
        this.failTraining();
      }
    });
    this.destroy.onDestroy(() => {
      this.worker?.terminate();
      if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    });
  }

  private failTraining() {
    this.trainingError.set(
      'Background training is unavailable in this browser. You can still watch the baseline.',
    );
    this.active.set(null);
    this.ready.set(false);
    this.worker?.terminate();
    this.worker = undefined;
  }

  private send(message: TrainingMessage) {
    this.awaitingWorker.set(true);
    this.worker?.postMessage(message);
  }

  toggleTraining() {
    this.send(this.active() ? { type: 'pause' } : { type: 'start', skill: this.selected() });
  }

  trainAll() {
    this.send({ type: 'all' });
  }

  setSeed(event: Event) {
    this.seedInput.set((event.target as HTMLInputElement).value);
  }

  select(skill: Skill) {
    this.selected.set(skill);
    this.seedInput.set(String(this.checkpoints()[skill]?.seed ?? DEFAULT_SEED));
    this.trialIndex.set(0);
    this.replay('best');
    this.revealViewer();
  }

  resetTraining() {
    if (!this.seedValid()) return;
    const skill = this.selected();
    const seed = Number(this.seedInput());
    this.checkpoints.update((record) => ({ ...record, [skill]: undefined }));
    this.initReplay('best');
    this.send({ type: 'reset', skill, seed });
  }

  setTrial(event: Event) {
    const index = Number((event.target as HTMLSelectElement).value);
    if (!EVALUATION_STARTS[index]) return;
    this.trialIndex.set(index);
    const wasPlaying = this.playing();
    this.initReplay(this.replayKind);
    if (wasPlaying) this.resume();
  }

  replay(which: 'baseline' | 'best') {
    this.initReplay(which);
    this.resume();
  }

  private practice(skill: Skill, weights: number[] | null, start: number): Practice {
    return new Practice(
      skill,
      startFor(skill, start),
      weights ?? new Float64Array(3 * inputBuffer(skill).length),
    );
  }

  private initReplay(which: 'baseline' | 'best') {
    this.replayKind = which;
    const current = this.current();
    const checkpoint = (which === 'best' ? current?.best : undefined) ?? current?.baseline;
    this.replayIteration.set(checkpoint?.iteration ?? 0);
    this.load(this.practice(this.selected(), checkpoint?.policy ?? null, this.trialIndex()));
  }

  runCourse() {
    const book: Partial<PolicyBook> = {};
    for (const skill of SKILLS) {
      const checkpoint = this.checkpoints()[skill]?.best;
      if (!checkpoint) return;
      book[skill] = checkpoint;
    }
    this.load(new Parkour(book as PolicyBook));
    this.resume();
    this.revealViewer();
  }

  private revealViewer() {
    const heading = this.viewerHeading().nativeElement;
    const top = heading.getBoundingClientRect().top;
    if (top >= 0 && top < window.innerHeight) return;
    afterNextRender(
      () => {
        heading.scrollIntoView({ block: 'start', behavior: 'instant' });
        heading.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  private load(simulation: Practice | Parkour) {
    this.pause();
    this.hasPlayed = false;
    this.simulation = simulation;
    this.frame.set(simulation.sim.frame());
    this.ground.set(simulation.sim.ground);
    this.distance.set(0);
    this.steps.set(0);
    this.finish.set('');
    this.course.set(simulation instanceof Parkour ? simulation.result() : null);
  }

  togglePlayback() {
    if (this.playing()) {
      this.pause();
    } else if (this.course() && this.simulation.done) {
      this.runCourse();
    } else {
      if (!this.course() && (!this.hasPlayed || this.simulation.done)) {
        this.initReplay(this.replayKind);
      }
      this.resume();
    }
  }

  private pause() {
    this.playing.set(false);
    if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    this.animation = undefined;
    this.lastFrame = undefined;
    this.accumulator = 0;
  }

  private resume() {
    if (this.simulation.done || this.playing()) return;
    this.hasPlayed = true;
    this.playing.set(true);
    this.animation = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    const simulation = this.simulation;
    this.accumulator += Math.min(0.15, (now - (this.lastFrame ?? now)) / 1000);
    this.lastFrame = now;
    let advanced = false;
    while (!simulation.done && this.accumulator >= CONTROL_DT) {
      this.accumulator -= CONTROL_DT;
      simulation.step();
      advanced = true;
    }
    if (advanced) {
      this.frame.set(simulation.sim.frame());
      this.distance.set(simulation.sim.distance);
      this.steps.set(simulation.sim.steps);
      if (simulation instanceof Parkour) this.course.set(simulation.result());
    }
    if (simulation.done) {
      if (simulation instanceof Parkour) {
        const result = simulation.result();
        this.finish.set(
          result.finished ? 'Course complete' : result.active + ': ' + result.failure,
        );
      } else {
        this.finish.set(
          simulation.passed ? 'Trial passed' : simulation.sim.fell ? 'Fell' : 'Trial complete',
        );
      }
      this.pause();
      return;
    }
    this.animation = requestAnimationFrame(this.tick);
  };
}
