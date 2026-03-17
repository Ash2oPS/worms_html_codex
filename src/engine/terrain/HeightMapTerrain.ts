import type { Collider, RigidBody } from '@dimforge/rapier2d-compat';
import type { TerrainConfig, WorldConfig } from '../../domain/config';
import type { Vec2 } from '../../domain/state';
import { clamp } from '../../core/math';
import { SeededRandom } from '../../core/random';
import { RapierContext } from '../physics/RapierContext';
import type { TerrainGenerator } from './generation/TerrainGenerator';
import { createTerrainGenerator } from './generation/createTerrainGenerator';
import {
  TERRAIN_MATERIAL,
  TERRAIN_MATERIAL_COLORS,
  TerrainFeatureGenerator,
  type TerrainMaterialId,
  type TerrainMaterialRun,
} from './generation/TerrainFeatureGenerator';
import {
  buildMarchingSegments,
  buildMarchingLoops,
  simplifyClosedLoop,
  smoothClosedLoop,
  type MarchingLoop,
  type MarchingSegment,
} from './marchingSquares';

const PHYSICS_CHUNK_WIDTH_PX = 192;

export class HeightMapTerrain {
  private readonly columns: number;
  private readonly rows: number;
  private readonly cellSize: number;
  private readonly heights: Float32Array;
  private readonly materials: Uint8Array;
  private readonly surfaceRows: Int16Array;
  private readonly staticBody: RigidBody;
  private readonly heightGenerator: TerrainGenerator;
  private readonly featureGenerator: TerrainFeatureGenerator;
  private readonly physicsChunkColumns: number;
  private readonly physicsChunkCount: number;
  private readonly collidersByChunk = new Map<number, Collider[]>();
  private readonly dirtyPhysicsChunks = new Set<number>();
  private terrainMutationDepth = 0;
  private hasPendingTerrainMutation = false;
  private pendingMutationMinColumn = Number.POSITIVE_INFINITY;
  private pendingMutationMaxColumn = Number.NEGATIVE_INFINITY;
  private version = 0;
  private cachedRenderRunsVersion = -1;
  private cachedRenderRuns: TerrainMaterialRun[] = [];
  private cachedMarchingVersion = -1;
  private cachedMarchingSegments: MarchingSegment[] = [];
  private cachedLoopVersion = -1;
  private cachedMarchingLoops: MarchingLoop[] = [];
  private cachedPhysicsVersion = -1;
  private cachedPhysicsSegments: MarchingSegment[] = [];
  private readonly cachedMaterialMarchingSegments = new Map<TerrainMaterialId, MarchingSegment[]>();
  private readonly cachedMaterialMarchingLoops = new Map<string, MarchingLoop[]>();

  constructor(
    private readonly worldConfig: WorldConfig,
    private readonly terrainConfig: TerrainConfig,
    private readonly rapier: RapierContext,
  ) {
    this.cellSize = terrainConfig.columnWidth;
    this.columns = Math.ceil(worldConfig.width / this.cellSize);
    this.rows = Math.ceil(worldConfig.height / this.cellSize);
    this.physicsChunkColumns = Math.max(12, Math.round(PHYSICS_CHUNK_WIDTH_PX / this.cellSize));
    this.physicsChunkCount = Math.max(1, Math.ceil(this.columns / this.physicsChunkColumns));
    this.heights = new Float32Array(this.columns);
    this.materials = new Uint8Array(this.columns * this.rows);
    this.surfaceRows = new Int16Array(this.columns);
    this.surfaceRows.fill(this.rows);
    this.heightGenerator = createTerrainGenerator(terrainConfig);
    this.featureGenerator = new TerrainFeatureGenerator(terrainConfig);
    const bodyDesc = this.rapier.api.RigidBodyDesc.fixed();
    this.staticBody = this.rapier.world.createRigidBody(bodyDesc);
    this.generate();
  }

