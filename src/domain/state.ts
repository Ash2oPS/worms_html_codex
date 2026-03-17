export interface Vec2 {
  x: number;
  y: number;
}

export type Facing = -1 | 1;

export interface WormState {
  id: string;
  teamId: string;
  teamColor: string;
  name: string;
  health: number;
  maxHealth: number;
  radius: number;
  alive: boolean;
  facing: Facing;
  aimDeg: number;
  power: number;
  selectedWeaponId: string;
  position: Vec2;
  isGrounded: boolean;
}

export interface TeamState {
  id: string;
  name: string;
  color: string;
  wormIds: string[];
  controller: 'human' | 'ai';
}

export interface ProjectileState {
  id: string;
  ownerWormId: string;
  weaponId: string;
  radius: number;
  ageMs: number;
  position: Vec2;
  previousPosition: Vec2;
  bodyHandle: number;
  active: boolean;
}

export interface ExplosionVisual {
  id: string;
  position: Vec2;
  radius: number;
  ttlMs: number;
  maxTtlMs: number;
}

export interface DamageTextVisual {
  id: string;
  position: Vec2;
  damage: number;
  ttlMs: number;
  maxTtlMs: number;
}

export type MatchPhase = 'aiming' | 'projectile_flight' | 'post_shot' | 'match_over';

export interface MatchState {
  phase: MatchPhase;
  worms: WormState[];
  teams: TeamState[];
  projectiles: ProjectileState[];
  explosions: ExplosionVisual[];
  damageTexts: DamageTextVisual[];
  currentWormId: string;
  turnNumber: number;
  turnTimeLeftMs: number;
  windForce: number;
  winnerTeamId: string | null;
}

export interface GameTextSnapshot {
  coordinateSystem: string;
  phase: MatchPhase;
  turn: {
    number: number;
    currentWormId: string;
    currentTeamController: 'human' | 'ai' | 'unknown';
    turnTimeLeftMs: number;
    windForce: number;
  };
  hazards: {
    waterLevelY: number;
    playablePlatformCount: number;
  };
  worms: Array<{
    id: string;
    name: string;
    teamId: string;
    hp: number;
    alive: boolean;
    x: number;
    y: number;
    facing: Facing;
    grounded: boolean;
    aimDeg: number;
    power: number;
  }>;
  projectiles: Array<{
    id: string;
    weaponId: string;
    x: number;
    y: number;
  }>;
  weaponMenu: {
    open: boolean;
    cursorIndex: number;
    weaponIds: string[];
  };
  winnerTeamId: string | null;
}
