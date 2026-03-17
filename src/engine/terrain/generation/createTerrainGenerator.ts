import type {
  TerrainConfig,
  TerrainRollingNoiseConfig,
  TerrainSmoothingConfig,
  TerrainWaveConfig,
} from '../../../domain/config';
import { TerrainGenerator } from './TerrainGenerator';
import {
  ClampRangeModule,
  MidpointFillModule,
  NeighborSmoothingModule,
  RollingNoiseModule,
  WaveBlendModule,
} from './modules';

const DEFAULT_WAVES: TerrainWaveConfig[] = [
  { frequency: 2.8, amplitude: 0.5 },
  { frequency: 7.2, amplitude: 0.22 },
];

const DEFAULT_ROLLING_NOISE: TerrainRollingNoiseConfig = {
  damping: 0.84,
  injection: 0.16,
  amplitude: 1,
};

const DEFAULT_SMOOTHING: TerrainSmoothingConfig = {
  iterations: 5,
  centerWeight: 0.52,
  neighborWeight: 0.24,
};

export const createTerrainGenerator = (terrainConfig: TerrainConfig): TerrainGenerator => {
  const waves = terrainConfig.generation?.waves?.length
    ? terrainConfig.generation.waves
    : DEFAULT_WAVES;
  const rollingNoise = {
    ...DEFAULT_ROLLING_NOISE,
    ...(terrainConfig.generation?.rollingNoise ?? {}),
  };
  const smoothing = {
    ...DEFAULT_SMOOTHING,
    ...(terrainConfig.generation?.smoothing ?? {}),
  };

  return new TerrainGenerator([
    new MidpointFillModule(),
    new WaveBlendModule(waves),
    new RollingNoiseModule(rollingNoise),
    new ClampRangeModule(),
    new NeighborSmoothingModule(smoothing),
    new ClampRangeModule(),
  ]);
};
