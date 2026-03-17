import type { RigidBody } from '@dimforge/rapier2d';
import type { PhysicsConfig } from '../../domain/config';
import type { Vec2, WormState } from '../../domain/state';
import { clamp } from '../../core/math';
import { RapierContext } from '../physics/RapierContext';
import { HeightMapTerrain } from '../terrain/HeightMapTerrain';

export class WormPhysicsSystem {
  private static readonly GROUND_SAMPLE_OFFSETS = [-0.62, 0, 0.62] as const;
  private static readonly GROUND_PROBE_DEPTH = 2.5;
  private static readonly GROUND_SNAP_TOLERANCE = 6;
  private static readonly SUPPORT_RAY_ORIGIN_OFFSET = 0.35;
  private static readonly SUPPORT_SURFACE_MIN_NORMAL_Y = -0.45;
  private static readonly MAX_UPWARD_GROUNDED_SPEED = 42;
  private static readonly COYOTE_FRAMES = 6;
  private static readonly JUMP_BUFFER_FRAMES = 7;
  private static readonly GROUND_NORMAL_SAMPLE_X = [-0.84, -0.42, 0, 0.42, 0.84] as const;
  private static readonly GROUND_NORMAL_SAMPLE_Y = [-0.78, -0.32, 0.14] as const;
  private static readonly GROUND_NORMAL_MIN_Y = -0.2;
  private static readonly GROUND_NORMAL_PROBE_LENGTH_FACTOR = 2.8;
  private static readonly GROUND_ROTATION_BLEND = 0.34;
  private static readonly AIR_ROTATION_BLEND = 0.2;
  private static readonly MAX_GROUND_TILT_RAD = 1.16;
  private static readonly BACK_JUMP_CONVERSION_FRAMES = 12;
  private static readonly DEFAULT_GROUND_NORMAL: Vec2 = { x: 0, y: -1 };

  private readonly coyoteFramesByWorm = new Map<string, number>();
  private readonly jumpBufferFramesByWorm = new Map<string, number>();
  private readonly backJumpBufferFramesByWorm = new Map<string, number>();
  private readonly jumpTakeoffFramesByWorm = new Map<string, number>();
  private readonly horizontalLockByWorm = new Map<string, boolean>();
  private readonly bodyHandlesByWorm = new Map<string, number>();
  private readonly groundNormalByWorm = new Map<string, Vec2>();
  private readonly groundAngleByWorm = new Map<string, number>();
  private readonly jumpForwardSpeed: number;
  private readonly backJumpSpeed: number;
  private readonly backJumpImpulse: number;

  constructor(
    private readonly rapier: RapierContext,
    private readonly config: PhysicsConfig,
  ) {
    this.jumpForwardSpeed = config.jumpForwardSpeed ?? Math.max(120, config.maxMoveSpeed * 0.82);
    this.backJumpSpeed = config.backJumpSpeed ?? Math.max(68, this.jumpForwardSpeed * 0.58);
    this.backJumpImpulse = config.backJumpImpulse ?? (config.jumpImpulse * 1.24);
  }

  createBody(worm: WormState): void {
    const bodyDesc = this.rapier.api.RigidBodyDesc
      .dynamic()
      .setTranslation(worm.position.x, worm.position.y)
      .setCanSleep(false)
      .setLinearDamping(1.2)
      .setAngularDamping(10);
    const body = this.rapier.world.createRigidBody(bodyDesc);
    body.lockRotations(true, true);

    const colliderDesc = this.rapier.api.ColliderDesc
      .ball(worm.radius)
      .setMass(6)
      .setFriction(0.38)
      .setRestitution(0.05);
    this.rapier.world.createCollider(colliderDesc, body);

    this.bodyHandlesByWorm.set(worm.id, body.handle);
    this.groundNormalByWorm.set(worm.id, { ...WormPhysicsSystem.DEFAULT_GROUND_NORMAL });
    this.groundAngleByWorm.set(worm.id, 0);
    this.coyoteFramesByWorm.set(worm.id, WormPhysicsSystem.COYOTE_FRAMES);
    this.jumpBufferFramesByWorm.set(worm.id, 0);
    this.backJumpBufferFramesByWorm.set(worm.id, 0);
    this.jumpTakeoffFramesByWorm.set(worm.id, 0);
    this.horizontalLockByWorm.set(worm.id, false);
  }

