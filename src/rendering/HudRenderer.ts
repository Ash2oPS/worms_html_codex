import { Container, Text } from 'pixi.js';
import type { MatchState } from '../domain/state';

export class HudRenderer {
  readonly container = new Container();
  private readonly hudText: Text;

  constructor() {
    this.hudText = new Text({
      text: '',
      style: {
        fill: 0xf3f6ff,
        fontSize: 18,
        fontFamily: 'Trebuchet MS',
        fontWeight: '600',
        stroke: { color: '#000000', width: 3 },
      },
    });
    this.hudText.x = 14;
    this.hudText.y = 12;
    this.container.addChild(this.hudText);
  }

  render(match: MatchState, activeWeaponLabel: string): void {
    const activeWorm = match.worms.find((worm) => worm.id === match.currentWormId);
    const activeTeam = activeWorm
      ? match.teams.find((team) => team.id === activeWorm.teamId)
      : undefined;
    const controllerLabel = activeTeam?.controller === 'ai'
      ? 'Controller: AI'
      : 'Controls: A/D move, W jump, W+W back-jump, Q/E aim, hold SPACE charge (2s max auto-fire), Z/X fine power, TAB menu';
    const turnLabel = match.phase === 'match_over'
      ? `Match over ${match.winnerTeamId ? `- Winner: ${match.winnerTeamId}` : '- Draw'}`
      : `Turn ${match.turnNumber} | ${activeWorm?.name ?? 'n/a'} (${activeWorm?.teamId ?? '?'})`;
    const timerLabel = match.phase === 'aiming'
      ? `${Math.max(0, Math.ceil(match.turnTimeLeftMs / 1000))}s`
      : '--';
    const powerPercent = activeWorm ? Math.round(activeWorm.power * 100) : 0;

    this.hudText.text = [
      `${turnLabel}`,
      `Weapon: ${activeWeaponLabel} | Power: ${powerPercent}%`,
      `Wind: ${match.windForce.toFixed(0)} | Timer: ${timerLabel}`,
      controllerLabel,
    ].join('\n');
  }
}
