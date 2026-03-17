import type { MatchConfig, TurnConfig } from '../../domain/config';
import type { MatchState, WormState } from '../../domain/state';

export class TurnSystem {
  private teamOrder: string[] = [];
  private teamWormOrder = new Map<string, string[]>();
  private teamCursor = new Map<string, number>();
  private currentTeamIndex = -1;
  private elapsedMatchMs = 0;

  constructor(
    private readonly config: TurnConfig,
    private readonly matchConfig: MatchConfig,
  ) {}

  initialize(match: MatchState): void {
    this.buildTeamRotation(match);
    this.elapsedMatchMs = 0;
    match.turnNumber = 1;
    match.phase = 'aiming';
    match.turnTimeLeftMs = this.config.durationMs;

    const firstWorm = this.pickFirstAliveWorm(match);
    if (firstWorm) {
      match.currentWormId = firstWorm.id;
      this.currentTeamIndex = this.teamOrder.indexOf(firstWorm.teamId);
      return;
    }

    match.currentWormId = '';
    match.phase = 'match_over';
    match.turnTimeLeftMs = 0;
    match.winnerTeamId = null;
  }

  update(match: MatchState, deltaMs: number): void {
    if (match.phase === 'match_over') {
      return;
    }

    const winnerTeam = this.detectWinner(match);
    if (winnerTeam !== null) {
      this.finishMatch(match, winnerTeam);
      return;
    }

    this.elapsedMatchMs += deltaMs;
    if (
      this.matchConfig.maxDurationMs >= 0
      && this.elapsedMatchMs >= this.matchConfig.maxDurationMs
    ) {
      this.finishMatch(match, this.resolveTiebreakWinner(match));
      return;
    }

    if (match.phase === 'aiming' || match.phase === 'post_shot') {
      match.turnTimeLeftMs -= deltaMs;
      if (match.turnTimeLeftMs <= 0) {
        this.advanceTurn(match);
      }
    }
  }

  onShotFired(match: MatchState): void {
    if (match.phase === 'aiming') {
      match.phase = 'projectile_flight';
      match.turnTimeLeftMs = Number.POSITIVE_INFINITY;
    }
  }

  onProjectilesResolved(match: MatchState): void {
    if (match.phase === 'projectile_flight') {
      match.phase = 'post_shot';
      match.turnTimeLeftMs = this.config.postShotDelayMs;
    }
  }

  forceEndTurn(match: MatchState): void {
    this.advanceTurn(match);
  }

  getCurrentWorm(match: MatchState): WormState | undefined {
    return match.worms.find((worm) => worm.id === match.currentWormId);
  }

  private advanceTurn(match: MatchState): void {
    const winnerTeam = this.detectWinner(match);
    if (winnerTeam !== null) {
      this.finishMatch(match, winnerTeam);
      return;
    }

    const aliveTeamIds = this.collectAliveTeamIds(match);
    const totalTeams = this.teamOrder.length;
    const currentTeamIndex = this.resolveCurrentTeamIndex(match);

    for (let step = 1; step <= totalTeams; step += 1) {
      const nextTeamIndex = (currentTeamIndex + step) % totalTeams;
      const nextTeamId = this.teamOrder[nextTeamIndex];
      if (!aliveTeamIds.has(nextTeamId)) {
        continue;
      }

      const candidate = this.pickNextAliveWormFromTeam(match, nextTeamId);
      if (!candidate) {
        continue;
      }

      this.currentTeamIndex = nextTeamIndex;
      match.currentWormId = candidate.id;
      match.turnNumber += 1;
      match.phase = 'aiming';
      match.turnTimeLeftMs = this.config.durationMs;
      return;
    }

    this.finishMatch(match, null);
  }

  private detectWinner(match: MatchState): string | null {
    const aliveTeamIds = new Set<string>();
    for (const worm of match.worms) {
      if (worm.alive) {
        aliveTeamIds.add(worm.teamId);
      }
    }

    if (aliveTeamIds.size !== 1) {
      return null;
    }

    return [...aliveTeamIds][0] ?? null;
  }

