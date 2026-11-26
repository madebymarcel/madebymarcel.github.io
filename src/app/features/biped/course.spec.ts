import { describe, expect, it } from 'vitest';
import { Parkour, type PolicyBook } from './course';
import { GAP, SKILLS, StairProgress } from './tasks';
import { inputBuffer, Practice, startFor, Trainer } from './training';
import { Walker } from './walker';

describe('Skill labs and parkour', () => {
  it('constructs separate terrains and a fallen recovery start', () => {
    const lab = (skill: (typeof SKILLS)[number]) =>
      new Practice(skill, startFor(skill, 0), new Float64Array(3 * inputBuffer(skill).length));
    expect(lab('walk').sim.groundHeight(1)).toBe(0);
    expect(lab('jump').sim.groundHeight((GAP.from + GAP.to) / 2)).toBeLessThan(0);
    expect(lab('stairs').sim.groundHeight(2)).toBe(0.27);
    const recovery = lab('recover');
    recovery.step();
    expect(recovery.sim.fell).toBe(true);
    expect(recovery.done).toBe(false);
    expect(recovery.passed).toBe(false);
  });

  it('does not let a top-tread landing count as climbing the entire staircase', () => {
    const sim = new Walker();
    const tread = new StairProgress(-1.2);
    sim.contacts = [true, true, true, true];
    tread.update(sim);
    expect(tread.landed).toBe(0);
  });

  it('copies a walking checkpoint for running without changing the walker policy', () => {
    const walk = new Trainer(42);
    walk.train();
    const before = walk.checkpoint();
    const run = new Trainer(42, 'run', before.policy);
    expect(run.checkpoint().policy.slice(0, 21)).toEqual(before.policy.slice(0, 21));
    run.train();
    expect(run.checkpoint().policy).not.toEqual(before.policy);
    expect(walk.checkpoint()).toEqual(before);
  });

  it('reports an early course failure instead of skipping ahead or resetting the world', () => {
    const book = Object.fromEntries(
      SKILLS.map((skill) => [skill, new Trainer(42, skill).checkpoint()]),
    ) as PolicyBook;
    const course = new Parkour(book);
    const world = course.sim.world;
    for (let i = 0; i < 1350 && !course.done; i++) course.step();
    expect(course.sim.world).toBe(world);
    expect(course.done).toBe(true);
    expect(course.result()).toEqual({
      active: 'Walk',
      completed: [],
      failure: 'Robot fell',
      finished: false,
    });
  });
});
