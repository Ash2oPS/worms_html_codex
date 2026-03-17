import { Graphics } from 'pixi.js';
import type { MatchState } from '../domain/state';

export class ProjectileRenderer {
  readonly graphics = new Graphics();

  render(match: MatchState): void {
    this.graphics.clear();

    for (const projectile of match.projectiles) {
      if (!projectile.active) {
        continue;
      }

      this.graphics.beginFill(0xf2f2f2, 0.95);
      this.graphics.drawCircle(projectile.position.x, projectile.position.y, projectile.radius);
      this.graphics.endFill();

      this.graphics.lineStyle(1, 0x000000, 0.25);
      this.graphics.drawCircle(projectile.position.x, projectile.position.y, projectile.radius + 1);
    }
  }
}
