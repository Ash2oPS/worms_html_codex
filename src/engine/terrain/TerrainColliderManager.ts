import type { Collider, RigidBody } from '@dimforge/rapier2d';
import { RapierContext } from '../physics/RapierContext';
import { buildMarchingSegments } from './marchingSquares';

export class TerrainColliderManager {
  private readonly staticBody: RigidBody;
  private readonly collidersByChunk = new Map<number, Collider[]>();

  constructor(
    private readonly rapier: RapierContext,
    private readonly rows: number,
    private readonly cellSize: number,
    private readonly columns: number,
    private readonly physicsChunkColumns: number,
    private readonly physicsChunkCount: number,
    private readonly isCellSolid: (column: number, row: number) => boolean,
  ) {
    const bodyDesc = this.rapier.api.RigidBodyDesc.fixed();
    this.staticBody = this.rapier.world.createRigidBody(bodyDesc);
  }

  rebuildAllChunks(): void {
    for (let chunkIndex = 0; chunkIndex < this.physicsChunkCount; chunkIndex += 1) {
      this.rebuildChunkColliders(chunkIndex);
    }
  }

  rebuildDirtyChunks(chunkIndices: number[]): void {
    for (const chunkIndex of chunkIndices) {
      this.rebuildChunkColliders(chunkIndex);
    }
  }

  destroy(): void {
    for (const colliders of this.collidersByChunk.values()) {
      for (const collider of colliders) {
        this.rapier.world.removeCollider(collider, false);
      }
    }
    this.collidersByChunk.clear();

    const body = this.rapier.world.getRigidBody(this.staticBody.handle);
    if (body) {
      this.rapier.world.removeRigidBody(body);
    }
  }

  private rebuildChunkColliders(chunkIndex: number): void {
    const existingColliders = this.collidersByChunk.get(chunkIndex) ?? [];
    for (const collider of existingColliders) {
      this.rapier.world.removeCollider(collider, false);
    }
    this.collidersByChunk.delete(chunkIndex);

    const coreStartColumn = chunkIndex * this.physicsChunkColumns;
    if (coreStartColumn >= this.columns) {
      return;
    }

    const coreEndColumn = Math.min(
      this.columns - 1,
      coreStartColumn + this.physicsChunkColumns - 1,
    );
    const sampleStartColumn = Math.max(0, coreStartColumn - 1);
    const sampleEndColumn = Math.min(this.columns - 1, coreEndColumn + 1);
    const sampleColumns = (sampleEndColumn - sampleStartColumn) + 1;
    if (sampleColumns <= 0) {
      return;
    }

    const sampleSegments = buildMarchingSegments(
      sampleColumns,
      this.rows,
      this.cellSize,
      (column, row) => this.isCellSolid(sampleStartColumn + column, row),
    );
    const sampleOffsetX = sampleStartColumn * this.cellSize;
    const coreMinX = coreStartColumn * this.cellSize;
    const coreMaxX = (coreEndColumn + 1) * this.cellSize;
    const isLastChunk = chunkIndex >= this.physicsChunkCount - 1;
    const nextChunkOverlapGuard = this.cellSize * 0.08;
    const chunkColliders: Collider[] = [];

    for (const segment of sampleSegments) {
      const ax = segment.a.x + sampleOffsetX;
      const ay = segment.a.y;
      const bx = segment.b.x + sampleOffsetX;
      const by = segment.b.y;
      const midX = (ax + bx) * 0.5;
      if (midX < coreMinX - nextChunkOverlapGuard) {
        continue;
      }
      if (!isLastChunk && midX >= coreMaxX - nextChunkOverlapGuard) {
        continue;
      }
      if (isLastChunk && midX > coreMaxX + nextChunkOverlapGuard) {
        continue;
      }

      const dx = bx - ax;
      const dy = by - ay;
      if ((dx * dx) + (dy * dy) < 0.49) {
        continue;
      }

      const desc = this.rapier.api.ColliderDesc
        .segment({ x: ax, y: ay }, { x: bx, y: by })
        .setFriction(0.84)
        .setRestitution(0.005);
      const collider = this.rapier.world.createCollider(desc, this.staticBody);
      chunkColliders.push(collider);
    }

    this.collidersByChunk.set(chunkIndex, chunkColliders);
  }
}
