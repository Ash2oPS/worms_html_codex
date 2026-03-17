import { Howler } from 'howler';

export class AudioService {
  constructor() {
    Howler.volume(0.6);
  }

  playShot(): void {}

  playExplosion(): void {}
}
