import { CONTROL_DT, FLAT_GROUND, Walker, type Ground, type Start } from './walker';

export const SKILLS = ['walk', 'run', 'jump', 'stairs', 'recover'] as const;
export type Skill = (typeof SKILLS)[number];
export const NAMES: Record<Skill, string> = {
  walk: 'Walk',
  run: 'Run',
  jump: 'Jump',
  stairs: 'Climb stairs',
  recover: 'Get up',
};
export const GAP = { from: 0.82, to: 1.37 };
const JUMP_GROUND: readonly Ground[] = [
  { from: -100, to: GAP.from, height: 0 },
  { from: GAP.to, to: 100, height: 0 },
];
const STAIR_X = 0.8;
const STAIR_SPAN = 0.55;
export const STAIR_TOP = 0.27;

export function staircase(x: number, end: number): Ground[] {
  return [
    { from: x, to: x + STAIR_SPAN, height: 0.09 },
    { from: x + STAIR_SPAN, to: x + 2 * STAIR_SPAN, height: 0.18 },
    { from: x + 2 * STAIR_SPAN, to: end, height: STAIR_TOP },
  ];
}
const STAIR_GROUND = [{ from: -100, to: STAIR_X, height: 0 }, ...staircase(STAIR_X, 100)];

export const GOALS: Record<Skill, string> = {
  walk: 'Walk 5 m without falling or shuffling.',
  run: 'Run as fast as possible without falling.',
  jump: 'Clear the gap and stay upright after landing.',
  stairs: 'Climb all three steps and finish with both feet on top.',
  recover: 'Stand from a fallen pose and hold it for one second.',
};

export function labWalker(skill: Skill, start: Start): Walker {
  if (skill === 'walk') return new Walker(start);
  if (skill === 'recover') return new Walker(start, { allowFalls: true, seconds: 8 });
  if (skill === 'jump') return new Walker(start, { ground: JUMP_GROUND, seconds: 7 });
  if (skill === 'stairs') return new Walker(start, { ground: STAIR_GROUND, seconds: 10 });
  return new Walker(start, { ground: FLAT_GROUND });
}

export function recoveryStart(start: Start, index: number): Start {
  return {
    ...start,
    vx: 0,
    tilt: (index % 2 === 0 ? 1 : -1) * (1.48 + 0.08 * (index % 3)) + (start.tilt ?? 0),
    crouch: 0.42,
  };
}

export function onBothFeet(sim: Walker) {
  return (sim.contacts[0] || sim.contacts[1]) && (sim.contacts[2] || sim.contacts[3]);
}

export function standing(sim: Walker) {
  const v = sim.torso.getLinearVelocity();
  const tilt = sim.torso.getAngle();
  return (
    !sim.fell &&
    Math.cos(tilt) > 0.94 &&
    onBothFeet(sim) &&
    sim.torso.getPosition().y - sim.groundHeight(sim.distance) > 0.87 &&
    Math.hypot(v.x, v.y) < 0.22 &&
    Math.abs(sim.torso.getAngularVelocity()) < 0.6
  );
}

export function soles(sim: Walker, beyond: number, height = 0) {
  return sim
    .frame()
    .legs.every(
      ({ heel, toe }) =>
        heel.x > beyond && toe.x > beyond && Math.min(heel.y, toe.y) > height - 0.035,
    );
}

export class StairProgress {
  landed = 0;
  constructor(private readonly start: number) {}

  update(sim: Walker) {
    if (this.landed === 3) return;
    const from = this.start + this.landed * STAIR_SPAN;
    const to = this.landed === 2 ? Infinity : from + STAIR_SPAN;
    const height = 0.09 * (this.landed + 1);
    const landed = sim.frame().legs.some((leg, index) => {
      const onTread = ({ x, y }: { x: number; y: number }) =>
        x >= from && x < to && Math.abs(y - height) < 0.035;
      return (
        (sim.contacts[2 * index] && onTread(leg.heel)) ||
        (sim.contacts[2 * index + 1] && onTread(leg.toe))
      );
    });
    if (landed) this.landed++;
  }
}

