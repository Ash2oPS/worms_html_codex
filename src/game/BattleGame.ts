import type { Application } from 'pixi.js';
import type { GameConfig } from '../domain/config';
import type { GameTextSnapshot, MatchState, WormState } from '../domain/state';
import { clamp } from '../core/math';
import { IdFactory } from '../core/idFactory';
import { InputMapper, type InputFrame } from '../engine/input/InputMapper';
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

export class BattleGame {
  private static readonly SHOT_CHARGE_DURATION_MS = 2000;
  private static readonly MIN_SHOT_POWER = 0.25;
  private static readonly MAX_SHOT_POWER = 1;

  private readonly idFactory = new IdFactory();
  private readonly input = new InputMapper();

  private readonly weaponCatalog: WeaponCatalog;
  private readonly weaponMenu: WeaponMenuController;
  private readonly terrain: HeightMapTerrain;
  private readonly wormPhysics: WormPhysicsSystem;
  private readonly projectileSystem: ProjectileSystem;
  private readonly explosionSystem: ExplosionSystem;
  private readonly turnSystem: TurnSystem;
  private readonly windSystem: WindSystem;
  private readonly aiController: WormAiController;
  private readonly matchFactory: MatchFactory;
  private readonly renderer: BattleRenderer;
  private readonly match: MatchState;
  private readonly waterLevelY: number;

  private accumulatorMs = 0;
  private readonly fixedStepMs: number;
  private readonly fixedStepSeconds: number;
  private manualStepping = false;
  private shotCharge: { wormId: string; elapsedMs: number } | null = null;

  constructor(
    app: Application,
    config: GameConfig,
    private readonly rapier: RapierContext,
    private readonly audio: AudioService,
  ) {
    this.weaponCatalog = new WeaponCatalog(config.weapons);
    this.weaponMenu = new WeaponMenuController(this.weaponCatalog);
    this.terrain = new HeightMapTerrain(config.rules.world, config.rules.terrain, rapier);
    this.wormPhysics = new WormPhysicsSystem(rapier, config.rules.physics);
    this.projectileSystem = new ProjectileSystem(rapier, this.idFactory, this.weaponCatalog);
    this.explosionSystem = new ExplosionSystem(
      rapier,
      this.idFactory,
      this.terrain,
      this.weaponCatalog,
      this.wormPhysics,
    );
    this.turnSystem = new TurnSystem(config.rules.turn);
    this.windSystem = new WindSystem(config.rules.wind, config.rules.terrain.seed + 4242);
    this.aiController = new WormAiController(this.weaponCatalog, config.rules.physics.gravityY, this.terrain);
    this.matchFactory = new MatchFactory(this.idFactory, this.weaponCatalog);
    this.waterLevelY = config.rules.water.levelY;
    this.renderer = new BattleRenderer(
      app,
      config.rules.world.width,
      config.rules.world.height,
      this.waterLevelY,
    );
    this.match = this.matchFactory.create(config, this.terrain);
    this.fixedStepMs = config.rules.world.fixedTimeStepMs;
    this.fixedStepSeconds = this.fixedStepMs / 1000;

    for (const worm of this.match.worms) {
      this.wormPhysics.createBody(worm);
    }

    this.turnSystem.initialize(this.match);
    this.match.windForce = this.windSystem.nextWindForce();
    this.input.attach(app.canvas, config.rules.world.width, config.rules.world.height);
    this.render(this.fixedStepMs);
  }

  tick(frameDeltaMs: number): void {
    if (this.manualStepping) {
      return;
    }

    this.accumulatorMs += Math.min(frameDeltaMs, 100);
    while (this.accumulatorMs >= this.fixedStepMs) {
      this.stepSimulation(this.fixedStepMs);
      this.accumulatorMs -= this.fixedStepMs;
    }

    this.render(frameDeltaMs);
  }

  advanceTime(totalMs: number): void {
    this.manualStepping = true;
    const steps = Math.max(1, Math.round(totalMs / this.fixedStepMs));
    for (let index = 0; index < steps; index += 1) {
      this.stepSimulation(this.fixedStepMs);
    }
    this.render(totalMs);
    this.manualStepping = false;
  }