  removeBody(worm: WormState): void {
    const handle = this.bodyHandlesByWorm.get(worm.id);
    if (handle === undefined) {
      return;
    }

    const body = this.rapier.world.getRigidBody(handle);
    if (body) {
      this.rapier.world.removeRigidBody(body);
    }

    this.bodyHandlesByWorm.delete(worm.id);
    this.groundNormalByWorm.delete(worm.id);
    this.groundAngleByWorm.delete(worm.id);
    this.coyoteFramesByWorm.delete(worm.id);
    this.jumpBufferFramesByWorm.delete(worm.id);
    this.backJumpBufferFramesByWorm.delete(worm.id);
    this.jumpTakeoffFramesByWorm.delete(worm.id);
    this.horizontalLockByWorm.delete(worm.id);
  }

  hasBody(worm: WormState): boolean {
    return this.bodyHandlesByWorm.has(worm.id);
  }

  getGroundAnglesSnapshot(): ReadonlyMap<string, number> {
    return this.groundAngleByWorm;
  }

  setHorizontalMovementLocked(worm: WormState, locked: boolean): void {
    if (!worm.alive) {
      return;
    }

    const previousLockedState = this.horizontalLockByWorm.get(worm.id);
    if (previousLockedState === locked) {
      return;
    }

    const body = this.getBody(worm.id);
    if (!body) {
      return;
    }

    this.horizontalLockByWorm.set(worm.id, locked);
    body.setEnabledTranslations(!locked, true, true);

    if (locked) {
      const velocity = body.linvel();
      body.setLinvel({ x: 0, y: velocity.y }, true);
    }
  }

  applyImpulse(worm: WormState, impulse: Vec2): void {
    if (!worm.alive) {
      return;
    }

    const body = this.getBody(worm.id);
    if (!body) {
      return;
    }

    body.applyImpulse(impulse, true);
  }

  applyMovement(
    worm: WormState,
    moveAxis: number,
    jumpPressed: boolean,
    backJumpPressed: boolean,
    terrain: HeightMapTerrain,
  ): void {
    if (!worm.alive) {
      return;
    }

    const body = this.getBody(worm.id);
    if (!body) {
      return;
    }

    const isGroundedNow = this.isGrounded(body, worm, terrain);
    worm.isGrounded = isGroundedNow;
    const coyoteFrames = isGroundedNow
      ? WormPhysicsSystem.COYOTE_FRAMES
      : this.decrementFrameCounter(this.coyoteFramesByWorm, worm.id);
    if (isGroundedNow) {
      this.coyoteFramesByWorm.set(worm.id, coyoteFrames);
      this.jumpTakeoffFramesByWorm.set(worm.id, 0);
    }

    let bufferedJumpFrames = this.jumpBufferFramesByWorm.get(worm.id) ?? 0;
    if (jumpPressed) {
      bufferedJumpFrames = WormPhysicsSystem.JUMP_BUFFER_FRAMES;
    } else {
      bufferedJumpFrames = this.decrementFrameCounter(this.jumpBufferFramesByWorm, worm.id);
    }
    this.jumpBufferFramesByWorm.set(worm.id, bufferedJumpFrames);

    let bufferedBackJumpFrames = this.backJumpBufferFramesByWorm.get(worm.id) ?? 0;
    if (backJumpPressed) {
      bufferedBackJumpFrames = WormPhysicsSystem.JUMP_BUFFER_FRAMES;
    } else {
      bufferedBackJumpFrames = this.decrementFrameCounter(this.backJumpBufferFramesByWorm, worm.id);
    }
    this.backJumpBufferFramesByWorm.set(worm.id, bufferedBackJumpFrames);

    const jumpTakeoffFrames = this.decrementFrameCounter(this.jumpTakeoffFramesByWorm, worm.id);
    if (backJumpPressed && !worm.isGrounded && jumpTakeoffFrames > 0) {
      const convertedBackJumpX = clamp(-worm.facing * this.backJumpSpeed, -this.config.maxMoveSpeed, this.config.maxMoveSpeed);
      body.setLinvel({ x: convertedBackJumpX, y: -this.backJumpImpulse }, true);
      body.setLinearDamping(0.35);
      this.jumpTakeoffFramesByWorm.set(worm.id, 0);
      this.jumpBufferFramesByWorm.set(worm.id, 0);
      this.backJumpBufferFramesByWorm.set(worm.id, 0);
      worm.isGrounded = false;
      return;
    }

    const linvel = body.linvel();
    const maxMoveSpeed = this.config.maxMoveSpeed;
    const targetVelocityX = moveAxis * maxMoveSpeed;
    const acceleration = worm.isGrounded ? 0.28 : 0.12;
    let nextVelocityX = linvel.x + ((targetVelocityX - linvel.x) * acceleration);
    if (!worm.isGrounded) {
      nextVelocityX = linvel.x;
    } else if (Math.abs(moveAxis) > 0.01) {
      nextVelocityX = targetVelocityX;
    } else if (moveAxis === 0) {
      nextVelocityX *= 0.72;
    }

    let nextVelocityY = linvel.y;
    const canJump = (bufferedJumpFrames > 0 || bufferedBackJumpFrames > 0) && coyoteFrames > 0;
    if (canJump) {
      const useBackJump = bufferedBackJumpFrames > 0;
      nextVelocityX = useBackJump
        ? (-worm.facing * this.backJumpSpeed)
        : (worm.facing * this.jumpForwardSpeed);
      nextVelocityY = useBackJump
        ? -this.backJumpImpulse
        : -this.config.jumpImpulse;
      worm.isGrounded = false;
      this.coyoteFramesByWorm.set(worm.id, 0);
      this.jumpBufferFramesByWorm.set(worm.id, 0);
      this.backJumpBufferFramesByWorm.set(worm.id, 0);
      this.jumpTakeoffFramesByWorm.set(worm.id, WormPhysicsSystem.BACK_JUMP_CONVERSION_FRAMES);
    }

    const clampedX = clamp(nextVelocityX, -this.config.maxMoveSpeed, this.config.maxMoveSpeed);
    body.setLinvel({ x: clampedX, y: nextVelocityY }, true);
    body.setLinearDamping(worm.isGrounded ? 1.8 : 0.35);
  }

