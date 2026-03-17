import { clamp } from '../core/math';
import type { MatchState, WormState } from '../domain/state';
import { InputMapper, type InputFrame } from '../engine/input/InputMapper';
import { WindSystem } from '../engine/wind/WindSystem';
import { TurnSystem } from '../engine/turn/TurnSystem';
import { WeaponCatalog } from '../engine/combat/WeaponCatalog';
import { WeaponMenuController } from '../engine/combat/WeaponMenuController';
import { ProjectileSystem } from '../engine/combat/ProjectileSystem';
import { ExplosionSystem } from '../engine/combat/ExplosionSystem';
import { WormPhysicsSystem } from '../engine/worms/WormPhysicsSystem';
import { WormAiController } from '../engine/ai/WormAiController';
import { HeightMapTerrain } from '../engine/terrain/HeightMapTerrain';
import { RapierContext } from '../engine/physics/RapierContext';
import { AudioService } from '../infra/audio/AudioService';
import { createWeaponMenuLayout, resolveWeaponMenuClick } from '../engine/combat/WeaponMenuLayout';

interface BattleSimulationRuntimeDeps {
  match: MatchState;
  weaponCatalog: WeaponCatalog;
  weaponMenu: WeaponMenuController;
  terrain: HeightMapTerrain;
  wormPhysics: WormPhysicsSystem;
  projectileSystem: ProjectileSystem;
  explosionSystem: ExplosionSystem;
  turnSystem: TurnSystem;
  windSystem: WindSystem;
  aiController: WormAiController;
  rapier: RapierContext;
  audio: AudioService;
  input: InputMapper;
  waterLevelY: number;
  worldWidth: number;
  worldHeight: number;
  fixedStepSeconds: number;
}

export class BattleSimulationRuntime {
  private static readonly SHOT_CHARGE_DURATION_MS = 2000;
  private static readonly MIN_SHOT_POWER = 0.25;
  private static readonly MAX_SHOT_POWER = 1;

  private shotCharge: { wormId: string; elapsedMs: number } | null = null;

  constructor(private readonly deps: BattleSimulationRuntimeDeps) {}

  get match(): MatchState {
    return this.deps.match;
  }

  getWeaponMenuView() {
    const activeWorm = this.deps.turnSystem.getCurrentWorm(this.deps.match);
    return this.deps.weaponMenu.getView(
      activeWorm?.selectedWeaponId ?? this.deps.weaponCatalog.defaultWeaponId(),
    );
  }

  getActiveWeaponLabel(): string {
    const activeWorm = this.deps.turnSystem.getCurrentWorm(this.deps.match);
    return activeWorm
      ? this.deps.weaponCatalog.getById(activeWorm.selectedWeaponId).label
      : 'n/a';
  }

  stepSimulation(deltaMs: number): void {
    if (this.deps.match.phase === 'match_over') {
      this.cancelShotCharge();
      this.deps.explosionSystem.updateVisuals(this.deps.match, deltaMs);
      return;
    }

    const previousTurn = this.deps.match.turnNumber;
    const playerInput = this.deps.input.sample();
    const activeWorm = this.deps.turnSystem.getCurrentWorm(this.deps.match);
    const isAiControlled = this.isAiControlled(activeWorm);
    const input = this.resolveInput(activeWorm, playerInput, deltaMs);
    this.updateWormPushLocks(activeWorm);

    if (activeWorm && this.deps.match.phase === 'aiming' && activeWorm.alive) {
      this.updateAimingPhase(activeWorm, input, deltaMs, isAiControlled);
    } else {
      this.deps.weaponMenu.close();
      this.cancelShotCharge();
    }

    if (input.forceTurnEndPressed) {
      this.deps.weaponMenu.close();
      this.cancelShotCharge();
      this.deps.turnSystem.forceEndTurn(this.deps.match);
    }

    this.deps.rapier.step(this.deps.fixedStepSeconds);
    const deadByHazards = this.deps.wormPhysics.syncWormTransforms(
      this.deps.match.worms,
      this.deps.terrain,
      this.deps.waterLevelY,
    );
    if (deadByHazards.length > 0) {
      const deathExplosions = this.deps.explosionSystem.triggerDeathExplosions(this.deps.match, deadByHazards);
      if (deathExplosions > 0) {
        this.deps.audio.playExplosion();
      }
    }

    const explosions = this.deps.projectileSystem.update(
      this.deps.match,
      deltaMs,
      this.deps.match.windForce,
      this.deps.terrain,
    );
    if (explosions.length > 0) {
      this.deps.explosionSystem.apply(this.deps.match, explosions);
      this.deps.audio.playExplosion();
    }
    this.deps.explosionSystem.updateVisuals(this.deps.match, deltaMs);

    if (this.deps.match.phase === 'projectile_flight' && !this.deps.projectileSystem.hasActiveProjectiles(this.deps.match)) {
      this.cancelShotCharge();
      this.deps.turnSystem.onProjectilesResolved(this.deps.match);
    }

    const currentWorm = this.deps.turnSystem.getCurrentWorm(this.deps.match);
    if (this.deps.match.phase === 'aiming' && (!currentWorm || !currentWorm.alive)) {
      this.deps.weaponMenu.close();
      this.cancelShotCharge();
      this.deps.turnSystem.forceEndTurn(this.deps.match);
    }

    this.deps.turnSystem.update(this.deps.match, deltaMs);
    if (this.deps.match.turnNumber !== previousTurn) {
      this.deps.weaponMenu.close();
      this.cancelShotCharge();
      this.deps.match.windForce = this.deps.windSystem.nextWindForce();
    }
  }

