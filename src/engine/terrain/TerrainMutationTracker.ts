import { clamp } from '../../core/math';

export interface PendingTerrainMutation {
  minColumn: number;
  maxColumn: number;
}

export class TerrainMutationTracker {
  private readonly dirtyChunkIndices = new Set<number>();
  private mutationDepth = 0;
  private hasPendingMutation = false;
  private pendingMutationMinColumn = Number.POSITIVE_INFINITY;
  private pendingMutationMaxColumn = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly columnCount: number,
    private readonly physicsChunkColumns: number,
    private readonly physicsChunkCount: number,
  ) {}

  beginBatch(): void {
    this.mutationDepth += 1;
  }

  endBatch(onCommit: () => void): void {
    if (this.mutationDepth <= 0) {
      return;
    }

    this.mutationDepth -= 1;
    if (this.mutationDepth === 0) {
      onCommit();
    }
  }

  isBatchOpen(): boolean {
    return this.mutationDepth > 0;
  }

  registerColumnRange(minColumn: number, maxColumn: number): void {
    const maxColumnIndex = Math.max(0, this.columnCount - 1);
    const clampedMin = clamp(Math.floor(minColumn), 0, maxColumnIndex);
    const clampedMax = clamp(Math.floor(maxColumn), clampedMin, maxColumnIndex);
    this.pendingMutationMinColumn = Math.min(this.pendingMutationMinColumn, clampedMin);
    this.pendingMutationMaxColumn = Math.max(this.pendingMutationMaxColumn, clampedMax);
    this.hasPendingMutation = true;

    const startChunk = clamp(
      Math.floor(clampedMin / this.physicsChunkColumns) - 1,
      0,
      this.physicsChunkCount - 1,
    );
    const endChunk = clamp(
      Math.floor(clampedMax / this.physicsChunkColumns) + 1,
      startChunk,
      this.physicsChunkCount - 1,
    );
    for (let chunkIndex = startChunk; chunkIndex <= endChunk; chunkIndex += 1) {
      this.dirtyChunkIndices.add(chunkIndex);
    }
  }

  consumePendingMutation(): PendingTerrainMutation | null {
    if (!this.hasPendingMutation) {
      return null;
    }

    const maxColumnIndex = Math.max(0, this.columnCount - 1);
    const minColumn = clamp(this.pendingMutationMinColumn, 0, maxColumnIndex);
    const maxColumn = clamp(this.pendingMutationMaxColumn, minColumn, maxColumnIndex);
    this.hasPendingMutation = false;
    this.pendingMutationMinColumn = Number.POSITIVE_INFINITY;
    this.pendingMutationMaxColumn = Number.NEGATIVE_INFINITY;
    return { minColumn, maxColumn };
  }

  consumeDirtyChunkIndices(): number[] {
    if (this.dirtyChunkIndices.size <= 0) {
      return [];
    }

    const chunkIndices = [...this.dirtyChunkIndices].sort((a, b) => a - b);
    this.dirtyChunkIndices.clear();
    return chunkIndices;
  }
}
