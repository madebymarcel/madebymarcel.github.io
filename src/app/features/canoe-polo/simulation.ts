import {
  DT,
  HALF_TICKS,
  PITCH,
  POSSESSION_TICKS,
  attackDirection,
  clamp,
  distance,
  seededRandom,
  type Action,
  type Decision,
  type MatchState,
  type Player,
  type Restart,
  type Team,
} from './model';
import { assessPlay, halfExpired } from './referee';

const PADDLES = [
  [0, 0],
  [1, 1],
  [1, 0],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];

export class CanoeMatch {
  readonly state: MatchState;
  private readonly random: () => number;

  constructor(seed: number) {
    this.random = seededRandom(seed);
    this.state = {
      players: Array.from({ length: 10 }, (_, id) => ({
        id,
        team: id < 5 ? 0 : 1,
        x: 0,
        y: 0,
        heading: 0,
        vx: 0,
        vy: 0,
      })),
      ball: {
        x: 0,
        y: 0,
        z: 0.11,
        vx: 0,
        vy: 0,
        vz: 0,
        owner: null,
        lastTouch: null,
        restrictedThrower: null,
      },
      score: [0, 0],
      fouls: [0, 0],
      half: 1,
      ticks: 0,
      phase: 'play',
      restart: null,
      pauseTicks: 0,
      possessionTicks: 0,
      possessionTeam: null,
      shotTicks: 0,
      events: [],
    };
    this.lineUp();
    this.record({ tick: 0, kind: 'start', message: 'First half: sprint!', rule: 'Start of play' });
  }

  private lineUp(): void {
    const s = this.state;
    for (const p of s.players) {
      const direction = attackDirection(p.team, s.half);
      p.x = direction === 1 ? 2 : PITCH.length - 2;
      p.y = ((p.id % 5) + 1) * (PITCH.width / 6);
      p.heading = direction === 1 ? 0 : Math.PI;
      p.vx = 0;
      p.vy = 0;
    }
    Object.assign(s.ball, {
      x: PITCH.length / 2,
      y: PITCH.width / 2,
      z: 0.11,
      vx: 0,
      vy: 0,
      vz: 0,
      owner: null,
      lastTouch: null,
      restrictedThrower: null,
    });
    s.possessionTicks = 0;
    s.possessionTeam = null;
    s.shotTicks = 0;
  }

  private record(event: Decision): void {
    this.state.events.unshift(event);
    if (this.state.events.length > 80) this.state.events.pop();
  }