  destroy(): void {
    this.cancelShotCharge();
    this.deps.weaponMenu.close();
  }

  private resolveInput(
    activeWorm: WormState | undefined,
    playerInput: InputFrame,
    deltaMs: number,
  ): InputFrame {
    if (!activeWorm) {
      return playerInput;
    }

    const activeTeam = this.deps.match.teams.find((team) => team.id === activeWorm.teamId);
    if (activeTeam?.controller !== 'ai') {
      return playerInput;
    }

    const aiInput = this.deps.aiController.sample(this.deps.match, activeWorm, deltaMs);
    return {
      ...aiInput,
      forceTurnEndPressed: playerInput.forceTurnEndPressed,
    };
  }

  private updateWormPushLocks(activeWorm: WormState | undefined): void {
    const restrictPushing = this.deps.match.phase === 'aiming' && !!activeWorm && activeWorm.alive;
    for (const worm of this.deps.match.worms) {
      const shouldLockHorizontal = restrictPushing && worm.id !== activeWorm.id;
      this.deps.wormPhysics.setHorizontalMovementLocked(worm, shouldLockHorizontal);
    }
  }

  private updateAimingPhase(
    activeWorm: WormState,
    input: InputFrame,
    deltaMs: number,
    isAiControlled: boolean,
  ): void {
    if (input.weaponMenuTogglePressed) {
      this.deps.weaponMenu.toggle(activeWorm.selectedWeaponId);
    }

    const menuView = this.deps.weaponMenu.getView(activeWorm.selectedWeaponId);
    if (menuView.isOpen) {
      this.cancelShotCharge();
      if (input.menuPointerSelect) {
        const layout = createWeaponMenuLayout(this.deps.worldWidth, this.deps.worldHeight, menuView);
        const click = resolveWeaponMenuClick(layout, input.menuPointerSelect.x, input.menuPointerSelect.y);
        if (click?.kind === 'entry') {
          this.deps.weaponMenu.selectIndex(click.index, activeWorm);
        } else if (click?.kind === 'outside') {
          this.deps.weaponMenu.close();
        }
      }

      this.deps.weaponMenu.moveCursor(input.menuMoveX, input.menuMoveY);
      if (input.menuConfirmPressed) {
        this.deps.weaponMenu.confirm(activeWorm);
      } else if (input.menuCancelPressed) {
        this.deps.weaponMenu.close();
      }
      return;
    }

    this.applyAimingInputs(activeWorm, input);
    this.deps.wormPhysics.applyMovement(
      activeWorm,
      input.moveAxis,
      input.jumpPressed,
      input.backJumpPressed,
      this.deps.terrain,
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
      BattleSimulationRuntime.MIN_SHOT_POWER,
      BattleSimulationRuntime.MAX_SHOT_POWER,
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
      worm.power = BattleSimulationRuntime.MIN_SHOT_POWER;
    }

    if (!this.shotCharge || this.shotCharge.wormId !== worm.id) {
      return;
    }

    if (input.fireHeld) {
      this.shotCharge.elapsedMs = Math.min(
        BattleSimulationRuntime.SHOT_CHARGE_DURATION_MS,
        this.shotCharge.elapsedMs + deltaMs,
      );
    }

    const chargeRatio = this.shotCharge.elapsedMs / BattleSimulationRuntime.SHOT_CHARGE_DURATION_MS;
    worm.power = clamp(
      BattleSimulationRuntime.MIN_SHOT_POWER
      + (chargeRatio * (BattleSimulationRuntime.MAX_SHOT_POWER - BattleSimulationRuntime.MIN_SHOT_POWER)),
      BattleSimulationRuntime.MIN_SHOT_POWER,
      BattleSimulationRuntime.MAX_SHOT_POWER,
    );

    const reachedMaxCharge = this.shotCharge.elapsedMs >= BattleSimulationRuntime.SHOT_CHARGE_DURATION_MS;
    if (reachedMaxCharge || input.fireReleased) {
      this.fireWeapon(worm);
    }
  }

  private fireWeapon(worm: WormState): boolean {
    if (!worm.isGrounded) {
      return false;
    }

    const fired = this.deps.projectileSystem.fire(this.deps.match, worm);
    if (!fired) {
      return false;
    }

    this.cancelShotCharge();
    this.deps.weaponMenu.close();
    this.deps.audio.playShot();
    this.deps.turnSystem.onShotFired(this.deps.match);
    return true;
  }

  private cancelShotCharge(): void {
    this.shotCharge = null;
  }

  private isAiControlled(worm: WormState | undefined): boolean {
    if (!worm) {
      return false;
    }

    return this.deps.match.teams.find((team) => team.id === worm.teamId)?.controller === 'ai';
  }
}
