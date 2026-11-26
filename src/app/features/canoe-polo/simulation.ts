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

import { launchBall } from './ball-play';
import { stepPaddle } from './paddle';
import { reachableBall, remember, turnHead } from './player-body';

export interface BallPlay {
  receiver: number;
  from: number | null;
  kind: 'recovery' | 'claim' | 'interception' | 'pass';
  progressive: boolean;
  escapesPressure: boolean;
  save?: boolean;
}

export class CanoeMatch {
  readonly state: MatchState;
  private readonly random: () => number;
  private passTarget: number | null = null;
  private pressureAtRelease = Infinity;
  private bestPassProgress = -Infinity;
  private escapeCredited = false;
  lastBallPlay: BallPlay | null = null;

  constructor(seed: number) {
    this.random = seededRandom(seed);
    this.state = {
      players: Array.from({ length: 10 }, (_, id) => ({
        id,
        team: id < 5 ? 0 : 1,
        x: 0,
        y: 0,
        heading: 0,
        headTurn: 0,
        dominantHand: id % 5 === 1 ? -1 : 1,
        seenBall: null,
        seenPlayers: Array(10).fill(null),
        yawRate: 0,
        stroke: 0,
        strokeTicks: 0,
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
      looseTicks: 0,
      possessionTeam: null,
      shotTicks: 0,
      events: [],
    };
    this.lineUp();
    this.refreshVision();
    this.record({ tick: 0, kind: 'start', message: 'First half: sprint!', rule: 'Start of play' });
  }

  refreshVision(): void {
    for (const player of this.state.players) remember(this.state, player);
  }

  private lineUp(): void {
    const s = this.state;
    this.resetPassSequence();
    for (const p of s.players) {
      const direction = attackDirection(p.team, s.half);
      p.x = direction === 1 ? 2 : PITCH.length - 2;
      p.y = ((p.id % 5) + 1) * (PITCH.width / 6);
      p.heading = direction === 1 ? 0 : Math.PI;
      p.vx = 0;
      p.vy = 0;
      p.yawRate = 0;
      p.headTurn = 0;
      p.seenBall = null;
      p.seenPlayers.fill(null);
      p.stroke = 0;
      p.strokeTicks = 0;
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
    s.looseTicks = 0;
    s.possessionTeam = null;
    s.shotTicks = 0;
  }

  private record(event: Decision): void {
    this.state.events.unshift(event);
    if (this.state.events.length > 80) this.state.events.pop();
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
    s.looseTicks = 0;
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

  private pressure(player: Player): number {
    return Math.min(
      ...this.state.players.filter((p) => p.team !== player.team).map((p) => distance(p, player)),
    );
  }

  private resetPassSequence(): void {
    this.passTarget = null;
    this.pressureAtRelease = Infinity;
    this.bestPassProgress = -Infinity;
    this.escapeCredited = false;
  }

  private wouldScore(ball: MatchState['ball'], shooter: Player): boolean {
    if (ball.restrictedThrower !== null) return false;
    const dir = attackDirection(shooter.team, this.state.half);
    if (ball.vx * dir < 0.2) return false;
    const plane = dir === 1 ? PITCH.length + 0.11 : -0.11;
    const time = (plane - ball.x) / ball.vx;
    if (time <= 0 || time > 2) return false;
    const y = ball.y + ball.vy * time;
    const z = ball.z + (ball.vz + 9.81 * DT * 0.5) * time - 9.81 * time * time * 0.5;
    return (
      Math.abs(y - PITCH.width / 2) <= PITCH.goalWidth / 2 - 0.11 &&
      z >= PITCH.goalBottom + 0.11 &&
      z <= PITCH.goalTop - 0.11
    );
  }

  private catchBall(player: Player): void {
    const s = this.state;
    const from = s.ball.lastTouch;
    const passer = from === null ? undefined : s.players[from];
    const kind = !passer
      ? 'claim'
      : passer.team !== player.team
        ? 'interception'
        : from === player.id
          ? 'recovery'
          : this.passTarget === player.id
            ? 'pass'
            : 'recovery';
    const save = kind === 'interception' && !!passer && this.wouldScore(s.ball, passer);
    if (s.possessionTeam !== player.team) this.resetPassSequence();
    const progress = player.x * attackDirection(player.team, s.half);
    const progressive = kind === 'pass' && progress >= this.bestPassProgress + 1.5;
    const escapesPressure =
      kind === 'pass' &&
      !this.escapeCredited &&
      this.pressureAtRelease < 2.5 &&
      this.pressure(player) > this.pressureAtRelease + 1;
    if (progressive) this.bestPassProgress = progress;
    if (escapesPressure) this.escapeCredited = true;
    this.lastBallPlay = { receiver: player.id, from, kind, progressive, escapesPressure, save };
    this.passTarget = null;
    this.takeBall(player);
  }

  private releaseBall(player: Player, action: Action): void {
    const s = this.state;
    const launch = launchBall(s, player, action);
    if (!launch) return;
    const { vx, vy, vz, target } = launch;
    this.passTarget = target;
    this.pressureAtRelease = this.pressure(player);
    this.bestPassProgress = Math.max(
      this.bestPassProgress,
      player.x * attackDirection(player.team, s.half),
    );
    Object.assign(s.ball, {
      owner: null,
      lastTouch: player.id,
      x: player.x,
      y: player.y,
      z: 1.1,
      vx,
      vy,
      vz,
    });
  }

  private beginRestart(restart: Omit<Restart, 'ticks'>): void {
    const s = this.state;
    this.resetPassSequence();
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
    s.looseTicks = 0;
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
    player.yawRate = 0;
    if (restart.kind !== 'centre') {
      // Face along the inward normal on a boundary restart; never align to a goal.
      const edge = Math.min(player.x, PITCH.length - player.x, player.y, PITCH.width - player.y);
      if (edge <= 1) {
        if (edge === player.y) player.heading = Math.PI / 2;
        else if (edge === PITCH.width - player.y) player.heading = -Math.PI / 2;
        else player.heading = player.x < PITCH.length / 2 ? 0 : Math.PI;
      }
    }
    player.headTurn = 0;
    player.stroke = 0;
    player.strokeTicks = 0;
    this.takeBall(player);
    if (restart.kind !== 'free-shot') s.ball.restrictedThrower = player.id;
    s.restart = null;
    s.phase = 'play';
    this.refreshVision();
    this.record({
      tick: s.ticks,
      kind: 'restart',
      message: 'Play resumes: ' + restart.kind,
      rule: 'Restart',
      team: restart.team,
    });
  }

  step(actions: readonly Action[]): Decision | null {
    this.lastBallPlay = null;
    const s = this.state;
    if (s.phase === 'finished') return null;
    if (s.phase === 'half-time') {
      if (--s.pauseTicks <= 0) {
        s.half = 2;
        this.lineUp();
        s.phase = 'play';
        this.refreshVision();
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
    for (const player of s.players) {
      const action = actions[player.id];
      turnHead(player, action.look ?? 0);
      const holding = s.ball.owner === player.id;
      if (holding) {
        player.stroke = 0;
        player.strokeTicks = 0;
      }
      stepPaddle(player, holding ? 0 : action.paddle);
    }
    this.resolveContacts();
    const previous = { ...s.ball };
    if (s.ball.owner !== null) {
      const owner = s.players[s.ball.owner];
      s.possessionTicks++;
      s.ball.x = owner.x;
      s.ball.y = owner.y;
      const action = actions[owner.id];
      if (action.ball >= 2 && s.possessionTicks <= POSSESSION_TICKS) {
        this.releaseBall(owner, action);
      }
    } else {
      const ball = s.ball;
      ball.x += ball.vx * DT;
      ball.y += ball.vy * DT;
      ball.z = Math.max(0.11, ball.z + ball.vz * DT);
      ball.vz = ball.z > 0.11 ? ball.vz - 9.81 * DT : 0;
      s.looseTicks = ball.z === 0.11 && Math.hypot(ball.vx, ball.vy) < 1.4 ? s.looseTicks + 1 : 0;
      if (ball.z === 0.11) {
        ball.vx *= 0.86;
        ball.vy *= 0.86;
      }
      if (
        ball.x >= 0 &&
        ball.x <= PITCH.length &&
        ball.y >= 0 &&
        ball.y <= PITCH.width &&
        ball.z <= 2.85
      ) {
        const candidates = s.players
          .filter((p) => actions[p.id].ball === 1 && reachableBall(p, ball))
          .sort((a, b) => distance(a, ball) - distance(b, ball));
        // The thrower cannot immediately catch their own airborne release.
        const catcher = candidates.find((p) => p.id !== ball.lastTouch || ball.z === 0.11);
        if (catcher && this.random() < 0.85) this.catchBall(catcher);
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
    this.refreshVision();
    return ruling?.decision ?? null;
  }

  attackingGoal(team: Team): number {
    return attackDirection(team, this.state.half) === 1 ? PITCH.length : 0;
  }
}
