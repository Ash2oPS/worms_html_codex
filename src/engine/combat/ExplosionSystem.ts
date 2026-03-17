import type { MatchState, Vec2, WormState } from '../../domain/state';
import { IdFactory } from '../../core/idFactory';
import { distance, normalize } from '../../core/math';
import { HeightMapTerrain } from '../terrain/HeightMapTerrain';
import { WormPhysicsSystem } from '../worms/WormPhysicsSystem';
import { WeaponCatalog } from './WeaponCatalog';
import type { ExplosionRequest } from './types';

export class ExplosionSystem {
  private static readonly DEATH_EXPLOSION = {
    radius: 76,
    craterRadius: 56,
    maxDamage: 44,
    knockback: 255,
    ttlMs: 340,
  } as const;

  constructor(
    private readonly idFactory: IdFactory,
    private readonly terrain: HeightMapTerrain,
    private readonly weaponCatalog: WeaponCatalog,
    private readonly wormPhysics: WormPhysicsSystem,
  ) {}

  apply(match: MatchState, requests: ExplosionRequest[]): void {
    if (requests.length <= 0) {
      return;
    }

    this.terrain.beginMutationBatch();
    try {
      for (const request of requests) {
        const weapon = this.weaponCatalog.getById(request.weaponId);
        this.applyExplosion(match, {
          position: request.position,
          radius: weapon.explosion.radius,
          craterRadius: weapon.explosion.craterRadius,
          maxDamage: weapon.explosion.maxDamage,
          knockback: weapon.explosion.knockback,
          visualTtlMs: 380,
        });
      }
    } finally {
      this.terrain.endMutationBatch();
    }
  }

  triggerDeathExplosions(match: MatchState, deadWorms: WormState[]): number {
    let triggered = 0;
    if (deadWorms.length <= 0) {
      return triggered;
    }

    this.terrain.beginMutationBatch();
    try {
      for (const worm of deadWorms) {
        if (worm.alive) {
          continue;
        }

        this.applyDeathExplosion(match, worm.position);
        triggered += 1;
      }
    } finally {
      this.terrain.endMutationBatch();
    }
    return triggered;
  }

  updateVisuals(match: MatchState, deltaMs: number): void {
    for (const explosion of match.explosions) {
      explosion.ttlMs = Math.max(0, explosion.ttlMs - deltaMs);
    }
    for (const damageText of match.damageTexts) {
      damageText.ttlMs = Math.max(0, damageText.ttlMs - deltaMs);
    }

    match.explosions = match.explosions.filter((explosion) => explosion.ttlMs > 0);
    match.damageTexts = match.damageTexts.filter((damageText) => damageText.ttlMs > 0);
  }

  private damageWorms(
    match: MatchState,
    center: Vec2,
    radius: number,
    maxDamage: number,
  ): void {
    for (const worm of match.worms) {
      if (!worm.alive) {
        continue;
      }

      const dist = distance(center, worm.position);
      if (dist > radius) {
        continue;
      }

      const ratio = 1 - (dist / radius);
      const damage = Math.max(1, Math.round(maxDamage * ratio));
      worm.health = Math.max(0, worm.health - damage);
      match.damageTexts.push({
        id: this.idFactory.next('damage_fx'),
        position: {
          x: worm.position.x,
          y: worm.position.y - worm.radius - 10,
        },
        damage,
        ttlMs: 780,
        maxTtlMs: 780,
      });

      if (worm.health === 0) {
        this.handleWormDeath(match, worm);
      }
    }
  }

  private pushWorms(
    worms: WormState[],
    center: Vec2,
    radius: number,
    baseImpulse: number,
  ): void {
    for (const worm of worms) {
      if (!worm.alive) {
        continue;
      }

      const dist = distance(center, worm.position);
      const distanceToBodyEdge = Math.max(0, dist - worm.radius);
      if (distanceToBodyEdge > radius) {
        continue;
      }

      const falloff = 1 - (distanceToBodyEdge / radius);
      const upwardBias = Math.max(10, radius * 0.22);
      const direction = normalize({
        x: worm.position.x - center.x,
        y: worm.position.y - center.y - upwardBias,
      });
      const boostedBaseImpulse = baseImpulse * 3.15;
      const impulseStrength = boostedBaseImpulse * Math.max(0.52, falloff);
      const verticalLaunch = boostedBaseImpulse * (0.85 + (Math.max(0, falloff) * 0.55));
      this.wormPhysics.applyImpulse(worm, {
        x: direction.x * impulseStrength,
        y: (direction.y * impulseStrength) - verticalLaunch,
      });
    }
  }

  private applyExplosion(
    match: MatchState,
    params: {
      position: Vec2;
      radius: number;
      craterRadius: number;
      maxDamage: number;
      knockback: number;
      visualTtlMs: number;
    },
  ): void {
    match.explosions.push({
      id: this.idFactory.next('explosion_fx'),
      position: { ...params.position },
      radius: params.radius,
      ttlMs: params.visualTtlMs,
      maxTtlMs: params.visualTtlMs,
    });

    this.terrain.carveCircle(params.position, params.craterRadius);
    this.damageWorms(match, params.position, params.radius, params.maxDamage);
    this.pushWorms(match.worms, params.position, params.radius, params.knockback);
  }

  private handleWormDeath(match: MatchState, worm: WormState): void {
    if (!worm.alive) {
      return;
    }

    worm.alive = false;
    this.wormPhysics.removeBody(worm);
    this.applyDeathExplosion(match, worm.position);
  }

  private applyDeathExplosion(match: MatchState, position: Vec2): void {
    this.applyExplosion(match, {
      position,
      radius: ExplosionSystem.DEATH_EXPLOSION.radius,
      craterRadius: ExplosionSystem.DEATH_EXPLOSION.craterRadius,
      maxDamage: ExplosionSystem.DEATH_EXPLOSION.maxDamage,
      knockback: ExplosionSystem.DEATH_EXPLOSION.knockback,
      visualTtlMs: ExplosionSystem.DEATH_EXPLOSION.ttlMs,
    });
  }
}
