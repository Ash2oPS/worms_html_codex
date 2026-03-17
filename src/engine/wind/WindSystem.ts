import type { WindConfig } from '../../domain/config';
import { SeededRandom } from '../../core/random';

export class WindSystem {
  private readonly random: SeededRandom;

  constructor(
    private readonly config: WindConfig,
    seed: number,
  ) {
    this.random = new SeededRandom(seed);
  }

  nextWindForce(): number {
    return this.random.range(this.config.minForce, this.config.maxForce);
  }
}
