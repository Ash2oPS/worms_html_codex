import type { GameConfig } from '../domain/config';
import gameSettings from '../game-settings.json';
import { toInternalGameConfigFromSettings } from './gameConfigAdapter';

const loadCanonicalConfig = (): GameConfig =>
  toInternalGameConfigFromSettings(structuredClone(gameSettings));

export const loadGameConfig = (): GameConfig => loadCanonicalConfig();
