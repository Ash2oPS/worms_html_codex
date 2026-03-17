import { Application, Assets } from 'pixi.js';
import { loadGameConfig } from '../data/loadGameConfig';
import { RapierContext } from '../engine/physics/RapierContext';
import { AudioService } from '../infra/audio/AudioService';
import { BattleGame } from '../game/BattleGame';
import { openWormNameSetupModal } from './WormNameSetupModal';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

export const bootstrap = async (): Promise<void> => {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) {
    throw new Error('Missing #app root');
  }

  root.innerHTML = '<div class="loading">Loading battlefield...</div>';
  const config = loadGameConfig();
  const rapier = await RapierContext.create(config.rules.physics.gravityY);

  const shell = document.createElement('div');
  shell.className = 'game-shell';
  root.innerHTML = '';
  root.appendChild(shell);

  const app = new Application();
  await app.init({
    width: config.rules.world.width,
    height: config.rules.world.height,
    antialias: true,
    backgroundAlpha: 0,
    autoDensity: true,
    preference: 'webgl',
  });
  await Assets.load('/assets/worms/worms_sprite_00.png');
  await Assets.load('/assets/worms/worms_hand_sprite_00.png');
  await Assets.load('/assets/weapons/bazooka_sprite_00.png');
  app.canvas.setAttribute('aria-label', 'Worms-like battle');
  shell.appendChild(app.canvas);
  await openWormNameSetupModal(shell, config.teams);

  const audio = new AudioService();
  const game = new BattleGame(app, config, rapier, audio);
  app.ticker.add(() => {
    game.tick(app.ticker.deltaMS);
  });

  window.render_game_to_text = (): string => game.toTextSnapshot();
  window.advanceTime = (ms: number): void => {
    game.advanceTime(ms);
  };

  window.addEventListener('beforeunload', () => {
    game.destroy();
  });
};