  generate(): void {
    const random = new SeededRandom(this.terrainConfig.seed);
    const generatedHeights = this.heightGenerator.generate({
      worldConfig: this.worldConfig,
      terrainConfig: this.terrainConfig,
      columns: this.columns,
      random,
    });
    this.heights.set(generatedHeights);

    this.featureGenerator.generate(
      this.worldConfig,
      this.terrainConfig,
      random,
      this.cellSize,
      this.columns,
      this.rows,
      this.heights,
      this.materials,
      this.surfaceRows,
    );
    this.syncHeightsFromSurfaceRows();
    this.invalidateDerivedCaches();
    this.rebuildColliders();
    this.bumpVersion();
  }

  beginMutationBatch(): void {
    this.terrainMutationDepth += 1;
  }

  endMutationBatch(): void {
    if (this.terrainMutationDepth <= 0) {
      return;
    }

    this.terrainMutationDepth -= 1;
    if (this.terrainMutationDepth === 0) {
      this.commitTerrainMutations();
    }
  }

  getGroundY(x: number): number {
    const clampedX = clamp(x, 0, this.worldConfig.width - 1);
    const exactColumn = clampedX / this.cellSize;
    const leftColumn = Math.floor(exactColumn);
    const rightColumn = Math.min(this.columns - 1, leftColumn + 1);
    const blend = exactColumn - leftColumn;
    const leftY = this.heights[leftColumn] ?? this.worldConfig.height;
    const rightY = this.heights[rightColumn] ?? this.worldConfig.height;
    return leftY + ((rightY - leftY) * blend);
  }

  getGroundYBelow(x: number, fromY: number): number {
    if (x < 0 || x >= this.worldConfig.width) {
      return this.worldConfig.height;
    }

    const column = clamp(Math.floor(x / this.cellSize), 0, this.columns - 1);
    const startRow = clamp(Math.floor(fromY / this.cellSize), 0, this.rows - 1);
    for (let row = startRow; row < this.rows; row += 1) {
      if (this.isCellSolid(column, row)) {
        return row * this.cellSize;
      }
    }

    return this.worldConfig.height;
  }

  getWorldWidth(): number {
    return this.worldConfig.width;
  }

  getWorldHeight(): number {
    return this.worldConfig.height;
  }

  getVersion(): number {
    return this.version;
  }

  getMaterialColor(materialId: TerrainMaterialId): number {
    return TERRAIN_MATERIAL_COLORS[materialId] ?? 0xffffff;
  }

  getMaterialRuns(): TerrainMaterialRun[] {
    if (this.cachedRenderRunsVersion === this.version) {
      return this.cachedRenderRuns;
    }

    const runs: TerrainMaterialRun[] = [];
    for (let row = 0; row < this.rows; row += 1) {
      let currentMaterial: TerrainMaterialId = TERRAIN_MATERIAL.EMPTY;
      let runStartColumn = 0;

      for (let column = 0; column <= this.columns; column += 1) {
        const material = column < this.columns
          ? this.getCellMaterial(column, row)
          : TERRAIN_MATERIAL.EMPTY;

        if (material === currentMaterial) {
          continue;
        }

        if (currentMaterial !== TERRAIN_MATERIAL.EMPTY) {
          runs.push({
            x: runStartColumn * this.cellSize,
            y: row * this.cellSize,
            width: (column - runStartColumn) * this.cellSize,
            height: this.cellSize,
            materialId: currentMaterial,
          });
        }

        currentMaterial = material;
        runStartColumn = column;
      }
    }

    this.cachedRenderRuns = runs;
    this.cachedRenderRunsVersion = this.version;
    return runs;
  }

  getMarchingSegments(): MarchingSegment[] {
    if (this.cachedMarchingVersion === this.version) {
      return this.cachedMarchingSegments;
    }

    this.cachedMarchingSegments = buildMarchingSegments(
      this.columns,
      this.rows,
      this.cellSize,
      (column, row) => this.isCellSolid(column, row),
    );
    this.cachedMarchingVersion = this.version;
    return this.cachedMarchingSegments;
  }

