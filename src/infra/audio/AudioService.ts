import { clamp } from '../../core/math';

export interface AudioServiceConfig {
  enabled?: boolean;
  masterVolume?: number;
}

export class AudioService {
  readonly enabled: boolean;
  readonly masterVolume: number;

  constructor(config: AudioServiceConfig = {}) {
    this.enabled = config.enabled ?? false;
    this.masterVolume = clamp(config.masterVolume ?? 0.6, 0, 1);
  }

  playShot(): void {}

  playExplosion(): void {}
}
