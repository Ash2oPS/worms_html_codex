import { createRuntimeSeed } from '../core/seed';
import type {
  AudioConfig,
  GameConfig,
  GameSettingsConfig,
  GameSettingsSnapshot,
  MatchConfig,
  PhysicsConfig,
  RulesConfig,
  StoreConfig,
  TeamTemplate,
  TerrainConfig,
  TerrainFeatureConfig,
  TerrainGenerationConfigOverrides,
  TerrainLayerConfig,
  TerrainRollingNoiseConfig,
  TerrainSmoothingConfig,
  TerrainWaveConfig,
  TurnConfig,
  UiConfig,
  VisualsConfig,
  WaterConfig,
  WeaponConfig,
  WeaponExplosionConfig,
  WeaponProjectileConfig,
  WindConfig,
  WorldConfig,
} from '../domain/config';
import builtinGameSettings from '../game-settings.json';

const BUILTIN_GAME_SETTINGS = structuredClone(builtinGameSettings) as GameSettingsConfig;
const BUILTIN_DEFAULT_SNAPSHOT = structuredClone(BUILTIN_GAME_SETTINGS.default) as GameSettingsSnapshot;

const DEFAULT_VISUALS: VisualsConfig = {
  cameraAimingZoom: 1.35,
  cameraIdleZoom: 1,
  terrainTextureStrength: 1,
};

const DEFAULT_AUDIO: AudioConfig = {
  masterVolume: 0.6,
  enableSfx: false,
};

const DEFAULT_UI: UiConfig = {
  showNameSetupModal: true,
  wormNameMaxLength: 24,
};

const DEFAULT_STORE: StoreConfig = {
  playStoreUrl: '',
  appStoreUrl: '',
  redirectAfterClicks: -1,
  redirectAfterClickDelayMs: -1,
};

const DEFAULT_TOOLTIPS: Record<string, unknown> = {};

interface ValidationState {
  errors: string[];
}

const createValidationState = (): ValidationState => ({
  errors: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const asNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
};

const asInteger = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => Math.round(asNumber(value, fallback, min, max));

const asString = (
  value: unknown,
  fallback: string,
  maxLength = 256,
): string => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed.slice(0, maxLength);
};