  getMarchingLoops(smoothIterations = 1): MarchingLoop[] {
    const cacheVersionKey = this.version * 10 + Math.max(0, Math.min(4, smoothIterations));
    if (this.cachedLoopVersion === cacheVersionKey) {
      return this.cachedMarchingLoops;
    }

    const rawLoops = buildMarchingLoops(this.getMarchingSegments(), this.cellSize * this.cellSize * 0.5);
    this.cachedMarchingLoops = rawLoops.map((loop) => ({
      points: smoothIterations > 0
        ? smoothClosedLoop(loop.points, smoothIterations)
        : loop.points,
      area: loop.area,
    }));
    this.cachedLoopVersion = cacheVersionKey;
    return this.cachedMarchingLoops;
  }

  getMaterialMarchingSegments(materialId: TerrainMaterialId): MarchingSegment[] {
    const cached = this.cachedMaterialMarchingSegments.get(materialId);
    if (cached) {
      return cached;
    }

    const segments = buildMarchingSegments(
      this.columns,
      this.rows,
      this.cellSize,
      (column, row) => this.getCellMaterial(column, row) === materialId,
    );
    this.cachedMaterialMarchingSegments.set(materialId, segments);
    return segments;
  }

  getMaterialMarchingLoops(materialId: TerrainMaterialId, smoothIterations = 1): MarchingLoop[] {
    const clampedSmoothIterations = Math.max(0, Math.min(4, Math.round(smoothIterations)));
    const cacheKey = `${materialId}:${clampedSmoothIterations}`;
    const cached = this.cachedMaterialMarchingLoops.get(cacheKey);
    if (cached) {
      return cached;
    }

    const cellArea = this.cellSize * this.cellSize;
    const minLoopArea = materialId === TERRAIN_MATERIAL.TOPSOIL
      ? cellArea * 0.12
      : materialId === TERRAIN_MATERIAL.DIRT
        ? cellArea * 0.65
        : cellArea * 1.05;
    const rawLoops = buildMarchingLoops(
      this.getMaterialMarchingSegments(materialId),
      minLoopArea,
    );
    const loops = rawLoops.map((loop) => ({
      points: clampedSmoothIterations > 0
        ? smoothClosedLoop(loop.points, clampedSmoothIterations)
        : loop.points,
      area: loop.area,
    }));
    this.cachedMaterialMarchingLoops.set(cacheKey, loops);
    return loops;
  }

  getPhysicsSegments(): MarchingSegment[] {
    if (this.cachedPhysicsVersion === this.version) {
      return this.cachedPhysicsSegments;
    }

    const minLoopArea = this.cellSize * this.cellSize * 1.2;
    const loops = buildMarchingLoops(this.getMarchingSegments(), minLoopArea);
    const segments: MarchingSegment[] = [];

    for (const loop of loops) {
      const smoothed = smoothClosedLoop(loop.points, 1);
      const simplified = simplifyClosedLoop(
        smoothed,
        this.cellSize * 0.4,
        0.035,
        3,
      );

      if (simplified.length < 3) {
        continue;
      }

      for (let index = 0; index < simplified.length; index += 1) {
        const a = simplified[index];
        const b = simplified[(index + 1) % simplified.length];
        if (!a || !b) {
          continue;
        }

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if ((dx * dx) + (dy * dy) < 1.2) {
          continue;
        }

        segments.push({ a, b });
      }
    }

    this.cachedPhysicsSegments = segments.length > 0
      ? segments
      : this.getMarchingSegments();
    this.cachedPhysicsVersion = this.version;
    return this.cachedPhysicsSegments;
  }

