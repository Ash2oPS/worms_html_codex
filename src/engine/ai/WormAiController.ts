import { clamp, distance } from '../../core/math';
import type { MatchState, WormState } from '../../domain/state';
import type { InputFrame } from '../input/InputMapper';
import { WeaponCatalog } from '../combat/WeaponCatalog';
import { HeightMapTerrain } from '../terrain/HeightMapTerrain';

interface AiTurnMemory {
  turnNumber: number;
  wormId: string;
  previousX: number;
  stuckFrames: number;
  alignmentFrames: number;
  jumpCooldownFrames: number;
  framesInTurn: number;
}

export class WormAiController {
  private static readonly APPROACH_DISTANCE = 400;
  private static readonly EVADE_DISTANCE = 80;
  private static readonly AIM_TOLERANCE_DEG = 2.4;
  private static readonly POWER_TOLERANCE = 0.028;
  private static readonly MIN_FIRE_ALIGNMENT_FRAMES = 4;
  private static readonly MIN_TURN_FRAMES_BEFORE_FIRE = 10;
  private static readonly URGENT_FIRE_MS = 5200;
  private static readonly REPOSITION_IF_BLOCKED_DISTANCE = 110;
  private static readonly MIN_SAFE_FIRE_DISTANCE = 84;
  private static readonly STUCK_MOVEMENT_EPSILON = 0.5;
  private static readonly STUCK_FRAMES_FOR_JUMP = 18;
  private static readonly JUMP_COOLDOWN_FRAMES = 48;

  private memory: AiTurnMemory | null = null;
  private lastTotalHp: number | null = null;
  private stagnantDamageMs = 0;

  constructor(
    private readonly weaponCatalog: WeaponCatalog,
    private readonly gravityY: number,
    private readonly terrain: HeightMapTerrain,
  ) {}

