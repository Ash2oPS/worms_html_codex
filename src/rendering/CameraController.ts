import type { Container } from 'pixi.js';
import { clamp } from '../core/math';

interface CameraTarget {
  x: number;
  y: number;
  zoom: number;
}

export class CameraController {
  private readonly current: CameraTarget;
  private readonly target: CameraTarget;

  constructor(
    private readonly worldLayer: Container,
    private readonly viewportWidth: number,
    private readonly viewportHeight: number,
    private readonly worldWidth: number,
    private readonly worldHeight: number,
  ) {
    this.current = {
      x: worldWidth * 0.5,
      y: worldHeight * 0.5,
      zoom: 1,
    };
    this.target = { ...this.current };
    this.applyTransform();
  }

  setTarget(x: number, y: number, zoom: number): void {
    const clampedZoom = clamp(zoom, 1, 1.5);
    const halfVisibleWidth = this.viewportWidth * 0.5 / clampedZoom;
    const halfVisibleHeight = this.viewportHeight * 0.5 / clampedZoom;
    const minX = halfVisibleWidth;
    const maxX = this.worldWidth - halfVisibleWidth;
    const minY = halfVisibleHeight;
    const maxY = this.worldHeight - halfVisibleHeight;

    this.target.zoom = clampedZoom;
    this.target.x = minX <= maxX ? clamp(x, minX, maxX) : this.worldWidth * 0.5;
    this.target.y = minY <= maxY ? clamp(y, minY, maxY) : this.worldHeight * 0.5;
  }

  update(deltaMs: number): void {
    const safeDeltaMs = clamp(deltaMs, 0, 100);
    const alpha = 1 - Math.exp(-8 * (safeDeltaMs / 1000));

    this.current.x += (this.target.x - this.current.x) * alpha;
    this.current.y += (this.target.y - this.current.y) * alpha;
    this.current.zoom += (this.target.zoom - this.current.zoom) * alpha;
    this.applyTransform();
  }

  private applyTransform(): void {
    this.worldLayer.scale.set(this.current.zoom, this.current.zoom);
    this.worldLayer.position.set(
      (this.viewportWidth * 0.5) - (this.current.x * this.current.zoom),
      (this.viewportHeight * 0.5) - (this.current.y * this.current.zoom),
    );
  }
}
