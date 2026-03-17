export interface WorldConfig {
  width: number;
  height: number;
  fixedTimeStepMs: number;
}

export interface TerrainConfig {
  columnWidth: number;
  minGroundY: number;
  maxGroundY: number;
  roughness: number;
  seed: number;
  randomizeSeedOnLoad?: boolean;
  generation?: TerrainGenerationConfigOverrides;
}

export interface TerrainWaveConfig {
  frequency: number;
  amplitude: number;
  phase?: number;
}

export interface TerrainRollingNoiseConfig {
  damping: number;
  injection: number;
  amplitude: number;
}

export interface TerrainSmoothingConfig {
  iterations: number;
  centerWeight: number;
  neighborWeight: number;
}

export interface TerrainFeatureConfig {
  mountainCount: number;
  mountainHeightMin: number;
  mountainHeightMax: number;
  mountainRadiusMin: number;
  mountainRadiusMax: number;
  plateauCount: number;
  plateauWidthMin: number;
  plateauWidthMax: number;
  plateauThicknessMin: number;
  plateauThicknessMax: number;
  plateauMinYRatio: number;
  plateauMaxYRatio: number;
  caveCount: number;
  caveRadiusMin: number;
  caveRadiusMax: number;
  tunnelCount: number;
  tunnelRadiusMin: number;
  tunnelRadiusMax: number;
  playablePlatformMinCount: number;
  playablePlatformMaxCount: number;
  playablePlatformMinWidth: number;
  playablePlatformMaxWidth: number;
  playablePlatformMinThickness: number;
  playablePlatformMaxThickness: number;
  playablePlatformMinYRatio: number;
  playablePlatformMaxYRatio: number;
  playablePlatformFlatTolerance: number;
  playablePlatformHeadroom: number;
}

export interface TerrainLayerConfig {
  topsoilDepth: number;
  dirtDepth: number;
  bedrockDepth: number;
}

export interface TerrainGenerationConfigOverrides {
  waves?: TerrainWaveConfig[];
  rollingNoise?: Partial<TerrainRollingNoiseConfig>;
  smoothing?: Partial<TerrainSmoothingConfig>;
  features?: Partial<TerrainFeatureConfig>;
  layers?: Partial<TerrainLayerConfig>;
}

export interface TurnConfig {
  durationMs: number;
  postShotDelayMs: number;
}

export interface PhysicsConfig {
  gravityY: number;
  wormRadius: number;
  movementImpulse: number;
  maxMoveSpeed: number;
  jumpImpulse: number;
  jumpForwardSpeed?: number;
  backJumpSpeed?: number;
  backJumpImpulse?: number;
}

export interface WindConfig {
  minForce: number;
  maxForce: number;
}

export interface WaterConfig {
  levelY: number;
}

export interface MatchConfig {
  wormsPerTeam: number;
  spawnPaddingX: number;
  maxDurationMs: number;
}

export interface RulesConfig {
  world: WorldConfig;
  terrain: TerrainConfig;
  turn: TurnConfig;
  physics: PhysicsConfig;
  wind: WindConfig;
  water: WaterConfig;
  match: MatchConfig;
}

export interface WeaponProjectileConfig {
  radius: number;
  mass: number;
  speed: number;
  restitution: number;
  fuseMs: number;
  windMultiplier: number;
  explodeOnImpact: boolean;
}

export interface WeaponExplosionConfig {
  radius: number;
  craterRadius: number;
  maxDamage: number;
  knockback: number;
}

export interface WeaponConfig {
  id: string;
  label: string;
  projectile: WeaponProjectileConfig;
  explosion: WeaponExplosionConfig;
}

export interface TeamTemplate {
  id: string;
  name: string;
  color: string;
  worms: string[];
  controller?: 'human' | 'ai';
}

export interface GameConfig {
  rules: RulesConfig;
  teams: TeamTemplate[];
  weapons: WeaponConfig[];
}

export interface VisualsConfig {
  cameraAimingZoom: number;
  cameraIdleZoom: number;
  terrainTextureStrength: number;
}

export interface AudioConfig {
  masterVolume: number;
  enableSfx: boolean;
}

export interface UiConfig {
  showNameSetupModal: boolean;
  wormNameMaxLength: number;
}

export interface StoreConfig {
  playStoreUrl: string;
  appStoreUrl: string;
  redirectAfterClicks: number;
  redirectAfterClickDelayMs: number;
}

export interface GameSettingsGameplayConfig {
  rules: RulesConfig;
  teams: TeamTemplate[];
  weapons: WeaponConfig[];
}

export interface GameSettingsSnapshot {
  gameplay: GameSettingsGameplayConfig;
  visuals: VisualsConfig;
  audio: AudioConfig;
  ui: UiConfig;
  store: StoreConfig;
  tooltips: Record<string, unknown>;
}

export interface GameSettingsConfig extends GameSettingsSnapshot {
  default: GameSettingsSnapshot;
}