export function validRun(sim: Walker) {
  const time = sim.ticks * CONTROL_DT;
  return (
    !sim.fell &&
    sim.done &&
    sim.steps >= 8 &&
    sim.runningGait.qualifies(4) &&
    sim.flightTime / time <= 0.55 &&
    sim.slipDistance <= sim.distance * 0.25
  );
}

export class TaskProgress {
  passed = false;
  settled = 0;
  private jumped = false;
  private violatedGap = false;
  private lastDistance = 0;
  private lastWork = 0;
  private lastSlip = 0;
  private lastSteps = 0;
  private lastFlights = 0;
  private lastOtherFlights = 0;
  private lastAir = 0;
  private lastUpright = 0;
  private readonly stairs = new StairProgress(STAIR_X);

  constructor(readonly skill: Skill) {}

  update(sim: Walker, walkReward: number): number {
    const { skill } = this;
    if (skill === 'walk') return walkReward;
    const dx = sim.distance - this.lastDistance;
    const work = sim.work - this.lastWork;
    const slip = sim.slipDistance - this.lastSlip;
    const steps = sim.steps - this.lastSteps;
    const flights = sim.alternatingFlights - this.lastFlights;
    const air = sim.flightTime - this.lastAir;
    this.lastDistance = sim.distance;
    this.lastSlip = sim.slipDistance;
    this.lastWork = sim.work;
    this.lastSteps = sim.steps;
    this.lastFlights = sim.alternatingFlights;
    this.lastAir = sim.flightTime;
    const cost = 0.00018 * work + 0.65 * slip;
    if (skill === 'run') {
      const time = sim.ticks * CONTROL_DT;
      const otherFlights = sim.runningGait.otherFlights - this.lastOtherFlights;
      this.lastOtherFlights = sim.runningGait.otherFlights;
      const running = validRun(sim);
      this.passed = running && sim.distance / time >= 1.55;
      return dx + 0.1 * steps + 0.35 * flights - 0.3 * otherFlights - cost - (sim.fell ? 1.2 : 0);
    }
    if (skill === 'recover') {
      const tilt = sim.torso.getAngle();
      const height = sim.torso.getPosition().y;
      const supported = sim.contacts.some(Boolean);
      const upright = Math.min(height, 1.1) * 0.65 + 0.35 * Math.cos(tilt);
      this.settled = standing(sim) ? this.settled + CONTROL_DT : 0;
      this.passed = this.settled >= 1;
      const reward =
        (supported ? upright * CONTROL_DT * 0.4 : -0.15 * air) +
        this.settled * CONTROL_DT * 0.5 -
        Math.abs(dx) * 0.12 +
        1.5 * (upright - this.lastUpright) -
        cost * 0.4 +
        (this.passed ? 3 : 0);
      this.lastUpright = upright;
      return reward;
    }
    const wasPassed = this.passed;
    const lastStair = this.stairs.landed;
    if (skill === 'jump') {
      const inside = sim.distance > GAP.from && sim.distance < GAP.to;
      if (inside && air > 0 && !sim.contacts.some(Boolean)) this.jumped = true;
      if (
        sim
          .frame()
          .legs.some(({ heel, toe }) =>
            [heel, toe].some(({ x, y }) => x > GAP.from && x < GAP.to && y < -0.05),
          )
      )
        this.violatedGap = true;
      this.settled =
        this.jumped &&
        !this.violatedGap &&
        !sim.fell &&
        soles(sim, GAP.to) &&
        sim.contacts.some(Boolean)
          ? this.settled + CONTROL_DT
          : 0;
      this.passed = this.settled >= 0.3;
    } else {
      this.stairs.update(sim);
      this.settled =
        !sim.fell &&
        this.stairs.landed === 3 &&
        soles(sim, STAIR_X + 2 * STAIR_SPAN, STAIR_TOP) &&
        onBothFeet(sim)
          ? this.settled + CONTROL_DT
          : 0;
      this.passed = this.settled >= 0.2;
    }
    return (
      Math.min(dx, 1.4 * CONTROL_DT) +
      0.08 * steps -
      cost -
      (sim.fell ? 1 : 0) +
      0.65 * (this.stairs.landed - lastStair) +
      (this.passed && !wasPassed ? 3 : 0)
    );
  }
}