  syncWormTransforms(
    worms: WormState[],
    terrain: HeightMapTerrain,
    waterLevelY: number,
  ): WormState[] {
    const deadWorms: WormState[] = [];
    for (const worm of worms) {
      if (!worm.alive) {
        continue;
      }

      const body = this.getBody(worm.id);
      if (!body) {
        continue;
      }

      const position = body.translation();
      worm.position.x = position.x;
      worm.position.y = position.y;
      worm.isGrounded = this.isGrounded(body, worm, terrain);
      this.updateGroundOrientation(worm, body);

      const touchesWater = (worm.position.y + worm.radius) >= waterLevelY;
      const isOutOfBounds = worm.position.y > terrain.getWorldHeight() + 80;
      if (touchesWater || isOutOfBounds) {
        worm.health = 0;
        worm.alive = false;
        this.removeBody(worm);
        deadWorms.push(worm);
      }
    }

    return deadWorms;
  }

  private decrementFrameCounter(counters: Map<string, number>, wormId: string): number {
    const current = counters.get(wormId) ?? 0;
    const next = Math.max(0, current - 1);
    counters.set(wormId, next);
    return next;
  }

  private updateGroundOrientation(worm: WormState, body: RigidBody): void {
    const blend = worm.isGrounded
      ? WormPhysicsSystem.GROUND_ROTATION_BLEND
      : WormPhysicsSystem.AIR_ROTATION_BLEND;
    const targetNormal = worm.isGrounded
      ? this.sampleGroundNormal(worm, body)
      : null;
    const previousNormal = this.groundNormalByWorm.get(worm.id) ?? WormPhysicsSystem.DEFAULT_GROUND_NORMAL;
    const desiredNormal = targetNormal ?? WormPhysicsSystem.DEFAULT_GROUND_NORMAL;
    const smoothedNormal = this.normalizeVector(
      previousNormal.x + ((desiredNormal.x - previousNormal.x) * blend),
      previousNormal.y + ((desiredNormal.y - previousNormal.y) * blend),
    );
    this.groundNormalByWorm.set(worm.id, smoothedNormal);
    const targetAngle = Math.atan2(smoothedNormal.x, -smoothedNormal.y);
    this.groundAngleByWorm.set(
      worm.id,
      clamp(
        targetAngle,
        -WormPhysicsSystem.MAX_GROUND_TILT_RAD,
        WormPhysicsSystem.MAX_GROUND_TILT_RAD,
      ),
    );
  }

