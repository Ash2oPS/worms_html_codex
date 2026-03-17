import RAPIER from '@dimforge/rapier2d-compat';

export class RapierContext {
  private constructor(
    public readonly api: typeof RAPIER,
    public readonly world: RAPIER.World,
  ) {}

  static async create(gravityY: number): Promise<RapierContext> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: gravityY });
    world.lengthUnit = 100;
    return new RapierContext(RAPIER, world);
  }

  step(deltaSeconds: number): void {
    this.world.timestep = deltaSeconds;
    this.world.step();
  }
}