  sample(match: MatchState, worm: WormState, deltaMs: number): InputFrame {
    this.updateStalemateTracker(match, deltaMs);
    const input = this.createEmptyFrame();
    if (match.phase !== 'aiming' || !worm.alive) {
      return input;
    }

    const target = this.pickNearestEnemy(match, worm);
    if (!target) {
      return input;
    }

    const memory = this.resolveTurnMemory(match, worm);
    memory.framesInTurn += 1;
    memory.jumpCooldownFrames = Math.max(0, memory.jumpCooldownFrames - 1);

    const dx = target.position.x - worm.position.x;
    const horizontalDistance = Math.abs(dx);
    const planarDistance = distance(worm.position, target.position);
    const aliveEnemyCount = this.countAliveEnemies(match, worm.teamId);
    const stalematePressure = this.resolveStalematePressure();
    const desiredFacing = dx >= 0 ? 1 : -1;

    const verticalDelta = target.position.y - worm.position.y;
    const jitter = this.computeTurnJitter(match.turnNumber, worm.id, aliveEnemyCount, stalematePressure);
    const desiredPower = clamp(
      this.computeDesiredPower(horizontalDistance, verticalDelta) + jitter.power,
      0.35,
      1,
    );
    const desiredAim = clamp(
      this.computeDesiredAim(worm, target, desiredPower, horizontalDistance) + jitter.aimDeg,
      10,
      82,
    );
    const preferredApproachDistance = aliveEnemyCount <= 1
      ? 220
      : aliveEnemyCount === 2
        ? 320
        : WormAiController.APPROACH_DISTANCE;
    const pressuredApproachDistance = Math.max(
      120,
      preferredApproachDistance - (170 * stalematePressure),
    );
    const lineCheckOrigin = {
      x: worm.position.x,
      y: worm.position.y - (worm.radius * 0.4),
    };
    const lineCheckTarget = {
      x: target.position.x,
      y: target.position.y - (target.radius * 0.4),
    };
    const shotLineBlocked = this.terrain.segmentHitsTerrain(lineCheckOrigin, lineCheckTarget);
    const needsRepositionForShot = (
      shotLineBlocked
      && horizontalDistance > WormAiController.REPOSITION_IF_BLOCKED_DISTANCE
      && verticalDelta > -95
    );

    let moveAxis = 0;
    if (needsRepositionForShot) {
      moveAxis = this.toAxis(dx);
    } else if (shotLineBlocked && horizontalDistance <= WormAiController.REPOSITION_IF_BLOCKED_DISTANCE) {
      moveAxis = Math.abs(dx) > 4
        ? this.toAxis(dx)
        : (worm.facing === 1 ? -1 : 1);
    } else if (horizontalDistance > pressuredApproachDistance) {
      moveAxis = this.toAxis(dx);
    } else if (horizontalDistance < WormAiController.EVADE_DISTANCE && !shotLineBlocked) {
      moveAxis = this.toAxis(-dx);
    } else if (worm.facing !== desiredFacing) {
      moveAxis = desiredFacing;
    }
    input.moveAxis = moveAxis;

    if (Math.abs(moveAxis) > 0.01 && worm.isGrounded) {
      const movedDistance = Math.abs(worm.position.x - memory.previousX);
      if (movedDistance < WormAiController.STUCK_MOVEMENT_EPSILON) {
        memory.stuckFrames += 1;
      } else {
        memory.stuckFrames = 0;
      }
    } else {
      memory.stuckFrames = Math.max(0, memory.stuckFrames - 1);
    }
    memory.previousX = worm.position.x;

    if (
      worm.isGrounded
      && Math.abs(moveAxis) > 0.01
      && memory.stuckFrames >= WormAiController.STUCK_FRAMES_FOR_JUMP
      && memory.jumpCooldownFrames === 0
    ) {
      const preferredAdvanceAxis = this.toAxis(dx);
      const obstacleHeight = this.estimateForwardObstacleHeight(
        worm,
        preferredAdvanceAxis === 0 ? worm.facing : preferredAdvanceAxis,
      );
      const shouldUseBackJump = preferredAdvanceAxis !== 0 && obstacleHeight > (worm.radius * 0.9);
      if (shouldUseBackJump) {
        input.moveAxis = -preferredAdvanceAxis;
        input.backJumpPressed = true;
      } else {
        input.jumpPressed = true;
      }
      memory.stuckFrames = 0;
      memory.jumpCooldownFrames = WormAiController.JUMP_COOLDOWN_FRAMES;
    }

    const aimDelta = desiredAim - worm.aimDeg;
    if (Math.abs(aimDelta) > WormAiController.AIM_TOLERANCE_DEG) {
      input.aimAxis = this.toAxis(aimDelta);
    }

    const powerDelta = desiredPower - worm.power;
    if (Math.abs(powerDelta) > WormAiController.POWER_TOLERANCE) {
      input.powerAxis = this.toAxis(powerDelta);
    }

    const alignedForShot = (
      Math.abs(aimDelta) <= WormAiController.AIM_TOLERANCE_DEG
      && Math.abs(powerDelta) <= WormAiController.POWER_TOLERANCE
      && Math.abs(moveAxis) < 0.01
      && worm.facing === desiredFacing
    );

    if (alignedForShot) {
      memory.alignmentFrames += 1;
    } else {
      memory.alignmentFrames = 0;
    }

    const safeFireDistance = Math.max(
      52,
      WormAiController.MIN_SAFE_FIRE_DISTANCE - (28 * stalematePressure),
    );
    const minAlignmentFrames = Math.max(
      1,
      Math.round(WormAiController.MIN_FIRE_ALIGNMENT_FRAMES - (2 * stalematePressure)),
    );
    const urgentFireMs = WormAiController.URGENT_FIRE_MS + (2600 * stalematePressure);

    const readyToFire = (
      worm.isGrounded
      && !input.jumpPressed
      && !input.backJumpPressed
      && planarDistance > safeFireDistance
      && !needsRepositionForShot
      && (
        (
          memory.framesInTurn >= WormAiController.MIN_TURN_FRAMES_BEFORE_FIRE
          && memory.alignmentFrames >= minAlignmentFrames
        )
        || (
          memory.framesInTurn >= WormAiController.MIN_TURN_FRAMES_BEFORE_FIRE
          && match.turnTimeLeftMs <= urgentFireMs
        )
      )
    );

    if (readyToFire) {
      input.firePressed = true;
    }

    return input;
  }

