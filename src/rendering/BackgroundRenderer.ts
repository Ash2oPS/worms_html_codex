import { Graphics } from 'pixi.js';

export class BackgroundRenderer {
  readonly graphics = new Graphics();

  render(width: number, height: number, waterLevelY: number): void {
    this.graphics.clear();

    this.graphics.beginFill(0x1b2f4f, 1);
    this.graphics.drawRect(0, 0, width, height);
    this.graphics.endFill();

    this.graphics.beginFill(0x294a79, 0.3);
    this.graphics.drawEllipse(width * 0.15, height * 0.1, width * 0.35, height * 0.17);
    this.graphics.drawEllipse(width * 0.8, height * 0.18, width * 0.4, height * 0.2);
    this.graphics.endFill();

    this.graphics.beginFill(0xffffff, 0.12);
    this.graphics.drawEllipse(width * 0.18, height * 0.24, 100, 36);
    this.graphics.drawEllipse(width * 0.75, height * 0.27, 120, 42);
    this.graphics.endFill();

    const clampedWaterTop = Math.max(0, Math.min(height, waterLevelY));
    if (clampedWaterTop < height) {
      this.graphics.beginFill(0x2f8fcb, 0.68);
      this.graphics.drawRect(0, clampedWaterTop, width, height - clampedWaterTop);
      this.graphics.endFill();

      this.graphics.beginFill(0x7bd3ff, 0.2);
      this.graphics.drawRect(0, clampedWaterTop, width, Math.min(24, height - clampedWaterTop));
      this.graphics.endFill();

      this.graphics.lineStyle(2.2, 0xcfeeff, 0.78);
      this.graphics.moveTo(0, clampedWaterTop);
      this.graphics.lineTo(width, clampedWaterTop);
      this.graphics.lineStyle(0, 0, 0);
    }
  }
}
