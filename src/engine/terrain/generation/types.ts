import type { SeededRandom } from '../../../core/random';
import type { TerrainConfig, WorldConfig } from '../../../domain/config';

export interface TerrainGenerationContext {
  readonly worldConfig: WorldConfig;
  readonly terrainConfig: TerrainConfig;
  readonly columns: number;
  readonly random: SeededRandom;
}

export interface TerrainGenerationModule {
  readonly id: string;
  apply(heights: Float32Array, context: TerrainGenerationContext): void;
}