  private countAliveEnemies(match: MatchState, teamId: string): number {
    let count = 0;
    for (const worm of match.worms) {
      if (worm.alive && worm.teamId !== teamId) {
        count += 1;
      }
    }
    return count;
  }

  private updateStalemateTracker(match: MatchState, deltaMs: number): void {
    const totalHp = match.worms.reduce((sum, worm) => sum + Math.max(0, worm.health), 0);
    if (this.lastTotalHp === null) {
      this.lastTotalHp = totalHp;
      this.stagnantDamageMs = 0;
      return;
    }

    if (totalHp < this.lastTotalHp) {
      this.stagnantDamageMs = 0;
    } else {
      this.stagnantDamageMs = Math.min(120000, this.stagnantDamageMs + deltaMs);
    }
    this.lastTotalHp = totalHp;
  }

  private resolveStalematePressure(): number {
    if (this.stagnantDamageMs >= 55000) {
      return 1;
    }

    if (this.stagnantDamageMs >= 35000) {
      return 0.6;
    }

    if (this.stagnantDamageMs >= 22000) {
      return 0.3;
    }

    return 0;
  }

  private computeTurnJitter(
    turnNumber: number,
    wormId: string,
    aliveEnemyCount: number,
    stalematePressure: number,
  ): { aimDeg: number; power: number } {
    const seed = `${turnNumber}:${wormId}`;
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(index);
      hash |= 0;
    }

