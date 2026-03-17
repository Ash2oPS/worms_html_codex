import type { GameConfig, RulesConfig, TeamTemplate, WeaponConfig } from '../domain/config';
import { createRuntimeSeed } from '../core/seed';
import rules from './rules.json';
import teams from './teams.json';
import weapons from './weapons.json';

const loadRulesConfig = (): RulesConfig => {
  const runtimeRules = structuredClone(rules) as RulesConfig;
  if (runtimeRules.terrain.randomizeSeedOnLoad ?? true) {
    runtimeRules.terrain.seed = createRuntimeSeed(runtimeRules.terrain.seed);
  }

  return runtimeRules;
};

const loadTeams = (): TeamTemplate[] => structuredClone(teams) as TeamTemplate[];

const loadWeapons = (): WeaponConfig[] => structuredClone(weapons) as WeaponConfig[];

export const loadGameConfig = (): GameConfig => ({
  rules: loadRulesConfig(),
  teams: loadTeams(),
  weapons: loadWeapons(),
});