  private buildTeamRotation(match: MatchState): void {
    this.teamOrder = [];
    this.teamWormOrder.clear();
    this.teamCursor.clear();

    const wormsByTeam = new Map<string, string[]>();
    for (const worm of match.worms) {
      const teamWormIds = wormsByTeam.get(worm.teamId) ?? [];
      teamWormIds.push(worm.id);
      wormsByTeam.set(worm.teamId, teamWormIds);
    }

    for (const team of match.teams) {
      const teamWormIds = wormsByTeam.get(team.id);
      if (!teamWormIds || teamWormIds.length === 0) {
        continue;
      }

      this.teamOrder.push(team.id);
      this.teamWormOrder.set(team.id, teamWormIds);
      this.teamCursor.set(team.id, -1);
      wormsByTeam.delete(team.id);
    }

    for (const [teamId, teamWormIds] of wormsByTeam.entries()) {
      this.teamOrder.push(teamId);
      this.teamWormOrder.set(teamId, teamWormIds);
      this.teamCursor.set(teamId, -1);
    }
  }

  private pickFirstAliveWorm(match: MatchState): WormState | null {
    for (const teamId of this.teamOrder) {
      const worm = this.pickNextAliveWormFromTeam(match, teamId);
      if (worm) {
        return worm;
      }
    }

    return null;
  }

  private pickNextAliveWormFromTeam(match: MatchState, teamId: string): WormState | null {
    const teamWormIds = this.teamWormOrder.get(teamId);
    if (!teamWormIds || teamWormIds.length === 0) {
      return null;
    }

    const startIndex = this.teamCursor.get(teamId) ?? -1;
    for (let step = 1; step <= teamWormIds.length; step += 1) {
      const candidateIndex = (startIndex + step) % teamWormIds.length;
      const candidateId = teamWormIds[candidateIndex];
      const candidate = match.worms.find((worm) => worm.id === candidateId);
      if (candidate?.alive) {
        this.teamCursor.set(teamId, candidateIndex);
        return candidate;
      }
    }

    return null;
  }

  private resolveCurrentTeamIndex(match: MatchState): number {
    const currentWorm = this.getCurrentWorm(match);
    if (currentWorm) {
      const indexFromWorm = this.teamOrder.indexOf(currentWorm.teamId);
      if (indexFromWorm >= 0) {
        return indexFromWorm;
      }
    }

    if (this.currentTeamIndex >= 0 && this.currentTeamIndex < this.teamOrder.length) {
      return this.currentTeamIndex;
    }

    return 0;
  }

  private collectAliveTeamIds(match: MatchState): Set<string> {
    const aliveTeamIds = new Set<string>();
    for (const worm of match.worms) {
      if (worm.alive) {
        aliveTeamIds.add(worm.teamId);
      }
    }
    return aliveTeamIds;
  }

  private resolveTiebreakWinner(match: MatchState): string | null {
    let bestTeamId: string | null = null;
    let bestHp = -1;
    let bestAliveCount = -1;
    let isTie = false;

    for (const team of match.teams) {
      let totalHp = 0;
      let aliveCount = 0;
      for (const worm of match.worms) {
        if (worm.teamId !== team.id) {
          continue;
        }
        totalHp += Math.max(0, worm.health);
        if (worm.alive) {
          aliveCount += 1;
        }
      }

      if (totalHp > bestHp || (totalHp === bestHp && aliveCount > bestAliveCount)) {
        bestTeamId = team.id;
        bestHp = totalHp;
        bestAliveCount = aliveCount;
        isTie = false;
        continue;
      }

      if (totalHp === bestHp && aliveCount === bestAliveCount) {
        isTie = true;
      }
    }

    return isTie ? null : bestTeamId;
  }

  private finishMatch(match: MatchState, winnerTeamId: string | null): void {
    match.phase = 'match_over';
    match.winnerTeamId = winnerTeamId;
    match.turnTimeLeftMs = 0;
  }
}