    const normalized = ((hash >>> 0) % 1000) / 999;
    const amplitudeFactor = (aliveEnemyCount <= 2 ? 1 : 0.6) + (0.45 * stalematePressure);
    const aimDeg = (normalized - 0.5) * 8 * amplitudeFactor;
    const power = (0.5 - normalized) * 0.12 * amplitudeFactor;
    return { aimDeg, power };
  }

  private createEmptyFrame(): InputFrame {
    return {
      moveAxis: 0,
      aimAxis: 0,
      powerAxis: 0,
      menuMoveX: 0,
      menuMoveY: 0,
      menuPointerSelect: null,
      jumpPressed: false,
      backJumpPressed: false,
      firePressed: false,
      fireHeld: false,
      fireReleased: false,
      weaponMenuTogglePressed: false,
      menuConfirmPressed: false,
      menuCancelPressed: false,
      forceTurnEndPressed: false,
    };
  }

  private pickNearestEnemy(match: MatchState, worm: WormState): WormState | null {
    let bestTarget: WormState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of match.worms) {
      if (!candidate.alive || candidate.teamId === worm.teamId) {
        continue;
      }

      const candidateDistance = distance(worm.position, candidate.position);
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
        bestTarget = candidate;
      }
    }

    return bestTarget;
  }

  private resolveTurnMemory(match: MatchState, worm: WormState): AiTurnMemory {
    if (
      this.memory
      && this.memory.turnNumber === match.turnNumber
      && this.memory.wormId === worm.id
    ) {
      return this.memory;
    }

    this.memory = {
      turnNumber: match.turnNumber,
      wormId: worm.id,
      previousX: worm.position.x,
      stuckFrames: 0,
      alignmentFrames: 0,
      jumpCooldownFrames: 0,
      framesInTurn: 0,
    };
    return this.memory;
  }

  private computeDesiredPower(horizontalDistance: number, verticalDelta: number): number {
    const distanceFactor = clamp(horizontalDistance / 690, 0, 1);
    const verticalBoost = verticalDelta < -36 ? 0.08 : 0;
    const verticalReduction = verticalDelta > 72 ? 0.08 : 0;
    return clamp(0.44 + (distanceFactor * 0.54) + verticalBoost - verticalReduction, 0.35, 1);
  }

  private estimateForwardObstacleHeight(worm: WormState, direction: number): number {
    if (direction === 0) {
      return 0;
    }

    const worldWidth = this.terrain.getWorldWidth();
    const nearProbeX = clamp(worm.position.x + (direction * worm.radius * 1.25), 0, worldWidth - 1);
    const farProbeX = clamp(worm.position.x + (direction * worm.radius * 2.4), 0, worldWidth - 1);
    const currentGroundY = this.terrain.getGroundY(worm.position.x);
    const nearGroundY = this.terrain.getGroundY(nearProbeX);
    const farGroundY = this.terrain.getGroundY(farProbeX);
    const highestAheadGroundY = Math.min(nearGroundY, farGroundY);
    return currentGroundY - highestAheadGroundY;
  }

  private computeDesiredAim(
    worm: WormState,
    target: WormState,
    desiredPower: number,
    horizontalDistance: number,
  ): number {
    const weapon = this.weaponCatalog.getById(worm.selectedWeaponId);
    const shotSpeed = weapon.projectile.speed * desiredPower;
    const verticalDisplacementUp = worm.position.y - target.position.y;
    const ballisticAngle = this.solveBallisticAngle(
      shotSpeed,
      horizontalDistance,
      verticalDisplacementUp,
      this.gravityY,
    );
    if (ballisticAngle !== null) {
      return clamp(ballisticAngle, 10, 82);
    }

    let fallbackAim = 52;
    if (horizontalDistance < 140) {
      fallbackAim = 74;
    } else if (horizontalDistance < 280) {
      fallbackAim = 62;
    } else if (horizontalDistance < 430) {
      fallbackAim = 52;
    } else if (horizontalDistance < 640) {
      fallbackAim = 42;
    } else {
      fallbackAim = 34;
    }

    const verticalOffset = clamp((verticalDisplacementUp / 18), -10, 12);
    return clamp(fallbackAim + verticalOffset, 10, 82);
  }

  private solveBallisticAngle(
    speed: number,
    horizontalDistance: number,
    verticalDisplacementUp: number,
    gravity: number,
  ): number | null {
    if (speed <= 0 || horizontalDistance <= 2 || gravity <= 0) {
      return null;
    }

    const speedSq = speed * speed;
    const discriminant = (
      (speedSq * speedSq)
      - (gravity * ((gravity * horizontalDistance * horizontalDistance) + (2 * verticalDisplacementUp * speedSq)))
    );
    if (discriminant <= 0) {
      return null;
    }

    const sqrtDiscriminant = Math.sqrt(discriminant);
    const tanLow = (speedSq - sqrtDiscriminant) / (gravity * horizontalDistance);
    const tanHigh = (speedSq + sqrtDiscriminant) / (gravity * horizontalDistance);
    const lowDeg = this.radToDeg(Math.atan(tanLow));
    const highDeg = this.radToDeg(Math.atan(tanHigh));
    const preferredHigh = clamp(highDeg, 12, 82);
    const preferredLow = clamp(lowDeg, 12, 82);

    if (horizontalDistance < 180) {
      return preferredHigh;
    }

    if (horizontalDistance > 520) {
      return preferredLow;
    }

    return clamp((preferredHigh * 0.6) + (preferredLow * 0.4), 12, 82);
  }

  private radToDeg(value: number): number {
    return (value * 180) / Math.PI;
  }

  private toAxis(value: number): number {
    if (value > 0) {
      return 1;
    }
    if (value < 0) {
      return -1;
    }
    return 0;
  }
}
