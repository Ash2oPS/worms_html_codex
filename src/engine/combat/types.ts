import type { Vec2 } from '../../domain/state';

export interface ExplosionRequest {
  position: Vec2;
  ownerWormId: string;
  weaponId: string;
}
