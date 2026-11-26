import { FREE_THROW } from './ball-play';
import { PITCH, seededRandom, type Action } from './model';
import { sample } from './policy';
import { CanoeMatch } from './simulation';

export type Drill = 'collect' | 'shoot' | 'save';
export const DRILLS: readonly Drill[] = ['collect', 'shoot', 'save'];
export const TRIALS = 8;

export function runDrill(weights: readonly number[], drill: Drill, seed: number): boolean {
  const random = seededRandom(seed);
  const match = new CanoeMatch(seed);
  const s = match.state;
  s.players.forEach((p, i) =>
    Object.assign(p, {
      x: i % 2 === 0 ? 2 : 4,
      y: 2 + 2 * Math.floor(i / 2),
      heading: 0,
      headTurn: 0,
      seenBall: null,
      seenPlayers: Array(10).fill(null),
    }),
  );
  const player = s.players[0];
  if (drill === 'collect') {
    Object.assign(player, { x: 14, y: 11.5, heading: (random() - 0.5) * 3 });
    Object.assign(s.ball, { x: 18 + random() * 2, y: 8 + random() * 7 });
  } else if (drill === 'shoot') {
    Object.assign(player, {
      x: 24 + random() * 7,
      y: 8 + random() * 7,
      heading: (random() - 0.5) * 1.2,
    });
    Object.assign(s.ball, { x: player.x, y: player.y, z: 1.1, owner: 0, lastTouch: 0 });
    s.possessionTeam = 0;
  } else {
    // Repeatable goal-bound shots at varied points inside the defended goal.
    const shooter = s.players[5];
    Object.assign(shooter, { x: 10, y: 11.5, heading: Math.PI });
    Object.assign(player, { x: 2.5 + random(), y: 10.7 + random() * 1.6, heading: 0 });
    const goalY = PITCH.width / 2 + (random() - 0.5) * 0.78;
    const vx = -9.8;
    const time = (shooter.x + 0.11) / -vx;
    Object.assign(s.ball, {
      x: shooter.x,
      y: shooter.y,
      z: 1.1,
      vx,
      vy: (goalY - shooter.y) / time,
      vz: (2.5 - 1.1) / time + (9.81 * (time - 0.1)) / 2,
      owner: null,
      lastTouch: 5,
    });
    s.possessionTeam = 1;
  }
  match.refreshVision();
  const idle: Action = { paddle: 0, ball: 0 };
  let shot = false;
  for (let tick = 0; tick < (drill === 'collect' ? 160 : 75); tick++) {
    const action = sample(weights, s, player, random).action;
    if (drill === 'shoot' && s.ball.owner === 0 && action.ball !== FREE_THROW) action.ball = 0;
    if (drill === 'shoot' && action.ball === FREE_THROW) shot = true;
    match.step(s.players.map((p) => (p.id === 0 ? action : idle)));
    if (drill === 'collect' && s.ball.owner === 0) return Math.hypot(player.vx, player.vy) < 2.3;
    if (drill === 'shoot' && s.score[0]) return true;
    if (drill === 'save' && match.lastBallPlay?.receiver === 0) return !!match.lastBallPlay.save;
    if (s.phase !== 'play' || (shot && s.ball.z === 0.11 && s.ball.owner === null)) break;
  }
  return false;
}

export function evaluateDrills(weights: readonly number[]): Record<Drill, number> {
  return {
    collect: trials(weights, 'collect'),
    shoot: trials(weights, 'shoot'),
    save: trials(weights, 'save'),
  };
}

function trials(weights: readonly number[], drill: Drill): number {
  let successes = 0;
  for (let i = 0; i < TRIALS; i++) successes += Number(runDrill(weights, drill, 700001 + i * 97));
  return successes;
}