const sanitizeHexColor = (value: unknown, fallback: string): string => {
  const candidate = asString(value, fallback, 7);
  const normalized = candidate.startsWith('#') ? candidate : `#${candidate}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
};

const sanitizeId = (value: unknown, fallback: string): string => {
  const raw = asString(value, fallback, 64).toLowerCase();
  const compact = raw.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return compact.length > 0 ? compact : fallback;
};

const ensureUniqueId = (id: string, used: Set<string>, fallbackPrefix: string): string => {
  const base = sanitizeId(id, fallbackPrefix);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  let suffix = 2;
  let candidate = `${base}_${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  used.add(candidate);
  return candidate;
};

const sanitizeWave = (
  rawWave: unknown,
  fallbackWave: TerrainWaveConfig,
): TerrainWaveConfig => {
  const wave = asRecord(rawWave);
  return {
    frequency: asNumber(wave?.frequency, fallbackWave.frequency, 0.01, 128),
    amplitude: asNumber(wave?.amplitude, fallbackWave.amplitude, 0, 5),
    phase: asNumber(
      wave?.phase,
      fallbackWave.phase ?? 0,
      -Math.PI * 4,
      Math.PI * 4,
    ),
  };
};

const sanitizeRollingNoise = (
  raw: unknown,
  fallback: TerrainRollingNoiseConfig,
): TerrainRollingNoiseConfig => {
  const source = asRecord(raw);
  return {
    damping: asNumber(source?.damping, fallback.damping, 0, 1.2),
    injection: asNumber(source?.injection, fallback.injection, 0, 1.2),
    amplitude: asNumber(source?.amplitude, fallback.amplitude, 0, 5),
  };
};

const sanitizeSmoothing = (
  raw: unknown,
  fallback: TerrainSmoothingConfig,
): TerrainSmoothingConfig => {
  const source = asRecord(raw);
  return {
    iterations: asInteger(source?.iterations, fallback.iterations, 0, 18),
    centerWeight: asNumber(source?.centerWeight, fallback.centerWeight, 0, 2),
    neighborWeight: asNumber(source?.neighborWeight, fallback.neighborWeight, 0, 2),
  };
};

const sanitizeFeatures = (
  raw: unknown,
  fallback: TerrainFeatureConfig,
): TerrainFeatureConfig => {
  const source = asRecord(raw);
  return {
    mountainCount: asInteger(source?.mountainCount, fallback.mountainCount, 0, 50),
    mountainHeightMin: asNumber(source?.mountainHeightMin, fallback.mountainHeightMin, 0, 200),
    mountainHeightMax: asNumber(source?.mountainHeightMax, fallback.mountainHeightMax, 0, 250),
    mountainRadiusMin: asNumber(source?.mountainRadiusMin, fallback.mountainRadiusMin, 1, 200),
    mountainRadiusMax: asNumber(source?.mountainRadiusMax, fallback.mountainRadiusMax, 1, 240),
    plateauCount: asInteger(source?.plateauCount, fallback.plateauCount, 0, 50),
    plateauWidthMin: asNumber(source?.plateauWidthMin, fallback.plateauWidthMin, 1, 250),
    plateauWidthMax: asNumber(source?.plateauWidthMax, fallback.plateauWidthMax, 1, 300),
    plateauThicknessMin: asNumber(source?.plateauThicknessMin, fallback.plateauThicknessMin, 1, 80),
    plateauThicknessMax: asNumber(source?.plateauThicknessMax, fallback.plateauThicknessMax, 1, 120),
    plateauMinYRatio: asNumber(source?.plateauMinYRatio, fallback.plateauMinYRatio, 0.01, 0.95),
    plateauMaxYRatio: asNumber(source?.plateauMaxYRatio, fallback.plateauMaxYRatio, 0.01, 0.98),
    caveCount: asInteger(source?.caveCount, fallback.caveCount, 0, 120),
    caveRadiusMin: asNumber(source?.caveRadiusMin, fallback.caveRadiusMin, 1, 120),
    caveRadiusMax: asNumber(source?.caveRadiusMax, fallback.caveRadiusMax, 1, 160),
    tunnelCount: asInteger(source?.tunnelCount, fallback.tunnelCount, 0, 120),
    tunnelRadiusMin: asNumber(source?.tunnelRadiusMin, fallback.tunnelRadiusMin, 1, 64),
    tunnelRadiusMax: asNumber(source?.tunnelRadiusMax, fallback.tunnelRadiusMax, 1, 96),
    playablePlatformMinCount: asInteger(source?.playablePlatformMinCount, fallback.playablePlatformMinCount, 0, 20),
    playablePlatformMaxCount: asInteger(source?.playablePlatformMaxCount, fallback.playablePlatformMaxCount, 0, 30),
    playablePlatformMinWidth: asNumber(source?.playablePlatformMinWidth, fallback.playablePlatformMinWidth, 1, 120),
    playablePlatformMaxWidth: asNumber(source?.playablePlatformMaxWidth, fallback.playablePlatformMaxWidth, 1, 180),
    playablePlatformMinThickness: asNumber(source?.playablePlatformMinThickness, fallback.playablePlatformMinThickness, 1, 30),
    playablePlatformMaxThickness: asNumber(source?.playablePlatformMaxThickness, fallback.playablePlatformMaxThickness, 1, 40),
    playablePlatformMinYRatio: asNumber(source?.playablePlatformMinYRatio, fallback.playablePlatformMinYRatio, 0.02, 0.92),
    playablePlatformMaxYRatio: asNumber(source?.playablePlatformMaxYRatio, fallback.playablePlatformMaxYRatio, 0.05, 0.95),
    playablePlatformFlatTolerance: asInteger(source?.playablePlatformFlatTolerance, fallback.playablePlatformFlatTolerance, 0, 20),
    playablePlatformHeadroom: asInteger(source?.playablePlatformHeadroom, fallback.playablePlatformHeadroom, 1, 30),
  };
};

const sanitizeLayers = (
  raw: unknown,
  fallback: TerrainLayerConfig,
): TerrainLayerConfig => {
  const source = asRecord(raw);
  return {
    topsoilDepth: asNumber(source?.topsoilDepth, fallback.topsoilDepth, 0.5, 20),
    dirtDepth: asNumber(source?.dirtDepth, fallback.dirtDepth, 0.5, 80),
    bedrockDepth: asNumber(source?.bedrockDepth, fallback.bedrockDepth, 0.5, 50),
  };
};

const sanitizeTerrainGeneration = (
  raw: unknown,
  fallback: TerrainGenerationConfigOverrides | undefined,
): TerrainGenerationConfigOverrides | undefined => {
  if (!fallback) {
    return undefined;
  }

  const source = asRecord(raw);
  const fallbackWaves = asArray(fallback.waves).map((wave) => sanitizeWave(wave, {
    frequency: 2,
    amplitude: 0.5,
    phase: 0,
  }));
  const wavesSource = asArray(source?.waves);
  const waves = wavesSource.length > 0
    ? wavesSource.map((wave, index) => sanitizeWave(wave, fallbackWaves[index] ?? fallbackWaves[0] ?? {
      frequency: 2,
      amplitude: 0.5,
      phase: 0,
    }))
    : fallbackWaves;

  return {
    waves,
    rollingNoise: sanitizeRollingNoise(
      source?.rollingNoise,
      fallback.rollingNoise as TerrainRollingNoiseConfig,
    ),
    smoothing: sanitizeSmoothing(
      source?.smoothing,
      fallback.smoothing as TerrainSmoothingConfig,
    ),
    features: sanitizeFeatures(
      source?.features,
      fallback.features as TerrainFeatureConfig,
    ),
    layers: sanitizeLayers(
      source?.layers,
      fallback.layers as TerrainLayerConfig,
    ),
  };
};

const sanitizeWorldConfig = (raw: unknown, fallback: WorldConfig): WorldConfig => {
  const source = asRecord(raw);
  return {
    width: asInteger(source?.width, fallback.width, 640, 8192),
    height: asInteger(source?.height, fallback.height, 360, 4096),
    fixedTimeStepMs: asNumber(source?.fixedTimeStepMs, fallback.fixedTimeStepMs, 4, 34),
  };
};

const sanitizeTerrainConfig = (raw: unknown, fallback: TerrainConfig): TerrainConfig => {
  const source = asRecord(raw);
  return {
    columnWidth: asNumber(source?.columnWidth, fallback.columnWidth, 2, 64),
    minGroundY: asNumber(source?.minGroundY, fallback.minGroundY, 1, 6000),
    maxGroundY: asNumber(source?.maxGroundY, fallback.maxGroundY, 1, 6000),
    roughness: asNumber(source?.roughness, fallback.roughness, 0, 300),
    seed: asInteger(source?.seed, fallback.seed, 0, 0xffffffff),
    randomizeSeedOnLoad: asBoolean(source?.randomizeSeedOnLoad, fallback.randomizeSeedOnLoad ?? true),
    generation: sanitizeTerrainGeneration(source?.generation, fallback.generation),
  };
};

const sanitizeTurnConfig = (raw: unknown, fallback: TurnConfig): TurnConfig => {
  const source = asRecord(raw);
  return {
    durationMs: asInteger(source?.durationMs, fallback.durationMs, 1000, 120000),
    postShotDelayMs: asInteger(source?.postShotDelayMs, fallback.postShotDelayMs, 0, 8000),
  };
};

const sanitizePhysicsConfig = (raw: unknown, fallback: PhysicsConfig): PhysicsConfig => {
  const source = asRecord(raw);
  return {
    gravityY: asNumber(source?.gravityY, fallback.gravityY, 50, 4000),
    wormRadius: asNumber(source?.wormRadius, fallback.wormRadius, 4, 80),
    movementImpulse: asNumber(source?.movementImpulse, fallback.movementImpulse, 0, 1000),
    maxMoveSpeed: asNumber(source?.maxMoveSpeed, fallback.maxMoveSpeed, 20, 800),
    jumpImpulse: asNumber(source?.jumpImpulse, fallback.jumpImpulse, 30, 2000),
    jumpForwardSpeed: asNumber(source?.jumpForwardSpeed, fallback.jumpForwardSpeed ?? 160, 20, 1200),
    backJumpSpeed: asNumber(source?.backJumpSpeed, fallback.backJumpSpeed ?? 100, 20, 1200),
    backJumpImpulse: asNumber(source?.backJumpImpulse, fallback.backJumpImpulse ?? 380, 30, 2200),
  };
};

const sanitizeWindConfig = (raw: unknown, fallback: WindConfig): WindConfig => {
  const source = asRecord(raw);
  let minForce = asNumber(source?.minForce, fallback.minForce, -600, 600);
  let maxForce = asNumber(source?.maxForce, fallback.maxForce, -600, 600);
  if (minForce > maxForce) {
    const swap = minForce;
    minForce = maxForce;
    maxForce = swap;
  }
  return {
    minForce,
    maxForce,
  };
};

const sanitizeWaterConfig = (raw: unknown, fallback: WaterConfig): WaterConfig => {
  const source = asRecord(raw);
  return {
    levelY: asNumber(source?.levelY, fallback.levelY, 0, 10000),
  };
};

const sanitizeMatchConfig = (raw: unknown, fallback: MatchConfig): MatchConfig => {
  const source = asRecord(raw);
  const maxDurationMs = asInteger(source?.maxDurationMs, fallback.maxDurationMs, -1, 900000);
  return {
    wormsPerTeam: asInteger(source?.wormsPerTeam, fallback.wormsPerTeam, 1, 12),
    spawnPaddingX: asNumber(source?.spawnPaddingX, fallback.spawnPaddingX, 0, 2000),
    maxDurationMs: maxDurationMs < 0 ? -1 : maxDurationMs,
  };
};

const sanitizeRulesConfig = (raw: unknown, fallback: RulesConfig): RulesConfig => {
  const source = asRecord(raw);
  return {
    world: sanitizeWorldConfig(source?.world, fallback.world),
    terrain: sanitizeTerrainConfig(source?.terrain, fallback.terrain),
    turn: sanitizeTurnConfig(source?.turn, fallback.turn),
    physics: sanitizePhysicsConfig(source?.physics, fallback.physics),
    wind: sanitizeWindConfig(source?.wind, fallback.wind),
    water: sanitizeWaterConfig(source?.water, fallback.water),
    match: sanitizeMatchConfig(source?.match, fallback.match),
  };
};

const sanitizeProjectileConfig = (
  raw: unknown,
  fallback: WeaponProjectileConfig,
): WeaponProjectileConfig => {
  const source = asRecord(raw);
  return {
    radius: asNumber(source?.radius, fallback.radius, 1, 50),
    mass: asNumber(source?.mass, fallback.mass, 0.01, 20),
    speed: asNumber(source?.speed, fallback.speed, 10, 2400),
    restitution: asNumber(source?.restitution, fallback.restitution, 0, 1),
    fuseMs: asInteger(source?.fuseMs, fallback.fuseMs, 0, 180000),
    windMultiplier: asNumber(source?.windMultiplier, fallback.windMultiplier, -5, 5),
    explodeOnImpact: asBoolean(source?.explodeOnImpact, fallback.explodeOnImpact),
  };
};

const sanitizeExplosionConfig = (
  raw: unknown,
  fallback: WeaponExplosionConfig,
): WeaponExplosionConfig => {
  const source = asRecord(raw);
  return {
    radius: asNumber(source?.radius, fallback.radius, 1, 500),
    craterRadius: asNumber(source?.craterRadius, fallback.craterRadius, 0, 500),
    maxDamage: asInteger(source?.maxDamage, fallback.maxDamage, 0, 1000),
    knockback: asNumber(source?.knockback, fallback.knockback, 0, 8000),
  };
};

const sanitizeWeapons = (
  rawWeapons: unknown,
  fallbackWeapons: WeaponConfig[],
): WeaponConfig[] => {
  const source = asArray(rawWeapons);
  const usedIds = new Set<string>();
  const fallbackFirstWeapon = fallbackWeapons[0];
  const fallbackCatalog = fallbackWeapons.length > 0 ? fallbackWeapons : [{
    id: 'bazooka',
    label: 'Bazooka',
    projectile: {
      radius: 5,
      mass: 0.45,
      speed: 520,
      restitution: 0.05,
      fuseMs: 0,
      windMultiplier: 0.95,
      explodeOnImpact: true,
    },
    explosion: {
      radius: 92,
      craterRadius: 72,
      maxDamage: 58,
      knockback: 260,
    },
  }];

  const sanitized = source.map((entry, index) => {
    const weapon = asRecord(entry);
    const fallback = fallbackWeapons[index] ?? fallbackFirstWeapon ?? fallbackCatalog[0];
    const uniqueId = ensureUniqueId(
      sanitizeId(weapon?.id, fallback.id || `weapon_${index + 1}`),
      usedIds,
      `weapon_${index + 1}`,
    );
    return {
      id: uniqueId,
      label: asString(weapon?.label, fallback.label, 64),
      projectile: sanitizeProjectileConfig(weapon?.projectile, fallback.projectile),
      explosion: sanitizeExplosionConfig(weapon?.explosion, fallback.explosion),
    };
  }).filter((entry) => entry.id.length > 0);

  if (sanitized.length > 0) {
    return sanitized;
  }

  return fallbackCatalog.map((weapon, index) => ({
    ...weapon,
    id: ensureUniqueId(weapon.id || `weapon_${index + 1}`, usedIds, `weapon_${index + 1}`),
  }));
};

const sanitizeTeamWormNames = (rawWorms: unknown, fallbackWorms: string[]): string[] => {
  const source = asArray(rawWorms);
  const names = source
    .map((entry, index) => asString(entry, fallbackWorms[index] ?? `Worm ${index + 1}`, 24))
    .filter((entry) => entry.length > 0);
  if (names.length > 0) {
    return names;
  }
  if (fallbackWorms.length > 0) {
    return fallbackWorms.map((entry, index) => asString(entry, `Worm ${index + 1}`, 24));
  }
  return ['Worm 1'];
};

const sanitizeTeams = (
  rawTeams: unknown,
  fallbackTeams: TeamTemplate[],
): TeamTemplate[] => {
  const source = asArray(rawTeams);
  const usedIds = new Set<string>();
  const fallbackFirst = fallbackTeams[0] ?? {
    id: 'team_1',
    name: 'Team 1',
    color: '#ffffff',
    controller: 'human' as const,
    worms: ['Worm 1'],
  };
  const sanitized = source.map((entry, index) => {
    const team = asRecord(entry);
    const fallback = fallbackTeams[index] ?? fallbackFirst;
    const id = ensureUniqueId(
      sanitizeId(team?.id, fallback.id || `team_${index + 1}`),
      usedIds,
      `team_${index + 1}`,
    );
    const controller = team?.controller === 'ai' ? 'ai' : team?.controller === 'human' ? 'human' : (fallback.controller ?? 'human');
    return {
      id,
      name: asString(team?.name, fallback.name || `Team ${index + 1}`, 48),
      color: sanitizeHexColor(team?.color, fallback.color || '#8ab4ff'),
      controller,
      worms: sanitizeTeamWormNames(team?.worms, fallback.worms ?? []),
    };
  }).filter((team) => team.id.length > 0);

  if (sanitized.length > 0) {
    return sanitized;
  }

  return fallbackTeams.length > 0
    ? fallbackTeams.map((team, index) => ({
      ...team,
      id: ensureUniqueId(sanitizeId(team.id, `team_${index + 1}`), usedIds, `team_${index + 1}`),
      worms: sanitizeTeamWormNames(team.worms, team.worms),
    }))
    : [{
      ...fallbackFirst,
      id: ensureUniqueId(sanitizeId(fallbackFirst.id, 'team_1'), usedIds, 'team_1'),
      worms: sanitizeTeamWormNames(fallbackFirst.worms, fallbackFirst.worms),
    }];
};

const sanitizeVisualsConfig = (raw: unknown, fallback: VisualsConfig): VisualsConfig => {
  const source = asRecord(raw);
  return {
    cameraAimingZoom: asNumber(source?.cameraAimingZoom, fallback.cameraAimingZoom, 0.7, 2.4),
    cameraIdleZoom: asNumber(source?.cameraIdleZoom, fallback.cameraIdleZoom, 0.7, 2.4),
    terrainTextureStrength: asNumber(source?.terrainTextureStrength, fallback.terrainTextureStrength, 0, 2),
  };
};

const sanitizeAudioConfig = (raw: unknown, fallback: AudioConfig): AudioConfig => {
  const source = asRecord(raw);
  return {
    masterVolume: asNumber(source?.masterVolume, fallback.masterVolume, 0, 1),
    enableSfx: asBoolean(source?.enableSfx, fallback.enableSfx),
  };
};

const sanitizeUiConfig = (raw: unknown, fallback: UiConfig): UiConfig => {
  const source = asRecord(raw);
  return {
    showNameSetupModal: asBoolean(source?.showNameSetupModal, fallback.showNameSetupModal),
    wormNameMaxLength: asInteger(source?.wormNameMaxLength, fallback.wormNameMaxLength, 8, 40),
  };
};

const sanitizeStoreConfig = (raw: unknown, fallback: StoreConfig): StoreConfig => {
  const source = asRecord(raw);
  const redirectAfterClicks = asInteger(source?.redirectAfterClicks, fallback.redirectAfterClicks, -1, 500);
  const redirectAfterClickDelayMs = asInteger(source?.redirectAfterClickDelayMs, fallback.redirectAfterClickDelayMs, -1, 180000);
  return {
    playStoreUrl: asString(source?.playStoreUrl, fallback.playStoreUrl, 400),
    appStoreUrl: asString(source?.appStoreUrl, fallback.appStoreUrl, 400),
    redirectAfterClicks: redirectAfterClicks < 0 ? -1 : redirectAfterClicks,
    redirectAfterClickDelayMs: redirectAfterClickDelayMs < 0 ? -1 : redirectAfterClickDelayMs,
  };
};

const sanitizeTooltips = (raw: unknown, fallback: Record<string, unknown>): Record<string, unknown> => {
  if (!isRecord(raw)) {
    return structuredClone(fallback);
  }
  return structuredClone(raw);
};

const enforceTeamRosterLength = (teams: TeamTemplate[], wormsPerTeam: number): TeamTemplate[] =>
  teams.map((team, teamIndex) => {
    const names = [...team.worms];
    while (names.length < wormsPerTeam) {
      names.push(`${team.name} ${names.length + 1}`);
    }
    return {
      ...team,
      worms: names.slice(0, Math.max(wormsPerTeam, names.length)),
      id: team.id || `team_${teamIndex + 1}`,
    };
  });

const assertConfigIntegrity = (
  config: GameConfig,
  sourceLabel: string,
  state: ValidationState,
): void => {
  if (config.weapons.length <= 0) {
    state.errors.push(`[${sourceLabel}] weapons must contain at least one entry.`);
  }
  if (config.teams.length <= 0) {
    state.errors.push(`[${sourceLabel}] teams must contain at least one entry.`);
  }

  const weaponIdSet = new Set<string>();
  for (const weapon of config.weapons) {
    if (weaponIdSet.has(weapon.id)) {
      state.errors.push(`[${sourceLabel}] duplicate weapon id "${weapon.id}".`);
    }
    weaponIdSet.add(weapon.id);
  }

  const teamIdSet = new Set<string>();
  for (const team of config.teams) {
    if (teamIdSet.has(team.id)) {
      state.errors.push(`[${sourceLabel}] duplicate team id "${team.id}".`);
    }
    teamIdSet.add(team.id);
  }
};

const finalizeGameConfig = (
  rules: RulesConfig,
  teams: TeamTemplate[],
  weapons: WeaponConfig[],
  sourceLabel: string,
): GameConfig => {
  const state = createValidationState();
  const rosterSafeTeams = enforceTeamRosterLength(teams, rules.match.wormsPerTeam);
  const runtimeRules = structuredClone(rules);
  if (runtimeRules.terrain.randomizeSeedOnLoad ?? true) {
    runtimeRules.terrain.seed = createRuntimeSeed(runtimeRules.terrain.seed);
  }

  const finalConfig: GameConfig = {
    rules: runtimeRules,
    teams: rosterSafeTeams,
    weapons,
  };

  assertConfigIntegrity(finalConfig, sourceLabel, state);
  if (state.errors.length > 0) {
    throw new Error(`Invalid ${sourceLabel} config:\n- ${state.errors.join('\n- ')}`);
  }
  return finalConfig;
};

const sanitizeSnapshot = (
  rawSnapshot: unknown,
  defaults: GameSettingsSnapshot,
): GameSettingsSnapshot => {
  const source = asRecord(rawSnapshot);
  const gameplayRaw = asRecord(source?.gameplay);
  return {
    gameplay: {
      rules: sanitizeRulesConfig(gameplayRaw?.rules, defaults.gameplay.rules),
      teams: sanitizeTeams(gameplayRaw?.teams, defaults.gameplay.teams),
      weapons: sanitizeWeapons(gameplayRaw?.weapons, defaults.gameplay.weapons),
    },
    visuals: sanitizeVisualsConfig(source?.visuals, defaults.visuals),
    audio: sanitizeAudioConfig(source?.audio, defaults.audio),
    ui: sanitizeUiConfig(source?.ui, defaults.ui),
    store: sanitizeStoreConfig(source?.store, defaults.store),
    tooltips: sanitizeTooltips(source?.tooltips, defaults.tooltips),
  };
};

const createBuiltInDefaultsSnapshot = (): GameSettingsSnapshot => ({
  gameplay: {
    rules: structuredClone(BUILTIN_DEFAULT_SNAPSHOT.gameplay.rules),
    teams: structuredClone(BUILTIN_DEFAULT_SNAPSHOT.gameplay.teams),
    weapons: structuredClone(BUILTIN_DEFAULT_SNAPSHOT.gameplay.weapons),
  },
  visuals: structuredClone(BUILTIN_DEFAULT_SNAPSHOT.visuals ?? DEFAULT_VISUALS),
  audio: structuredClone(BUILTIN_DEFAULT_SNAPSHOT.audio ?? DEFAULT_AUDIO),
  ui: structuredClone(BUILTIN_DEFAULT_SNAPSHOT.ui ?? DEFAULT_UI),
  store: structuredClone(BUILTIN_DEFAULT_SNAPSHOT.store ?? DEFAULT_STORE),
  tooltips: structuredClone(BUILTIN_DEFAULT_SNAPSHOT.tooltips ?? DEFAULT_TOOLTIPS),
});

const validateCanonicalTopLevel = (rawSettings: unknown): void => {
  const source = asRecord(rawSettings);
  const errors: string[] = [];
  if (!source) {
    throw new Error('Invalid game-settings.json: expected an object at root.');
  }

  const requiredRootKeys: Array<keyof GameSettingsConfig> = [
    'gameplay',
    'visuals',
    'audio',
    'ui',
    'store',
    'tooltips',
    'default',
  ];
  for (const key of requiredRootKeys) {
    if (!(key in source)) {
      errors.push(`Missing root key "${key}".`);
    }
  }

  const defaultSnapshot = asRecord(source.default);
  if (!defaultSnapshot) {
    errors.push('Key "default" must be an object.');
  } else {
    const requiredSnapshotKeys: Array<keyof GameSettingsSnapshot> = [
      'gameplay',
      'visuals',
      'audio',
      'ui',
      'store',
      'tooltips',
    ];
    for (const key of requiredSnapshotKeys) {
      if (!(key in defaultSnapshot)) {
        errors.push(`Missing default snapshot key "${key}".`);
      }
    }
  }

  const gameplay = asRecord(source.gameplay);
  if (!gameplay) {
    errors.push('Key "gameplay" must be an object.');
  } else {
    if (!('rules' in gameplay)) {
      errors.push('Key "gameplay.rules" is required.');
    }
    if (!('teams' in gameplay)) {
      errors.push('Key "gameplay.teams" is required.');
    }
    if (!('weapons' in gameplay)) {
      errors.push('Key "gameplay.weapons" is required.');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid game-settings.json:\n- ${errors.join('\n- ')}`);
  }
};

export const toInternalGameConfigFromSettings = (rawSettings: unknown): GameConfig => {
  validateCanonicalTopLevel(rawSettings);
  const source = asRecord(rawSettings);
  const defaultsBase = createBuiltInDefaultsSnapshot();
  const defaultSnapshotRaw = asRecord(source?.default);
  const sanitizedDefaults = sanitizeSnapshot(defaultSnapshotRaw, defaultsBase);
  const activeSnapshot = sanitizeSnapshot(source, sanitizedDefaults);
  return finalizeGameConfig(
    activeSnapshot.gameplay.rules,
    activeSnapshot.gameplay.teams,
    activeSnapshot.gameplay.weapons,
    'game-settings.json',
  );
};
