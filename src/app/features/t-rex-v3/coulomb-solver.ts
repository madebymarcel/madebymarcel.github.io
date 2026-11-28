import { FrictionEquation, GSSolver } from 'cannon-es';
import type { ContactEquation, Equation, World } from 'cannon-es';

export interface ContactForce {
  readonly contact: ContactEquation;
  readonly normal: number;
  readonly tangent: number;
}

interface Row {
  equation: Equation;
  bias: number;
  inverseDiagonal: number;
  impulse: number;
}

interface FrictionPair {
  normal: Row;
  x: Row;
  y: Row;
}

// Projected sequential impulses. Both tangent impulses share a circular
// Coulomb bound determined by the current normal impulse of this contact.
// The engine's reduced-mass friction must be disabled on the World.
export class CoulombSolver extends GSSolver {
  readonly forces: ContactForce[] = [];
  private readonly pool: FrictionEquation[] = [];

  constructor(readonly coefficient: number) {
    super();
    if (!Number.isFinite(coefficient) || coefficient < 0) {
      throw new Error('Invalid friction coefficient');
    }
  }

  override solve(dt: number, world: World): number {
    this.forces.length = 0;
    for (const body of world.bodies) {
      body.updateSolveMassProperties();
      body.vlambda.set(0, 0, 0);
      body.wlambda.set(0, 0, 0);
    }
    const makeRow = (equation: Equation): Row => ({
      equation,
      bias: equation.computeB(dt),
      inverseDiagonal: 1 / equation.computeC(),
      impulse: 0,
    });
    const rows = this.equations.map(makeRow);
    const byEquation = new Map(rows.map((row) => [row.equation, row]));
    const pairs: FrictionPair[] = [];
    let used = 0;
    for (const contact of world.contacts) {
      const normal = byEquation.get(contact);
      if (!normal || !contact.enabled) continue;
      const tangent = (): FrictionEquation => {
        const index = used++;
        const equation = this.pool[index] ?? new FrictionEquation(contact.bi, contact.bj, 0);
        this.pool[index] = equation;
        equation.bi = contact.bi;
        equation.bj = contact.bj;
        equation.ri.copy(contact.ri);
        equation.rj.copy(contact.rj);
        equation.setSpookParams(1e8, 4, dt);
        equation.enabled = true;
        return equation;
      };
      const x = tangent();
      const y = tangent();
      contact.ni.tangents(x.t, y.t);
      pairs.push({ normal, x: makeRow(x), y: makeRow(y) });
    }
    const propose = (row: Row): number =>
      row.impulse +
      row.inverseDiagonal *
        (row.bias - row.equation.computeGWlambda() - row.equation.eps * row.impulse);
    const apply = (row: Row, next: number): number => {
      const change = next - row.impulse;
      row.impulse = next;
      row.equation.addToWlambda(change);
      return Math.abs(change);
    };
    let completed = 0;
    for (; completed < this.iterations; completed++) {
      let error = 0;
      for (const row of rows) {
        const { minForce, maxForce } = row.equation;
        error += apply(row, Math.max(minForce, Math.min(maxForce, propose(row))));
      }
      for (const pair of pairs) {
        const x = propose(pair.x);
        const y = propose(pair.y);
        const limit = this.coefficient * Math.max(0, pair.normal.impulse);
        const magnitude = Math.hypot(x, y);
        const scale = magnitude > limit && magnitude > 0 ? limit / magnitude : 1;
        error += apply(pair.x, x * scale);
        error += apply(pair.y, y * scale);
      }
      if (error < this.tolerance) break;
    }
    for (const body of world.bodies) {
      body.velocity.vadd(body.vlambda.vmul(body.linearFactor), body.velocity);
      body.angularVelocity.vadd(body.wlambda.vmul(body.angularFactor), body.angularVelocity);
    }
    for (const row of rows) row.equation.multiplier = row.impulse / dt;
    for (const pair of pairs) {
      this.forces.push({
        contact: pair.normal.equation as ContactEquation,
        normal: pair.normal.impulse / dt,
        tangent: Math.hypot(pair.x.impulse, pair.y.impulse) / dt,
      });
    }
    return completed;
  }
}