  private sampleGroundNormal(worm: WormState, body: RigidBody): Vec2 | null {
    const translation = body.translation();
    const rayLength = (worm.radius * WormPhysicsSystem.GROUND_NORMAL_PROBE_LENGTH_FACTOR)
      + WormPhysicsSystem.GROUND_SNAP_TOLERANCE;
    let normalXSum = 0;
    let normalYSum = 0;
    let totalWeight = 0;

    for (const yOffset of WormPhysicsSystem.GROUND_NORMAL_SAMPLE_Y) {
      const originY = translation.y + (worm.radius * yOffset);
      for (const xOffset of WormPhysicsSystem.GROUND_NORMAL_SAMPLE_X) {
        const originX = translation.x + (worm.radius * xOffset);
        const ray = new this.rapier.api.Ray(
          { x: originX, y: originY },
          { x: 0, y: 1 },
        );
        const hit = this.rapier.world.castRayAndGetNormal(
          ray,
          rayLength,
          false,
          undefined,
          undefined,
          undefined,
          body,
        );
        if (!hit) {
          continue;
        }

        const supportBody = hit.collider.parent();
        if (supportBody && supportBody.handle === body.handle) {
          continue;
        }

        let normalX = hit.normal.x;
        let normalY = hit.normal.y;
        if (normalY > 0) {
          normalX = -normalX;
          normalY = -normalY;
        }

        if (normalY > WormPhysicsSystem.GROUND_NORMAL_MIN_Y) {
          continue;
        }

        const weight = 1 / Math.max(0.2, hit.timeOfImpact ?? rayLength);
        normalXSum += normalX * weight;
        normalYSum += normalY * weight;
        totalWeight += weight;
      }
    }

    if (totalWeight <= 0) {
      return null;
    }

    return this.normalizeVector(normalXSum / totalWeight, normalYSum / totalWeight);
  }

  private normalizeVector(x: number, y: number): Vec2 {
    const lengthSq = (x * x) + (y * y);
    if (lengthSq < 1e-8) {
      return WormPhysicsSystem.DEFAULT_GROUND_NORMAL;
    }

    const invLength = 1 / Math.sqrt(lengthSq);
    return { x: x * invLength, y: y * invLength };
  }

  private isGrounded(body: RigidBody, worm: WormState, terrain: HeightMapTerrain): boolean {
    const translation = body.translation();
    const linvel = body.linvel();
    const worldWidth = terrain.getWorldWidth();
    const probeSpread = worm.radius;
    const footY = translation.y + worm.radius;
    const probeY = footY + WormPhysicsSystem.GROUND_PROBE_DEPTH;
    const supportRayLength = WormPhysicsSystem.GROUND_PROBE_DEPTH + WormPhysicsSystem.GROUND_SNAP_TOLERANCE;
    let closestGap = Number.POSITIVE_INFINITY;

    for (const offset of WormPhysicsSystem.GROUND_SAMPLE_OFFSETS) {
      const probeX = translation.x + (probeSpread * offset);
      if (probeX < 0 || probeX >= worldWidth) {
        continue;
      }

      if (terrain.isSolid(probeX, probeY)) {
        return true;
      }

      const gap = terrain.getGroundYBelow(probeX, footY) - footY;
      if (gap < closestGap) {
        closestGap = gap;
      }
    }

    if (linvel.y < -WormPhysicsSystem.MAX_UPWARD_GROUNDED_SPEED) {
      return false;
    }

    if (closestGap <= WormPhysicsSystem.GROUND_SNAP_TOLERANCE) {
      return true;
    }

    for (const offset of WormPhysicsSystem.GROUND_SAMPLE_OFFSETS) {
      const probeX = translation.x + (probeSpread * offset);
      if (probeX < 0 || probeX >= worldWidth) {
        continue;
      }

      const ray = new this.rapier.api.Ray(
        { x: probeX, y: footY - WormPhysicsSystem.SUPPORT_RAY_ORIGIN_OFFSET },
        { x: 0, y: 1 },
      );
      const hit = this.rapier.world.castRayAndGetNormal(
        ray,
        supportRayLength,
        false,
        undefined,
        undefined,
        undefined,
        body,
      );
      if (!hit) {
        continue;
      }

      const supportBody = hit.collider.parent();
      if (!supportBody || supportBody.handle === body.handle || !supportBody.isDynamic()) {
        continue;
      }

      if (hit.normal.y <= WormPhysicsSystem.SUPPORT_SURFACE_MIN_NORMAL_Y) {
        return true;
      }
    }

    return false;
  }

  private getBody(wormId: string): RigidBody | null {
    const handle = this.bodyHandlesByWorm.get(wormId);
    if (handle === undefined) {
      return null;
    }

    return this.rapier.world.getRigidBody(handle);
  }
}