  getSurfacePolylinePoints(): number[] {
    const points: number[] = [0, this.getGroundY(0)];
    for (let column = 0; column < this.columns; column += 1) {
      const x = (column * this.cellSize) + (this.cellSize * 0.5);
      points.push(x, this.heights[column] ?? this.worldConfig.height);
    }
    points.push(this.worldConfig.width, this.getGroundY(this.worldConfig.width - 1));
    return points;
  }

  getPlayablePlatformCount(
    minWidthColumns = Math.max(
      3,
      Math.round(this.terrainConfig.generation?.features?.playablePlatformMinWidth ?? (84 / this.cellSize)),
    ),
    flatTolerance = Math.round(this.terrainConfig.generation?.features?.playablePlatformFlatTolerance ?? 2),
    headroomCells = Math.round(this.terrainConfig.generation?.features?.playablePlatformHeadroom ?? 5),
  ): number {
    const minWidth = Math.max(3, minWidthColumns);
    const tolerance = Math.max(0, Math.round(flatTolerance));
    const clearance = Math.max(1, Math.round(headroomCells));
    let runStart = -1;
    let runLength = 0;
    let runMinRow = this.rows;
    let runMaxRow = 0;
    let previousTopRow = this.rows;
    let count = 0;

    const hasHeadroom = (column: number, topRow: number): boolean => {
      for (let offset = 1; offset <= clearance; offset += 1) {
        const row = topRow - offset;
        if (row < 0) {
          break;
        }
        if (this.isCellSolid(column, row)) {
          return false;
        }
      }
      return true;
    };

    const closeRun = (): void => {
      if (runStart >= 0 && runLength >= minWidth && (runMaxRow - runMinRow) <= tolerance) {
        count += 1;
      }
      runStart = -1;
      runLength = 0;
      runMinRow = this.rows;
      runMaxRow = 0;
    };

    for (let column = 0; column < this.columns; column += 1) {
      const topRow = this.surfaceRows[column] ?? this.rows;
      const validTop = topRow >= 1 && topRow < this.rows - 2 && hasHeadroom(column, topRow);
      if (!validTop) {
        closeRun();
        previousTopRow = this.rows;
        continue;
      }

      if (
        runStart >= 0
        && previousTopRow < this.rows
        && Math.abs(topRow - previousTopRow) > (tolerance + 1)
      ) {
        closeRun();
      }

      if (runStart < 0) {
        runStart = column;
      }
      runLength += 1;
      runMinRow = Math.min(runMinRow, topRow);
      runMaxRow = Math.max(runMaxRow, topRow);
      previousTopRow = topRow;
    }

    closeRun();
    return count;
  }

  isSolid(x: number, y: number): boolean {
    if (x < 0 || x >= this.worldConfig.width) {
      return false;
    }

    if (y >= this.worldConfig.height) {
      return true;
    }

    if (y < 0) {
      return false;
    }

    const column = clamp(Math.floor(x / this.cellSize), 0, this.columns - 1);
    const row = Math.floor(y / this.cellSize);
    if (row < 0) {
      return false;
    }

    if (row >= this.rows) {
      return true;
    }

    return this.isCellSolid(column, row);
  }

  getMaterialAtWorld(x: number, y: number): TerrainMaterialId {
    if (x < 0 || x >= this.worldConfig.width || y < 0 || y >= this.worldConfig.height) {
      return TERRAIN_MATERIAL.EMPTY;
    }

    const column = clamp(Math.floor(x / this.cellSize), 0, this.columns - 1);
    const row = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    return this.getCellMaterial(column, row);
  }

