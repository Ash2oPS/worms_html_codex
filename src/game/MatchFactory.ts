import type { GameConfig } from '../domain/config';
import type { MatchState, TeamState, WormState } from '../domain/state';
import { IdFactory } from '../core/idFactory';
import { HeightMapTerrain } from '../engine/terrain/HeightMapTerrain';
import { WeaponCatalog } from '../engine/combat/WeaponCatalog';

export class MatchFactory {
  constructor(
    private readonly idFactory: IdFactory,
    private readonly weaponCatalog: WeaponCatalog,
  ) {}

  create(config: GameConfig, terrain: HeightMapTerrain): MatchState {
    const teams: TeamState[] = [];
    const worms: WormState[] = [];

    config.teams.forEach((teamTemplate, teamIndex) => {
      const team: TeamState = {
        id: teamTemplate.id,
        name: teamTemplate.name,
        color: teamTemplate.color,
        wormIds: [],
        controller: teamTemplate.controller ?? 'human',
      };
      teams.push(team);

      const teamMinX = teamIndex === 0
        ? config.rules.match.spawnPaddingX
        : (config.rules.world.width * 0.5);
      const teamMaxX = teamIndex === 0
        ? (config.rules.world.width * 0.5) - config.rules.match.spawnPaddingX
        : config.rules.world.width - config.rules.match.spawnPaddingX;
      const teamSpawnXs: number[] = [];

      for (let index = 0; index < config.rules.match.wormsPerTeam; index += 1) {
        const spawn = this.findTeamSpawnPoint(
          terrain,
          teamMinX,
          teamMaxX,
          config.rules.physics.wormRadius,
          (teamIndex * 97) + (index * 31) + 1,
          teamSpawnXs,
        );
        const wormId = this.idFactory.next(`worm_${team.id}`);
        team.wormIds.push(wormId);
        teamSpawnXs.push(spawn.x);

        const wormName = teamTemplate.worms[index] ?? `${team.name} ${index + 1}`;
        worms.push({
          id: wormId,
          teamId: team.id,
          teamColor: team.color,
          name: wormName,
          health: 100,
          maxHealth: 100,
          radius: config.rules.physics.wormRadius,
          alive: true,
          facing: teamIndex === 0 ? 1 : -1,
          aimDeg: 45,
          power: 0.78,
          selectedWeaponId: this.weaponCatalog.defaultWeaponId(),
          position: spawn,
          bodyHandle: null,
          isGrounded: true,
          groundNormal: { x: 0, y: -1 },
          groundAngleRad: 0,
        });
      }
    });

    const initialWormId = worms[0]?.id ?? '';
    return {
      phase: 'aiming',
      worms,
      teams,
      projectiles: [],
      explosions: [],
      damageTexts: [],
      currentWormId: initialWormId,
      turnNumber: 1,
      turnTimeLeftMs: config.rules.turn.durationMs,
      windForce: 0,
      winnerTeamId: null,
    };
  }

  private findTeamSpawnPoint(
    terrain: HeightMapTerrain,
    minX: number,
    maxX: number,
    wormRadius: number,
    seedOffset: number,
    existingXs: number[],
  ): { x: number; y: number } {
    const minSpacing = wormRadius * 3.4;

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const spawn = terrain.findSpawnPoint(minX, maxX, wormRadius, seedOffset + (attempt * 151));
      const isFarEnough = existingXs.every((x) => Math.abs(x - spawn.x) >= minSpacing);
      if (isFarEnough) {
        return spawn;
      }
    }

    return terrain.findSpawnPoint(minX, maxX, wormRadius, seedOffset + 997);
  }
}
