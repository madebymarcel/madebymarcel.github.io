import { ACTIONS, CONTROL_DT, Walker, type Ground } from './walker';
import { inputBuffer, policyInputs, type Checkpoint } from './training';
import {
  GAP,
  staircase,
  onBothFeet,
  soles,
  standing,
  STAIR_TOP,
  StairProgress,
  type Skill,
} from './tasks';

const WALK_END = 2;
const RUN_END = 7;
const JUMP_EDGE = RUN_END + GAP.from;
const JUMP_BANK = RUN_END + GAP.to;
const STAIRS_START = 10;
const TOP_START = STAIRS_START + 1.1;
const TRIP_LINE = 12.5;
const FINISH = 15;
const COURSE_GROUND: readonly Ground[] = [
  { from: -100, to: JUMP_EDGE, height: 0 },
  { from: JUMP_BANK, to: STAIRS_START, height: 0 },
  ...staircase(STAIRS_START, 100),
];

export const SECTIONS = [
  'Walk',
  'Run',
  'Jump & land',
  'Climb stairs',
  'Get up',
  'Walk to finish',
] as const;
type Section = (typeof SECTIONS)[number];

export type CourseResult = {
  completed: Section[];
  active: Section;
  failure: string;
  finished: boolean;
};
export type PolicyBook = Record<Skill, Checkpoint>;
const SKILL_FOR_SECTION: readonly Skill[] = ['walk', 'run', 'jump', 'stairs', 'recover', 'walk'];

export class Parkour {
  readonly sim = new Walker({}, { ground: COURSE_GROUND, allowFalls: true, seconds: 45 });
  private readonly action = new Float64Array(ACTIONS);
  private readonly walkInput = inputBuffer('walk');
  private readonly skillInput = inputBuffer('run');
  private index = 0;
  private entered = 0;
  private stepsAtEntry = 0;
  private slipAtEntry = 0;
  private jumped = false;
  private gapViolation = false;
  private held = 0;
  private readonly stairs = new StairProgress(STAIRS_START);
  private tookFall = false;
  private recoveryX = 0;
  private failure = '';
  private finished = false;

  constructor(private readonly book: PolicyBook) {}

  get done() {
    return this.finished || !!this.failure;
  }
  result(): CourseResult {
    return {
      completed: SECTIONS.slice(0, this.index),
      active: SECTIONS[Math.min(this.index, SECTIONS.length - 1)],
      failure: this.failure,
      finished: this.finished,
    };
  }

  private next() {
    this.index++;
    this.entered = this.sim.ticks;
    this.stepsAtEntry = this.sim.steps;
    if (this.index === 1) this.sim.resetRunningGait();
    this.slipAtEntry = this.sim.slipDistance;
    this.held = 0;
  }

  step() {
    if (this.done) return;
    const skill = SKILL_FOR_SECTION[this.index];
    const sim = this.sim;
    const input = skill === 'walk' ? this.walkInput : this.skillInput;
    sim.step(policyInputs(sim, skill, this.book[skill].policy, this.action, input));

    const x = sim.distance;
    const elapsed = (sim.ticks - this.entered) * CONTROL_DT;
    if (sim.done || elapsed > (skill === 'recover' ? 10 : 9)) {
      this.failure = 'Time limit reached';
      return;
    }
    if (sim.fell && this.index !== 4) {
      this.failure = 'Robot fell';
      return;
    }
    switch (this.index) {
      case 0:
        if (x >= WALK_END) {
          if (sim.steps < 2 || sim.slipDistance > 0.5) this.failure = 'No clean alternating walk';
          else this.next();
        }
        break;
      case 1:
        if (x >= RUN_END) {
          if (
            (RUN_END - WALK_END) / elapsed < 1.55 ||
            sim.steps - this.stepsAtEntry < 4 ||
            !sim.runningGait.qualifies(2) ||
            sim.slipDistance - this.slipAtEntry > 1.25
          ) {
            this.failure = 'Not enough speed or alternating running strides';
          } else this.next();
        }
        break;
      case 2:
        if (x > JUMP_EDGE && x < JUMP_BANK && !sim.contacts.some(Boolean)) this.jumped = true;
        if (
          sim
            .frame()
            .legs.some(({ heel, toe }) =>
              [heel, toe].some((p) => p.x > JUMP_EDGE && p.x < JUMP_BANK && p.y < -0.05),
            )
        )
          this.gapViolation = true;
        if (this.gapViolation) this.failure = 'A foot dropped into the gap';
        this.held =
          !sim.fell && soles(sim, JUMP_BANK) && sim.contacts.some(Boolean)
            ? this.held + CONTROL_DT
            : 0;
        if (this.held >= 0.3) {
          if (!this.jumped) this.failure = 'No airborne gap crossing';
          else this.next();
        }
        break;
      case 3:
        this.stairs.update(sim);
        if (x >= TRIP_LINE && soles(sim, TOP_START, STAIR_TOP) && onBothFeet(sim)) {
          if (this.stairs.landed !== 3) {
            this.failure = 'Not all three treads were used';
            break;
          }
          sim.trip();
          this.next();
        }
        break;
      case 4:
        if (sim.fell) this.tookFall = true;
        if (!this.tookFall && elapsed > 2) {
          this.failure = 'Trip did not produce a fall';
          break;
        }
        this.held = this.tookFall && standing(sim) ? this.held + CONTROL_DT : 0;
        if (this.held >= 1) {
          this.recoveryX = x;
          this.next();
        }
        break;
      case 5:
        this.finished =
          x >= Math.max(FINISH, this.recoveryX + 1.5) && sim.steps - this.stepsAtEntry >= 2;
        if (this.finished) this.next();
        break;
    }
  }
}
