import type { Application } from 'pixi.js';
import type { GameConfig } from '../domain/config';
import type { GameTextSnapshot } from '../domain/state';
import { IdFactory } from '../core/idFactory';
import { InputMapper } from '../engine/input/InputMapper';
import { RapierContext } from '../engine/physics/RapierContext';
import { HeightMapTerrain } from '../engine/terrain/HeightMapTerrain';
import { WindSystem } from '../engine/wind/WindSystem';
import { TurnSystem } from '../engine/turn/TurnSystem';
import { WeaponCatalog } from '../engine/combat/WeaponCatalog';
import { WeaponMenuController } from '../engine/combat/WeaponMenuController';
import { ProjectileSystem } from '../engine/combat/ProjectileSystem';
import { ExplosionSystem } from '../engine/combat/ExplosionSystem';
import { WormPhysicsSystem } from '../engine/worms/WormPhysicsSystem';
import { WormAiController } from '../engine/ai/WormAiController';
import { MatchFactory } from './MatchFactory';
import { BattleRenderer } from '../rendering/BattleRenderer';
import { AudioService } from '../infra/audio/AudioService';
import { BattleSimulationRuntime } from './BattleSimulationRuntime';

export class BattleGame {
  private readonly idFactory = new IdFactory();
  private readonly input = new InputMapper();
  private readonly terrain: HeightMapTerrain;
  private readonly wormPhysics: WormPhysicsSystem;
  private readonly renderer: BattleRenderer;
  private readonly runtime: BattleSimulationRuntime;
  private readonly waterLevelY: number;

  private accumulatorMs = 0;
  private readonly fixedStepMs: number;
  private manualStepping = false;
  private destroyed = false;

  constructor(
    app: Application,
    config: GameConfig,
    private readonly rapier: RapierContext,
    private readonly audio: AudioService,
  ) {
    const weaponCatalog = new WeaponCatalog(config.weapons);
    const weaponMenu = new WeaponMenuController(weaponCatalog);
    this.terrain = new HeightMapTerrain(config.rules.world, config.rules.terrain, rapier);
    this.wormPhysics = new WormPhysicsSystem(rapier, config.rules.physics);
    const projectileSystem = new ProjectileSystem(rapier, this.idFactory, weaponCatalog);
    const explosionSystem = new ExplosionSystem(
      this.idFactory,
      this.terrain,
      weaponCatalog,
      this.wormPhysics,
    );
    const turnSystem = new TurnSystem(config.rules.turn, config.rules.match);
    const windSystem = new WindSystem(config.rules.wind, config.rules.terrain.seed + 4242);
    const aiController = new WormAiController(weaponCatalog, config.rules.physics.gravityY, this.terrain);
    const matchFactory = new MatchFactory(this.idFactory, weaponCatalog);
    this.waterLevelY = config.rules.water.levelY;
    this.renderer = new BattleRenderer(
      app,
      config.rules.world.width,
      config.rules.world.height,
      this.waterLevelY,
    );

    const match = matchFactory.create(config, this.terrain);
    this.fixedStepMs = config.rules.world.fixedTimeStepMs;
    const fixedStepSeconds = this.fixedStepMs / 1000;

    for (const worm of match.worms) {
      this.wormPhysics.createBody(worm);
    }

    turnSystem.initialize(match);
    match.windForce = windSystem.nextWindForce();
    this.input.attach(app.canvas, config.rules.world.width, config.rules.world.height);

    this.runtime = new BattleSimulationRuntime({
      match,
      weaponCatalog,
      weaponMenu,
      terrain: this.terrain,
      wormPhysics: this.wormPhysics,
      projectileSystem,
      explosionSystem,
      turnSystem,
      windSystem,
      aiController,
      rapier: this.rapier,
      audio: this.audio,
      input: this.input,
      waterLevelY: this.waterLevelY,
      worldWidth: config.rules.world.width,
      worldHeight: config.rules.world.height,
      fixedStepSeconds,
    });

    this.render(this.fixedStepMs);
  }

  tick(frameDeltaMs: number): void {
    if (this.manualStepping || this.destroyed) {
      return;
    }

    this.accumulatorMs += Math.min(frameDeltaMs, 100);
    while (this.accumulatorMs >= this.fixedStepMs) {
      this.runtime.stepSimulation(this.fixedStepMs);
      this.accumulatorMs -= this.fixedStepMs;
    }

    this.render(frameDeltaMs);
  }

  advanceTime(totalMs: number): void {
    if (this.destroyed) {
      return;
    }

    this.manualStepping = true;
    const steps = Math.max(1, Math.round(totalMs / this.fixedStepMs));
    for (let index = 0; index < steps; index += 1) {
      this.runtime.stepSimulation(this.fixedStepMs);
    }
    this.render(totalMs);
    this.manualStepping = false;
  }

  toTextSnapshot(): string {
    const match = this.runtime.match;
    const activeWorm = match.worms.find((worm) => worm.id === match.currentWormId);
    const menuView = this.runtime.getWeaponMenuView();
    const serializedTurnTimeLeftMs = Number.isFinite(match.turnTimeLeftMs)
      ? Math.max(0, Math.round(match.turnTimeLeftMs))
      : -1;

    const payload: GameTextSnapshot = {
      coordinateSystem: 'origin at top-left; +x right; +y down; units in pixels',
      phase: match.phase,
      turn: {
        number: match.turnNumber,
        currentWormId: match.currentWormId,
        currentTeamController: activeWorm
          ? (match.teams.find((team) => team.id === activeWorm.teamId)?.controller ?? 'human')
          : 'unknown',
        turnTimeLeftMs: serializedTurnTimeLeftMs,
        windForce: Number(match.windForce.toFixed(2)),
      },
      hazards: {
        waterLevelY: Number(this.waterLevelY.toFixed(2)),
        playablePlatformCount: this.terrain.getPlayablePlatformCount(),
      },
      worms: match.worms.map((worm) => ({
        id: worm.id,
        name: worm.name,
        teamId: worm.teamId,
        hp: worm.health,
        alive: worm.alive,
        x: Number(worm.position.x.toFixed(2)),
        y: Number(worm.position.y.toFixed(2)),
        facing: worm.facing,
        grounded: worm.isGrounded,
        aimDeg: Number(worm.aimDeg.toFixed(2)),
        power: Number(worm.power.toFixed(2)),
      })),
      projectiles: match.projectiles.map((projectile) => ({
        id: projectile.id,
        weaponId: projectile.weaponId,
        x: Number(projectile.position.x.toFixed(2)),
        y: Number(projectile.position.y.toFixed(2)),
      })),
      weaponMenu: {
        open: menuView.isOpen,
        cursorIndex: menuView.cursorIndex,
        weaponIds: menuView.entries.map((entry) => entry.id),
      },
      winnerTeamId: match.winnerTeamId,
    };
    return JSON.stringify(payload);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.input.detach();
    this.runtime.destroy();
    this.renderer.destroy();
    this.rapier.destroy();
  }

  private render(deltaMs: number): void {
    this.renderer.render(
      this.runtime.match,
      this.terrain,
      this.runtime.getActiveWeaponLabel(),
      this.runtime.getWeaponMenuView(),
      this.wormPhysics.getGroundAnglesSnapshot(),
      deltaMs,
    );
  }
}
