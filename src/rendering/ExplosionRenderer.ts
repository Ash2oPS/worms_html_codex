import { Graphics } from 'pixi.js';
import type { MatchState } from '../domain/state';

export class ExplosionRenderer {
  readonly graphics = new Graphics();

  render(match: MatchState): void {
    this.graphics.clear();

    for (const explosion of match.explosions) {
      const lifeRatio = explosion.ttlMs / explosion.maxTtlMs;
      const currentRadius = explosion.radius * (1 - (lifeRatio * 0.6));

      this.graphics.beginFill(0xffb54f, 0.25 * lifeRatio);
      this.graphics.drawCircle(explosion.position.x, explosion.position.y, currentRadius);
      this.graphics.endFill();

      this.graphics.lineStyle(2, 0xffe2a8, 0.6 * lifeRatio);
      this.graphics.drawCircle(explosion.position.x, explosion.position.y, currentRadius * 0.78);
    }
  }
}
