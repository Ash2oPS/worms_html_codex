import type { MatchState, WormState } from '../../domain/state';
import { IdFactory } from '../../core/idFactory';
import { degToRad, distance } from '../../core/math';
import { RapierContext } from '../physics/RapierContext';
import { HeightMapTerrain } from '../terrain/HeightMapTerrain';
import { WeaponCatalog } from './WeaponCatalog';
import type { ExplosionRequest } from './types';

export class ProjectileSystem {
  constructor(
    private readonly rapier: RapierContext,
    private readonly idFactory: IdFactory,
    private readonly weaponCatalog: WeaponCatalog,
  ) {}

  fire(match: MatchState, shooter: WormState): boolean {
    if (!shooter.alive || shooter.bodyHandle === null) {
      return false;
    }

    const weapon = this.weaponCatalog.getById(shooter.selectedWeaponId);
    const aimRad = degToRad(shooter.aimDeg);
    const directionX = Math.cos(aimRad) * shooter.facing;
    const directionY = -Math.sin(aimRad);
    const spawnDistance = shooter.radius + weapon.projectile.radius + 6;
    const spawnX = shooter.position.x + (directionX * spawnDistance);
    const spawnY = shooter.position.y + (directionY * spawnDistance);
    const launchSpeed = weapon.projectile.speed * shooter.power;

    const bodyDesc = this.rapier.api.RigidBodyDesc
      .dynamic()
      .setTranslation(spawnX, spawnY)
      .setCanSleep(false)
      .setLinearDamping(0.1)
      .setAngularDamping(0.2);
    const body = this.rapier.world.createRigidBody(bodyDesc);
    body.enableCcd(true);
    body.setLinvel({ x: directionX * launchSpeed, y: directionY * launchSpeed }, true);

    const colliderDesc = this.rapier.api.ColliderDesc
      .ball(weapon.projectile.radius)
      .setMass(weapon.projectile.mass)
      .setRestitution(weapon.projectile.restitution)
      .setFriction(0.3);
    this.rapier.world.createCollider(colliderDesc, body);

    match.projectiles.push({
      id: this.idFactory.next('projectile'),
      ownerWormId: shooter.id,
      weaponId: weapon.id,
      radius: weapon.projectile.radius,
      ageMs: 0,
      position: { x: spawnX, y: spawnY },
      previousPosition: { x: spawnX, y: spawnY },
      bodyHandle: body.handle,
      active: true,
    });

    return true;
  }

  hasActiveProjectiles(match: MatchState): boolean {
    return match.projectiles.some((projectile) => projectile.active);
  }

  update(
    match: MatchState,
    deltaMs: number,
    windForce: number,
    terrain: HeightMapTerrain,
  ): ExplosionRequest[] {
    const explosions: ExplosionRequest[] = [];
    const toDeactivate = new Set<string>();

    for (const projectile of match.projectiles) {
      if (!projectile.active) {
        continue;
      }

      const body = this.rapier.world.getRigidBody(projectile.bodyHandle);
      if (!body) {
        toDeactivate.add(projectile.id);
        continue;
      }

      const weapon = this.weaponCatalog.getById(projectile.weaponId);
      const windImpulse = windForce * weapon.projectile.windMultiplier * (deltaMs / 1000) * body.mass();
      body.applyImpulse({ x: windImpulse, y: 0 }, true);

      const translation = body.translation();
      const velocity = body.linvel();
      const speed = Math.sqrt((velocity.x * velocity.x) + (velocity.y * velocity.y));
      projectile.previousPosition = { ...projectile.position };
      projectile.position = { x: translation.x, y: translation.y };
      projectile.ageMs += deltaMs;

      const outOfBounds = (
        projectile.position.x < -100
        || projectile.position.x > terrain.getWorldWidth() + 100
        || projectile.position.y < -100
        || projectile.position.y > terrain.getWorldHeight() + 100
      );
      if (outOfBounds) {
        toDeactivate.add(projectile.id);
        continue;
      }

      if (this.hitsAnyWorm(projectile, match.worms)) {
        explosions.push({
          position: { ...projectile.position },
          ownerWormId: projectile.ownerWormId,
          weaponId: projectile.weaponId,
        });
        toDeactivate.add(projectile.id);
        continue;
      }

      if (
        weapon.projectile.explodeOnImpact
        && (
          terrain.segmentHitsTerrain(projectile.previousPosition, projectile.position)
          || terrain.isSolid(projectile.position.x, projectile.position.y + (projectile.radius * 0.7))
          || (projectile.ageMs > 120 && speed < 55)
        )
      ) {
        explosions.push({
          position: { ...projectile.position },
          ownerWormId: projectile.ownerWormId,
          weaponId: projectile.weaponId,
        });
        toDeactivate.add(projectile.id);
        continue;
      }

      if (!weapon.projectile.explodeOnImpact && projectile.ageMs >= weapon.projectile.fuseMs) {
        explosions.push({
          position: { ...projectile.position },
          ownerWormId: projectile.ownerWormId,
          weaponId: projectile.weaponId,
        });
        toDeactivate.add(projectile.id);
      }
    }

    for (const projectile of match.projectiles) {
      if (toDeactivate.has(projectile.id)) {
        this.deactivateProjectile(projectile);
      }
    }

    match.projectiles = match.projectiles.filter((projectile) => projectile.active);
    return explosions;
  }

  private hitsAnyWorm(projectile: MatchState['projectiles'][number], worms: WormState[]): boolean {
    if (projectile.ageMs < 90) {
      return false;
    }

    for (const worm of worms) {
      if (!worm.alive || worm.id === projectile.ownerWormId) {
        continue;
      }

      const hitDistance = worm.radius + projectile.radius;
      if (distance(worm.position, projectile.position) <= hitDistance) {
        return true;
      }
    }

    return false;
  }

  private deactivateProjectile(projectile: MatchState['projectiles'][number]): void {
    const body = this.rapier.world.getRigidBody(projectile.bodyHandle);
    if (body) {
      this.rapier.world.removeRigidBody(body);
    }
    projectile.active = false;
  }
}