  carveCircle(center: Vec2, radius: number): void {
    const minColumn = Math.max(0, Math.floor((center.x - radius) / this.cellSize));
    const maxColumn = Math.min(this.columns - 1, Math.ceil((center.x + radius) / this.cellSize));
    const minRow = Math.max(0, Math.floor((center.y - radius) / this.cellSize));
    const maxRow = Math.min(this.rows - 1, Math.ceil((center.y + radius) / this.cellSize));
    const radiusSquared = radius * radius;
    let changedMinColumn = this.columns;
    let changedMaxColumn = -1;

    for (let row = minRow; row <= maxRow; row += 1) {
      const cellCenterY = (row * this.cellSize) + (this.cellSize * 0.5);
      const dy = cellCenterY - center.y;
      const dySq = dy * dy;
      for (let column = minColumn; column <= maxColumn; column += 1) {
        if (!this.isCellSolid(column, row)) {
          continue;
        }

        const cellCenterX = (column * this.cellSize) + (this.cellSize * 0.5);
        const dx = cellCenterX - center.x;
        if ((dx * dx) + dySq > radiusSquared) {
          continue;
        }

        this.materials[this.cellIndex(column, row)] = TERRAIN_MATERIAL.EMPTY;
        changedMinColumn = Math.min(changedMinColumn, column);
        changedMaxColumn = Math.max(changedMaxColumn, column);
      }
    }

    if (changedMaxColumn < changedMinColumn) {
      return;
    }

    this.registerTerrainMutation(changedMinColumn, changedMaxColumn);
    if (this.terrainMutationDepth === 0) {
      this.commitTerrainMutations();
    }
  }

  segmentHitsTerrain(start: Vec2, end: Vec2): boolean {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt((dx * dx) + (dy * dy));
    const steps = Math.max(2, Math.ceil(length / 3));

    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = start.x + (dx * t);
      const y = start.y + (dy * t);
      if (this.isSolid(x, y)) {
        return true;
      }
    }

