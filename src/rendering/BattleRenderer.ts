import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { MatchState } from '../domain/state';
import { HeightMapTerrain } from '../engine/terrain/HeightMapTerrain';
import { BackgroundRenderer } from './BackgroundRenderer';
import { TerrainRenderer } from './TerrainRenderer';
import { WormRenderer } from './WormRenderer';
import { ProjectileRenderer } from './ProjectileRenderer';
import { ExplosionRenderer } from './ExplosionRenderer';
import { DamageTextRenderer } from './DamageTextRenderer';
import { HudRenderer } from './HudRenderer';
import { WeaponMenuRenderer } from './WeaponMenuRenderer';
import type { WeaponMenuView } from '../engine/combat/WeaponMenuController';
import { CameraController } from './CameraController';

export class BattleRenderer {
  private readonly worldLayer = new Container();
  private readonly backgroundRenderer = new BackgroundRenderer();
  private readonly terrainRenderer = new TerrainRenderer();
  private readonly wormRenderer = new WormRenderer();
  private readonly projectileRenderer = new ProjectileRenderer();
  private readonly explosionRenderer = new ExplosionRenderer();
  private readonly damageTextRenderer = new DamageTextRenderer();
  private readonly hudRenderer = new HudRenderer();
  private readonly weaponMenuRenderer: WeaponMenuRenderer;
  private readonly camera: CameraController;

  constructor(
    private readonly app: Application,
    private readonly worldWidth: number,
    private readonly worldHeight: number,
    private readonly waterLevelY: number,
  ) {
    this.weaponMenuRenderer = new WeaponMenuRenderer(worldWidth, worldHeight);
    this.camera = new CameraController(
      this.worldLayer,
      this.worldWidth,
      this.worldHeight,
      this.worldWidth,
      this.worldHeight,
    );

    this.worldLayer.addChild(this.backgroundRenderer.graphics);
    this.worldLayer.addChild(this.terrainRenderer.graphics);
    this.worldLayer.addChild(this.wormRenderer.container);
    this.worldLayer.addChild(this.projectileRenderer.graphics);
    this.worldLayer.addChild(this.explosionRenderer.graphics);
    this.worldLayer.addChild(this.damageTextRenderer.container);
    this.app.stage.addChild(this.worldLayer);
    this.app.stage.addChild(this.hudRenderer.container);
    this.app.stage.addChild(this.weaponMenuRenderer.container);
  }

  render(
    match: MatchState,
    terrain: HeightMapTerrain,
    activeWeaponLabel: string,
    weaponMenu: WeaponMenuView,
    groundAngles: ReadonlyMap<string, number>,
    deltaMs: number,
  ): void {
    this.backgroundRenderer.render(this.worldWidth, this.worldHeight, this.waterLevelY);
    this.terrainRenderer.render(terrain);
    this.wormRenderer.render(match, groundAngles);
    this.projectileRenderer.render(match);
    this.explosionRenderer.render(match);
    this.damageTextRenderer.render(match);

    const activeWorm = match.worms.find((worm) => worm.id === match.currentWormId && worm.alive);
    if (match.phase === 'aiming' && activeWorm) {
      this.camera.setTarget(activeWorm.position.x, activeWorm.position.y, 1.35);
    } else {
      this.camera.setTarget(this.worldWidth * 0.5, this.worldHeight * 0.5, 1);
    }
    this.camera.update(deltaMs);

    this.hudRenderer.render(match, activeWeaponLabel);
    this.weaponMenuRenderer.render(weaponMenu);
  }

  destroy(): void {
    this.wormRenderer.destroy();
    this.weaponMenuRenderer.destroy();
    this.worldLayer.destroy({ children: true });
    this.hudRenderer.container.destroy({ children: true });
  }
}
