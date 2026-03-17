import type { TerrainGenerationContext, TerrainGenerationModule } from './types';

export class TerrainGenerator {
  constructor(private readonly modules: TerrainGenerationModule[]) {}

  generate(context: TerrainGenerationContext): Float32Array {
    const heights = new Float32Array(context.columns);
    for (const module of this.modules) {
      module.apply(heights, context);
    }

    return heights;
  }
}
