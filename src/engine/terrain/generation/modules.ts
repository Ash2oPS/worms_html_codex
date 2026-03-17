import { clamp } from '../../../core/math';
import type { TerrainGenerationContext, TerrainGenerationModule } from './types';

export interface TerrainWave {
  frequency: number;
  amplitude: number;
  phase?: number;
}

export class MidpointFillModule implements TerrainGenerationModule {
  readonly id = 'midpoint-fill';

  apply(heights: Float32Array, context: TerrainGenerationContext): void {
    const midpointY = (context.terrainConfig.minGroundY + context.terrainConfig.maxGroundY) * 0.5;
    heights.fill(midpointY);
  }
}

export class WaveBlendModule implements TerrainGenerationModule {
  readonly id = 'wave-blend';

  constructor(private readonly waves: TerrainWave[]) {}

  apply(heights: Float32Array, context: TerrainGenerationContext): void {
    const roughness = context.terrainConfig.roughness;
    const maxColumnIndex = Math.max(1, heights.length - 1);

    for (let column = 0; column < heights.length; column += 1) {
      const t = column / maxColumnIndex;
      let waveSum = 0;
      for (const wave of this.waves) {
        const phase = wave.phase ?? 0;
        waveSum += Math.sin((t * Math.PI * wave.frequency) + phase) * wave.amplitude;
      }
      heights[column] += waveSum * roughness;
    }
  }
}

export interface RollingNoiseOptions {
  damping: number;
  injection: number;
  amplitude: number;
}

export class RollingNoiseModule implements TerrainGenerationModule {
  readonly id = 'rolling-noise';

  constructor(private readonly options: RollingNoiseOptions) {}

  apply(heights: Float32Array, context: TerrainGenerationContext): void {
    const damping = clamp(this.options.damping, 0, 1);
    const injection = clamp(this.options.injection, 0, 1);
    const amplitude = Math.max(0, this.options.amplitude);
    const noiseRange = context.terrainConfig.roughness * amplitude;
    let rollingNoise = context.random.range(-noiseRange, noiseRange);

    for (let column = 0; column < heights.length; column += 1) {
      rollingNoise = (rollingNoise * damping) + (context.random.range(-noiseRange, noiseRange) * injection);
      heights[column] += rollingNoise;
    }
  }
}

export interface NeighborSmoothingOptions {
  iterations: number;
  centerWeight: number;
  neighborWeight: number;
}

export class NeighborSmoothingModule implements TerrainGenerationModule {
  readonly id = 'neighbor-smoothing';

  constructor(private readonly options: NeighborSmoothingOptions) {}

  apply(heights: Float32Array, _context: TerrainGenerationContext): void {
    const iterations = Math.max(0, Math.round(this.options.iterations));
    if (iterations === 0 || heights.length < 3) {
      return;
    }

    const centerWeightInput = Math.max(0, this.options.centerWeight);
    const neighborWeightInput = Math.max(0, this.options.neighborWeight);
    const totalWeight = Math.max(
      0.0001,
      centerWeightInput + (neighborWeightInput * 2),
    );
    const centerWeight = centerWeightInput / totalWeight;
    const neighborWeight = neighborWeightInput / totalWeight;
    const smoothed = new Float32Array(heights.length);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      smoothed[0] = heights[0] ?? 0;
      const lastIndex = heights.length - 1;
      smoothed[lastIndex] = heights[lastIndex] ?? 0;

      for (let column = 1; column < lastIndex; column += 1) {
        smoothed[column] = ((heights[column] ?? 0) * centerWeight)
          + (((heights[column - 1] ?? 0) + (heights[column + 1] ?? 0)) * neighborWeight);
      }

      heights.set(smoothed);
    }
  }
}

export class ClampRangeModule implements TerrainGenerationModule {
  readonly id = 'clamp-range';

  apply(heights: Float32Array, context: TerrainGenerationContext): void {
    const minGroundY = context.terrainConfig.minGroundY;
    const maxGroundY = context.terrainConfig.maxGroundY;
    for (let column = 0; column < heights.length; column += 1) {
      heights[column] = clamp(heights[column] ?? 0, minGroundY, maxGroundY);
    }
  }
}