  toTextSnapshot(): string {
    const activeWorm = this.turnSystem.getCurrentWorm(this.match);
    const menuView = this.weaponMenu.getView(activeWorm?.selectedWeaponId ?? this.weaponCatalog.defaultWeaponId());

    const serializedTurnTimeLeftMs = Number.isFinite(this.match.turnTimeLeftMs)
      ? Math.max(0, Math.round(this.match.turnTimeLeftMs))
      : -1;

    const payload: GameTextSnapshot = {
      coordinateSystem: 'origin at top-left; +x right; +y down; units in pixels',
      phase: this.match.phase,
      turn: {
        number: this.match.turnNumber,
        currentWormId: this.match.currentWormId,
        currentTeamController: activeWorm
          ? (this.match.teams.find((team) => team.id === activeWorm.teamId)?.controller ?? 'human')
          : 'unknown',
        turnTimeLeftMs: serializedTurnTimeLeftMs,
        windForce: Number(this.match.windForce.toFixed(2)),
      },
      hazards: {
        waterLevelY: Number(this.waterLevelY.toFixed(2)),
        playablePlatformCount: this.terrain.getPlayablePlatformCount(),
      },
      worms: this.match.worms.map((worm) => ({
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
      projectiles: this.match.projectiles.map((projectile) => ({
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
      winnerTeamId: this.match.winnerTeamId,
    };
    return JSON.stringify(payload);
  }

  destroy(): void {
    this.input.detach();
  }

  private stepSimulation(deltaMs: number): void {
    if (this.match.phase === 'match_over') {
      this.cancelShotCharge();
      this.explosionSystem.updateVisuals(this.match, deltaMs);
      return;
    }

    const previousTurn = this.match.turnNumber;
    const playerInput = this.input.sample();
    const activeWorm = this.turnSystem.getCurrentWorm(this.match);
    const isAiControlled = this.isAiControlled(activeWorm);
    const input = this.resolveInput(activeWorm, playerInput, deltaMs);
    this.updateWormPushLocks(activeWorm);

    if (activeWorm && this.match.phase === 'aiming' && activeWorm.alive) {
      this.updateAimingPhase(activeWorm, input, deltaMs, isAiControlled);
    } else {
      this.weaponMenu.close();
      this.cancelShotCharge();
    }

    if (input.forceTurnEndPressed) {
      this.weaponMenu.close();
      this.cancelShotCharge();
      this.turnSystem.forceEndTurn(this.match);
    }

    this.rapier.step(this.fixedStepSeconds);
    const deadByHazards = this.wormPhysics.syncWormTransforms(this.match.worms, this.terrain, this.waterLevelY);
    if (deadByHazards.length > 0) {
      const deathExplosions = this.explosionSystem.triggerDeathExplosions(this.match, deadByHazards);
      if (deathExplosions > 0) {
        this.audio.playExplosion();
      }
    }

    const explosions = this.projectileSystem.update(this.match, deltaMs, this.match.windForce, this.terrain);
    if (explosions.length > 0) {
      this.explosionSystem.apply(this.match, explosions);
      this.audio.playExplosion();
    }
    this.explosionSystem.updateVisuals(this.match, deltaMs);

    if (this.match.phase === 'projectile_flight' && !this.projectileSystem.hasActiveProjectiles(this.match)) {
      this.cancelShotCharge();
      this.turnSystem.onProjectilesResolved(this.match);
    }

    const currentWorm = this.turnSystem.getCurrentWorm(this.match);
    if (this.match.phase === 'aiming' && (!currentWorm || !currentWorm.alive)) {
      this.weaponMenu.close();
      this.cancelShotCharge();
      this.turnSystem.forceEndTurn(this.match);
    }

    this.turnSystem.update(this.match, deltaMs);
    if (this.match.turnNumber !== previousTurn) {
      this.weaponMenu.close();
      this.cancelShotCharge();
      this.match.windForce = this.windSystem.nextWindForce();
    }
  }

  private resolveInput(
    activeWorm: WormState | undefined,
    playerInput: InputFrame,
    deltaMs: number,
  ): InputFrame {
    if (!activeWorm) {
      return playerInput;
    }

    const activeTeam = this.match.teams.find((team) => team.id === activeWorm.teamId);
    if (activeTeam?.controller !== 'ai') {
      return playerInput;
    }

    const aiInput = this.aiController.sample(this.match, activeWorm, deltaMs);
    return {
      ...aiInput,
      forceTurnEndPressed: playerInput.forceTurnEndPressed,
    };
  }

  private updateWormPushLocks(activeWorm: WormState | undefined): void {
    const restrictPushing = this.match.phase === 'aiming' && !!activeWorm && activeWorm.alive;
    for (const worm of this.match.worms) {
      const shouldLockHorizontal = restrictPushing && worm.id !== activeWorm.id;
      this.wormPhysics.setHorizontalMovementLocked(worm, shouldLockHorizontal);
    }
  }

  private updateAimingPhase(
    activeWorm: WormState,
    input: InputFrame,
    deltaMs: number,
    isAiControlled: boolean,
  ): void {
    if (input.weaponMenuTogglePressed) {
      this.weaponMenu.toggle(activeWorm.selectedWeaponId);
    }

    const menuView = this.weaponMenu.getView(activeWorm.selectedWeaponId);
    if (menuView.isOpen) {
      this.cancelShotCharge();
      if (input.menuPointerSelect) {
        const click = this.renderer.resolveWeaponMenuClick(
          input.menuPointerSelect.x,
          input.menuPointerSelect.y,
        );
        if (click?.kind === 'entry' && click.index !== undefined) {
          this.weaponMenu.selectIndex(click.index, activeWorm);
        } else if (click?.kind === 'outside') {
          this.weaponMenu.close();
        }
      }

      this.weaponMenu.moveCursor(input.menuMoveX, input.menuMoveY);
      if (input.menuConfirmPressed) {
        this.weaponMenu.confirm(activeWorm);
      } else if (input.menuCancelPressed) {
        this.weaponMenu.close();
      }
      return;
    }

    this.applyAimingInputs(activeWorm, input);
    this.wormPhysics.applyMovement(
      activeWorm,
      input.moveAxis,
      input.jumpPressed,
      input.backJumpPressed,
      this.terrain,
    );

    if (isAiControlled) {
      if (input.firePressed) {
        this.fireWeapon(activeWorm);
      }
      return;
    }

    this.updateShotCharge(activeWorm, input, deltaMs);
  }

  private applyAimingInputs(worm: WormState, input: InputFrame): void {
    if (input.moveAxis !== 0) {
      worm.facing = input.moveAxis > 0 ? 1 : -1;
    }

    worm.aimDeg = clamp(worm.aimDeg + (input.aimAxis * 1.5), 8, 172);
    worm.power = clamp(
      worm.power + (input.powerAxis * 0.012),
      BattleGame.MIN_SHOT_POWER,
      BattleGame.MAX_SHOT_POWER,
    );
  }

  private updateShotCharge(worm: WormState, input: InputFrame, deltaMs: number): void {
    if (!worm.isGrounded) {
      this.cancelShotCharge();
      return;
    }

    if (this.shotCharge && this.shotCharge.wormId !== worm.id) {
      this.cancelShotCharge();
    }

    const wantsToCharge = input.fireHeld || input.firePressed;
    if (wantsToCharge && !this.shotCharge) {
      this.shotCharge = {
        wormId: worm.id,
        elapsedMs: 0,
      };
      worm.power = BattleGame.MIN_SHOT_POWER;
    }

    if (!this.shotCharge || this.shotCharge.wormId !== worm.id) {
      return;
    }

    if (input.fireHeld) {
      this.shotCharge.elapsedMs = Math.min(
        BattleGame.SHOT_CHARGE_DURATION_MS,
        this.shotCharge.elapsedMs + deltaMs,
      );
    }

    const chargeRatio = this.shotCharge.elapsedMs / BattleGame.SHOT_CHARGE_DURATION_MS;
    worm.power = clamp(
      BattleGame.MIN_SHOT_POWER + (chargeRatio * (BattleGame.MAX_SHOT_POWER - BattleGame.MIN_SHOT_POWER)),
      BattleGame.MIN_SHOT_POWER,
      BattleGame.MAX_SHOT_POWER,
    );

    const reachedMaxCharge = this.shotCharge.elapsedMs >= BattleGame.SHOT_CHARGE_DURATION_MS;
    if (reachedMaxCharge || input.fireReleased) {
      this.fireWeapon(worm);
    }
  }

  private fireWeapon(worm: WormState): boolean {
    if (!worm.isGrounded) {
      return false;
    }

    const fired = this.projectileSystem.fire(this.match, worm);
    if (!fired) {
      return false;
    }

    this.cancelShotCharge();
    this.weaponMenu.close();
    this.audio.playShot();
    this.turnSystem.onShotFired(this.match);
    return true;
  }

  private cancelShotCharge(): void {
    this.shotCharge = null;
  }

  private isAiControlled(worm: WormState | undefined): boolean {
    if (!worm) {
      return false;
    }

    return this.match.teams.find((team) => team.id === worm.teamId)?.controller === 'ai';
  }

  private render(deltaMs: number): void {
    const activeWorm = this.turnSystem.getCurrentWorm(this.match);
    const activeWeaponLabel = activeWorm
      ? this.weaponCatalog.getById(activeWorm.selectedWeaponId).label
      : 'n/a';
    const menuView = this.weaponMenu.getView(activeWorm?.selectedWeaponId ?? this.weaponCatalog.defaultWeaponId());
    this.renderer.render(this.match, this.terrain, activeWeaponLabel, menuView, deltaMs);
  }
}