    return false;
  }

  findSpawnPoint(minX: number, maxX: number, wormRadius: number, seedOffset: number): Vec2 {
    const random = new SeededRandom(this.terrainConfig.seed + seedOffset);
    const clampedMinX = clamp(minX, 0, this.worldConfig.width - 1);
    const clampedMaxX = clamp(maxX, clampedMinX + 1, this.worldConfig.width - 1);

    for (let attempt = 0; attempt < 90; attempt += 1) {
      const x = random.range(clampedMinX, clampedMaxX);
      const slope = Math.abs(this.getGroundY(x - 12) - this.getGroundY(x + 12));
      if (slope > wormRadius * 1.8) {
        continue;
      }

      const y = this.getGroundY(x) - wormRadius - 1;
      if (this.hasSpawnClearance(x, y, wormRadius)) {
        return { x, y };
      }
    }

    const fallbackX = (clampedMinX + clampedMaxX) * 0.5;
    return {
      x: fallbackX,
      y: this.getGroundY(fallbackX) - wormRadius - 1,
    };
  }

  getRenderPolygonPoints(): number[] {
    const points: number[] = [0, this.worldConfig.height];
    points.push(...this.getSurfacePolylinePoints());
    points.push(this.worldConfig.width, this.worldConfig.height);
    return points;
  }

  private hasSpawnClearance(x: number, y: number, radius: number): boolean {
    if (y < radius) {
      return false;
    }

    const sampleStep = Math.max(4, radius * 0.38);
    for (let dy = -radius * 1.15; dy <= radius * 0.25; dy += sampleStep) {
      for (let dx = -radius * 0.85; dx <= radius * 0.85; dx += sampleStep) {
        if (this.isSolid(x + dx, y + dy)) {
          return false;
        }
      }
    }

    return true;
  }

  private syncHeightsFromSurfaceRows(): void {
    this.syncHeightsFromSurfaceRowsInRange(0, this.columns - 1);
  }

  private syncHeightsFromSurfaceRowsInRange(minColumn: number, maxColumn: number): void {
    const startColumn = clamp(Math.floor(minColumn), 0, Math.max(0, this.columns - 1));
    const endColumn = clamp(Math.floor(maxColumn), startColumn, Math.max(0, this.columns - 1));
    for (let column = startColumn; column <= endColumn; column += 1) {
      const row = this.surfaceRows[column] ?? this.rows;
      const y = row >= this.rows
        ? this.worldConfig.height
        : row * this.cellSize;
      this.heights[column] = clamp(y, 0, this.worldConfig.height);
    }
  }

  private rebuildColliders(): void {
    for (let chunkIndex = 0; chunkIndex < this.physicsChunkCount; chunkIndex += 1) {
      this.dirtyPhysicsChunks.add(chunkIndex);
    }
    this.rebuildDirtyChunkColliders();
  }

  private registerTerrainMutation(minColumn: number, maxColumn: number): void {
    const clampedMin = clamp(Math.floor(minColumn), 0, Math.max(0, this.columns - 1));
    const clampedMax = clamp(Math.floor(maxColumn), clampedMin, Math.max(0, this.columns - 1));
    this.pendingMutationMinColumn = Math.min(this.pendingMutationMinColumn, clampedMin);
    this.pendingMutationMaxColumn = Math.max(this.pendingMutationMaxColumn, clampedMax);
    this.hasPendingTerrainMutation = true;

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
      this.dirtyPhysicsChunks.add(chunkIndex);
    }
  }

  private commitTerrainMutations(): void {
    if (!this.hasPendingTerrainMutation) {
      return;
    }

    const minColumn = clamp(
      this.pendingMutationMinColumn,
      0,
      Math.max(0, this.columns - 1),
    );
    const maxColumn = clamp(
      this.pendingMutationMaxColumn,
      minColumn,
      Math.max(0, this.columns - 1),
    );
    const layerPadding = 2;
    const updateMinColumn = Math.max(0, minColumn - layerPadding);
    const updateMaxColumn = Math.min(this.columns - 1, maxColumn + layerPadding);
    this.featureGenerator.refreshSurfaceAndLayersInColumnRange(
      this.columns,
      this.rows,
      this.materials,
      this.surfaceRows,
      updateMinColumn,
      updateMaxColumn,
    );
    this.syncHeightsFromSurfaceRowsInRange(updateMinColumn, updateMaxColumn);
    this.invalidateDerivedCaches();
    this.rebuildDirtyChunkColliders();
    this.bumpVersion();

    this.hasPendingTerrainMutation = false;
    this.pendingMutationMinColumn = Number.POSITIVE_INFINITY;
    this.pendingMutationMaxColumn = Number.NEGATIVE_INFINITY;
  }

  private rebuildDirtyChunkColliders(): void {
    if (this.dirtyPhysicsChunks.size <= 0) {
      return;
    }

    const chunkIndices = [...this.dirtyPhysicsChunks].sort((a, b) => a - b);
    for (const chunkIndex of chunkIndices) {
      this.rebuildChunkColliders(chunkIndex);
    }
    this.dirtyPhysicsChunks.clear();
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

  private cellIndex(column: number, row: number): number {
    return (row * this.columns) + column;
  }

  private getCellMaterial(column: number, row: number): TerrainMaterialId {
    if (column < 0 || column >= this.columns || row < 0 || row >= this.rows) {
      return TERRAIN_MATERIAL.EMPTY;
    }

    return (this.materials[this.cellIndex(column, row)] ?? TERRAIN_MATERIAL.EMPTY) as TerrainMaterialId;
  }

  private isCellSolid(column: number, row: number): boolean {
    return this.getCellMaterial(column, row) !== TERRAIN_MATERIAL.EMPTY;
  }

  private bumpVersion(): void {
    this.version += 1;
    this.invalidateDerivedCaches();
  }

  private invalidateDerivedCaches(): void {
    this.cachedRenderRunsVersion = -1;
    this.cachedMarchingVersion = -1;
    this.cachedLoopVersion = -1;
    this.cachedPhysicsVersion = -1;
    this.cachedMaterialMarchingSegments.clear();
    this.cachedMaterialMarchingLoops.clear();
  }
}