  private move(player: Player, action: Action): void {
    const [left, right] = PADDLES[action.paddle] ?? PADDLES[0];
    player.heading = (player.heading + (left - right) * 1.1 * DT) % (2 * Math.PI);
    const thrust = (left + right) * 1.8;
    player.vx = player.vx * 0.94 + Math.cos(player.heading) * thrust * DT;
    player.vy = player.vy * 0.94 + Math.sin(player.heading) * thrust * DT;
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > 3.5) {
      player.vx *= 3.5 / speed;
      player.vy *= 3.5 / speed;
    }
    player.x = clamp(player.x + player.vx * DT, 0.65, PITCH.length - 0.65);
    player.y = clamp(player.y + player.vy * DT, 0.65, PITCH.width - 0.65);
  }

  private resolveContacts(): void {
    const players = this.state.players;
    for (let i = 0; i < players.length; i++) {
      const a = players[i];
      for (let j = i + 1; j < players.length; j++) {
        const b = players[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= 1.3) continue;
        const nx = d > 0 ? dx / d : 1;
        const ny = d > 0 ? dy / d : 0;
        const push = (1.3 - d) / 2;
        a.x = clamp(a.x - nx * push, 0.65, PITCH.length - 0.65);
        a.y = clamp(a.y - ny * push, 0.65, PITCH.width - 0.65);
        b.x = clamp(b.x + nx * push, 0.65, PITCH.length - 0.65);
        b.y = clamp(b.y + ny * push, 0.65, PITCH.width - 0.65);
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (closing > 0) {
          const impulse = closing * 0.65;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        }
      }
    }
  }

  private takeBall(player: Player): void {
    const s = this.state;
    if (s.possessionTeam !== player.team) s.shotTicks = 0;
    if (s.ball.restrictedThrower !== player.id) s.ball.restrictedThrower = null;
    s.possessionTeam = player.team;
    s.possessionTicks = 0;
    Object.assign(s.ball, {
      owner: player.id,
      lastTouch: player.id,
      x: player.x,
      y: player.y,
      z: 1.1,
      vx: 0,
      vy: 0,
      vz: 0,
    });
  }

  private releaseBall(player: Player, action: number): void {
    const s = this.state;
    const aim = (action - 2) % 16;
    const power = action >= 18 ? 11 : 6;
    const direction = attackDirection(player.team, s.half);
    const angle = (aim * Math.PI) / 8 + (direction === 1 ? 0 : Math.PI);
    Object.assign(s.ball, {
      owner: null,
      lastTouch: player.id,
      x: player.x,
      y: player.y,
      z: 1.1,
      vx: Math.cos(angle) * power,
      vy: Math.sin(angle) * power,
      vz: 6.5,
    });
  }

  private beginRestart(restart: Omit<Restart, 'ticks'>): void {
    const s = this.state;
    s.phase = 'restart';
    s.restart = { ...restart, ticks: 10 };
    s.ball.owner = null;
    s.ball.restrictedThrower = null;
    s.ball.x = clamp(restart.x, 0.8, PITCH.length - 0.8);
    s.ball.y = clamp(restart.y, 0.8, PITCH.width - 0.8);
    s.ball.z = 0.11;
    s.ball.vx = 0;
    s.ball.vy = 0;
    s.ball.vz = 0;
    s.possessionTicks = 0;
    s.possessionTeam = restart.team;
    s.shotTicks = 0;
  }

  private resumeRestart(): void {
    const s = this.state;
    const restart = s.restart;
    if (!restart) return;
    if (restart.kind === 'centre') this.lineUp();
    const player = s.players
      .filter((p) => p.team === restart.team)
      .sort((a, b) => distance(a, restart) - distance(b, restart))[0];
    player.x = clamp(restart.x, 0.8, PITCH.length - 0.8);
    player.y = clamp(restart.y, 0.8, PITCH.width - 0.8);
    player.vx = 0;
    player.vy = 0;
    this.takeBall(player);
    if (restart.kind !== 'free-shot') s.ball.restrictedThrower = player.id;
    s.restart = null;
    s.phase = 'play';
    this.record({
      tick: s.ticks,
      kind: 'restart',
      message: 'Play resumes: ' + restart.kind,
      rule: 'Restart',
      team: restart.team,
    });
  }

  step(actions: readonly Action[]): Decision | null {
    const s = this.state;
    if (s.phase === 'finished') return null;
    if (s.phase === 'half-time') {
      if (--s.pauseTicks <= 0) {
        s.half = 2;
        this.lineUp();
        s.phase = 'play';
        this.record({
          tick: s.ticks,
          kind: 'start',
          message: 'Second half: sprint!',
          rule: 'Start of play',
        });
      }
      return null;
    }
    if (s.phase === 'restart') {
      if (s.restart && --s.restart.ticks <= 0) this.resumeRestart();
      return null;
    }

    s.ticks++;
    for (const player of s.players) this.move(player, actions[player.id]);
    this.resolveContacts();
    const previous = { ...s.ball };
    if (s.ball.owner !== null) {
      const owner = s.players[s.ball.owner];
      s.possessionTicks++;
      s.ball.x = owner.x;
      s.ball.y = owner.y;
      const action = actions[owner.id].ball;
      if (action >= 2 && s.possessionTicks <= POSSESSION_TICKS) {
        this.releaseBall(owner, action);
      }
    } else {
      const ball = s.ball;
      ball.x += ball.vx * DT;
      ball.y += ball.vy * DT;
      ball.z = Math.max(0.11, ball.z + ball.vz * DT);
      ball.vz = ball.z > 0.11 ? ball.vz - 9.81 * DT : 0;
      if (ball.z === 0.11) {
        ball.vx *= 0.86;
        ball.vy *= 0.86;
      }
      if (
        ball.x >= 0 &&
        ball.x <= PITCH.length &&
        ball.y >= 0 &&
        ball.y <= PITCH.width &&
        ball.z <= 2
      ) {
        const candidates = s.players
          .filter((p) => actions[p.id].ball === 1 && distance(p, ball) <= 1.25)
          .sort((a, b) => distance(a, ball) - distance(b, ball));
        // The thrower cannot immediately catch their own airborne release.
        const catcher = candidates.find((p) => p.id !== ball.lastTouch || ball.z === 0.11);
        if (catcher && this.random() < 0.85) this.takeBall(catcher);
      }
    }

    if (s.possessionTeam !== null) s.shotTicks++;
    const ruling = assessPlay(s, previous);
    if (ruling) {
      if (ruling.goal !== undefined) s.score[ruling.goal]++;
      if (ruling.decision.kind === 'foul' && ruling.decision.team !== undefined) {
        s.fouls[ruling.decision.team]++;
      }
      this.record(ruling.decision);
      if (ruling.restart) this.beginRestart(ruling.restart);
    }
    if (halfExpired(s)) {
      s.phase = s.ticks >= HALF_TICKS * 2 ? 'finished' : 'half-time';
      s.restart = null;
      s.pauseTicks = 15;
      this.record({
        tick: s.ticks,
        kind: s.phase === 'finished' ? 'finish' : 'half-time',
        message: s.phase === 'finished' ? 'Full time.' : 'Half time.',
        rule: 'Match duration',
      });
    }
    return ruling?.decision ?? null;
  }

  attackingGoal(team: Team): number {
    return attackDirection(team, this.state.half) === 1 ? PITCH.length : 0;
  }
}
