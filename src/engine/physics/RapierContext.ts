import RAPIER from '@dimforge/rapier2d';

export class RapierContext {
  private destroyed = false;

  private constructor(
    public readonly api: typeof RAPIER,
    public readonly world: RAPIER.World,
  ) {}

  static async create(gravityY: number): Promise<RapierContext> {
    const world = new RAPIER.World({ x: 0, y: gravityY });
    world.lengthUnit = 100;
    return new RapierContext(RAPIER, world);
  }

  step(deltaSeconds: number): void {
    if (this.destroyed) {
      return;
    }

    this.world.timestep = deltaSeconds;
    this.world.step();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.world.free();
  }
}
