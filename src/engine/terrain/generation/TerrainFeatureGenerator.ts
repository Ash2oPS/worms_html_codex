import { clamp } from '../../../core/math';
import type { SeededRandom } from '../../../core/random';
import type {
  TerrainConfig,
  TerrainFeatureConfig,
  TerrainLayerConfig,
  WorldConfig,
} from '../../../domain/config';

export const TERRAIN_MATERIAL = {
  EMPTY: 0,
  TOPSOIL: 1,
  DIRT: 2,
  ROCK: 3,
  BEDROCK: 4,
} as const;

export type TerrainMaterialId = (typeof TERRAIN_MATERIAL)[keyof typeof TERRAIN_MATERIAL];

export interface TerrainMaterialRun {
  x: number;
  y: number;
  width: number;
  height: number;
  materialId: TerrainMaterialId;
}

export const TERRAIN_MATERIAL_COLORS: Record<TerrainMaterialId, number> = {
  [TERRAIN_MATERIAL.EMPTY]: 0x000000,
  [TERRAIN_MATERIAL.TOPSOIL]: 0x6eac57,
  [TERRAIN_MATERIAL.DIRT]: 0x876240,
  [TERRAIN_MATERIAL.ROCK]: 0x5c5751,
  [TERRAIN_MATERIAL.BEDROCK]: 0x3e3a3d,
};

const DEFAULT_FEATURES: TerrainFeatureConfig = {
  mountainCount: 6,
  mountainHeightMin: 7,
  mountainHeightMax: 24,
  mountainRadiusMin: 6,
  mountainRadiusMax: 26,
  plateauCount: 5,
  plateauWidthMin: 8,
  plateauWidthMax: 30,
  plateauThicknessMin: 2,
  plateauThicknessMax: 6,
  plateauMinYRatio: 0.25,
  plateauMaxYRatio: 0.66,
  caveCount: 14,
  caveRadiusMin: 3,
  caveRadiusMax: 14,
  tunnelCount: 8,
  tunnelRadiusMin: 2,
  tunnelRadiusMax: 5,
  playablePlatformMinCount: 2,
  playablePlatformMaxCount: 3,
  playablePlatformMinWidth: 14,
  playablePlatformMaxWidth: 20,
  playablePlatformMinThickness: 3,
  playablePlatformMaxThickness: 5,
  playablePlatformMinYRatio: 0.28,
  playablePlatformMaxYRatio: 0.64,
  playablePlatformFlatTolerance: 2,
  playablePlatformHeadroom: 5,
};

const DEFAULT_LAYERS: TerrainLayerConfig = {
  topsoilDepth: 1,
  dirtDepth: 7,
  bedrockDepth: 2,
};

interface TerrainAnchor {
  column: number;
  row: number;
}

interface PlayableRun {
  startColumn: number;
  endColumn: number;
  topRow: number;
  width: number;
}

interface PlatformBand {
  startColumn: number;
  endColumn: number;
  centerColumn: number;
  width: number;
}

interface TerrainFeatureContext {
  readonly worldConfig: WorldConfig;
  readonly terrainConfig: TerrainConfig;
  readonly random: SeededRandom;
  readonly cellSize: number;
  readonly columns: number;
  readonly rows: number;
  readonly heights: Float32Array;
  readonly materials: Uint8Array;
  readonly surfaceRows: Int16Array;
  readonly features: TerrainFeatureConfig;
  readonly anchors: TerrainAnchor[];
}

type TerrainFeatureModule = (context: TerrainFeatureContext) => void;

const normalizeRange = (a: number, b: number): { min: number; max: number } => {
  if (a <= b) {
    return { min: a, max: b };
  }

  return { min: b, max: a };
};

const randomIntInclusive = (random: SeededRandom, minValue: number, maxValue: number): number => {
  const normalized = normalizeRange(Math.round(minValue), Math.round(maxValue));
  return random.int(normalized.min, normalized.max + 1);
};

const cellIndex = (column: number, row: number, columns: number): number => (row * columns) + column;

const isSolidMaterial = (materialId: number): boolean => materialId !== TERRAIN_MATERIAL.EMPTY;

const setSolid = (context: TerrainFeatureContext, column: number, row: number): void => {
  if (column < 0 || column >= context.columns || row < 0 || row >= context.rows) {
    return;
  }

  context.materials[cellIndex(column, row, context.columns)] = TERRAIN_MATERIAL.DIRT;
};

const carveEmpty = (context: TerrainFeatureContext, column: number, row: number): void => {
  if (column < 0 || column >= context.columns || row < 0 || row >= context.rows) {
    return;
  }

  context.materials[cellIndex(column, row, context.columns)] = TERRAIN_MATERIAL.EMPTY;
};

const carveEllipse = (
  context: TerrainFeatureContext,
  centerColumn: number,
  centerRow: number,
  radiusX: number,
  radiusY: number,
): void => {
  const minColumn = Math.max(0, Math.floor(centerColumn - radiusX));
  const maxColumn = Math.min(context.columns - 1, Math.ceil(centerColumn + radiusX));
  const minRow = Math.max(0, Math.floor(centerRow - radiusY));
  const maxRow = Math.min(context.rows - 1, Math.ceil(centerRow + radiusY));
  const invRadiusX = 1 / Math.max(0.001, radiusX);
  const invRadiusY = 1 / Math.max(0.001, radiusY);

  for (let row = minRow; row <= maxRow; row += 1) {
    const dy = (row - centerRow) * invRadiusY;
    const dySq = dy * dy;
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const dx = (column - centerColumn) * invRadiusX;
      const value = (dx * dx) + dySq;
      if (value <= 1) {
        carveEmpty(context, column, row);
      }
    }
  }
};

const carveLine = (
  context: TerrainFeatureContext,
  fromColumn: number,
  fromRow: number,
  toColumn: number,
  toRow: number,
  radius: number,
): void => {
  const dx = toColumn - fromColumn;
  const dy = toRow - fromRow;
  const length = Math.sqrt((dx * dx) + (dy * dy));
  const steps = Math.max(2, Math.ceil(length * 1.5));

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const column = fromColumn + (dx * t);
    const row = fromRow + (dy * t);
    carveEllipse(context, column, row, radius, radius * 0.9);
  }
};

const applyMountainLifts: TerrainFeatureModule = (context) => {
  const count = Math.max(0, Math.round(context.features.mountainCount));
  for (let index = 0; index < count; index += 1) {
    const centerColumn = context.random.int(0, context.columns);
    const radius = randomIntInclusive(
      context.random,
      context.features.mountainRadiusMin,
      context.features.mountainRadiusMax,
    );
    const heightInCells = context.random.range(
      context.features.mountainHeightMin,
      context.features.mountainHeightMax,
    );

    for (let column = Math.max(0, centerColumn - radius); column <= Math.min(context.columns - 1, centerColumn + radius); column += 1) {
      const distance = Math.abs(column - centerColumn);
      const falloff = 1 - (distance / Math.max(1, radius));
      if (falloff <= 0) {
        continue;
      }

      const shapedFalloff = Math.pow(falloff, 1.8);
      const lift = heightInCells * shapedFalloff * context.cellSize;
      const currentHeight = context.heights[column] ?? context.worldConfig.height;
      const liftedHeight = currentHeight - lift;
      context.heights[column] = clamp(
        liftedHeight,
        context.cellSize * 3,
        context.terrainConfig.maxGroundY,
      );
    }
  }

  for (let iteration = 0; iteration < 2; iteration += 1) {
    for (let column = 1; column < context.columns - 1; column += 1) {
      const current = context.heights[column] ?? context.worldConfig.height;
      const blended = (
        (context.heights[column - 1] ?? current)
        + current
        + (context.heights[column + 1] ?? current)
      ) / 3;
      context.heights[column] = (current * 0.58) + (blended * 0.42);
    }
  }
};

const fillBaseFromHeightMap: TerrainFeatureModule = (context) => {
  for (let column = 0; column < context.columns; column += 1) {
    const height = context.heights[column] ?? context.worldConfig.height;
    const topRow = clamp(Math.floor(height / context.cellSize), 0, context.rows - 1);
    for (let row = topRow; row < context.rows; row += 1) {
      setSolid(context, column, row);
    }
  }
};

const addFloatingPlateaus: TerrainFeatureModule = (context) => {
  const count = Math.max(0, Math.round(context.features.plateauCount));
  const minRatio = Math.min(context.features.plateauMinYRatio, context.features.plateauMaxYRatio);
  const maxRatio = Math.max(context.features.plateauMinYRatio, context.features.plateauMaxYRatio);
  const minTopRow = clamp(Math.round(context.rows * minRatio), 1, context.rows - 2);
  const maxTopRow = clamp(Math.round(context.rows * maxRatio), minTopRow + 1, context.rows - 2);

  for (let index = 0; index < count; index += 1) {
    const width = randomIntInclusive(
      context.random,
      context.features.plateauWidthMin,
      context.features.plateauWidthMax,
    );
    const thickness = randomIntInclusive(
      context.random,
      context.features.plateauThicknessMin,
      context.features.plateauThicknessMax,
    );
    const maxStart = Math.max(1, context.columns - width);
    const startColumn = context.random.int(0, maxStart);
    const targetTopRow = context.random.int(minTopRow, maxTopRow + 1);

    for (let localColumn = 0; localColumn < width; localColumn += 1) {
      const column = startColumn + localColumn;
      if (column < 0 || column >= context.columns) {
        continue;
      }

      const edgeDistance = Math.min(localColumn, (width - 1) - localColumn);
      const edgeFactor = edgeDistance / Math.max(1, width * 0.5);
      const archOffset = Math.round((1 - edgeFactor) * context.random.range(0, 2.2));
      const jitter = context.random.int(-1, 2);
      const topRow = clamp(targetTopRow + archOffset + jitter, 1, context.rows - 2);
      const localThickness = thickness + (edgeFactor < 0.2 ? 1 : 0);

      for (let row = topRow; row < Math.min(context.rows, topRow + localThickness); row += 1) {
        setSolid(context, column, row);
      }
    }
  }
};

const carveCaves: TerrainFeatureModule = (context) => {
  const count = Math.max(0, Math.round(context.features.caveCount));
  const minRow = clamp(Math.floor(context.rows * 0.42), 2, context.rows - 3);
  const maxRow = clamp(Math.floor(context.rows * 0.9), minRow + 1, context.rows - 2);

  for (let index = 0; index < count; index += 1) {
    const radiusX = randomIntInclusive(
      context.random,
      context.features.caveRadiusMin,
      context.features.caveRadiusMax,
    );
    const radiusY = Math.max(2, Math.round(radiusX * context.random.range(0.48, 0.95)));
    const minColumn = Math.max(radiusX + 1, 1);
    const maxColumn = Math.max(minColumn + 1, context.columns - radiusX - 1);
    const centerColumn = context.random.int(minColumn, maxColumn);
    const centerRow = context.random.int(minRow, maxRow + 1);
    carveEllipse(context, centerColumn, centerRow, radiusX, radiusY);
    context.anchors.push({ column: centerColumn, row: centerRow });
  }
};

const carveTunnels: TerrainFeatureModule = (context) => {
  const count = Math.max(0, Math.round(context.features.tunnelCount));
  if (count === 0) {
    return;
  }

  if (context.anchors.length < 2) {
    const extraAnchors = 6;
    const minRow = clamp(Math.floor(context.rows * 0.44), 2, context.rows - 3);
    const maxRow = clamp(Math.floor(context.rows * 0.86), minRow + 1, context.rows - 2);
    for (let index = 0; index < extraAnchors; index += 1) {
      context.anchors.push({
        column: context.random.int(0, context.columns),
        row: context.random.int(minRow, maxRow + 1),
      });
    }
  }

  for (let index = 0; index < count; index += 1) {
    const start = context.anchors[context.random.int(0, context.anchors.length)] ?? { column: 0, row: 0 };
    const end = context.anchors[context.random.int(0, context.anchors.length)] ?? { column: context.columns - 1, row: context.rows - 1 };
    const radius = randomIntInclusive(
      context.random,
      context.features.tunnelRadiusMin,
      context.features.tunnelRadiusMax,
    );
    const midColumn = clamp(
      Math.round((start.column + end.column) * 0.5 + context.random.range(-12, 12)),
      0,
      context.columns - 1,
    );
    const midRow = clamp(
      Math.round((start.row + end.row) * 0.5 + context.random.range(-8, 8)),
      1,
      context.rows - 2,
    );

    carveLine(context, start.column, start.row, midColumn, midRow, radius);
    carveLine(context, midColumn, midRow, end.column, end.row, Math.max(1.5, radius - 0.7));
  }
};

const cleanupLooseFragments: TerrainFeatureModule = (context) => {
  const visited = new Uint8Array(context.columns * context.rows);
  const minComponentCells = Math.max(
    42,
    Math.round((context.columns * context.rows) * 0.0014),
  );
  const floorAnchorRow = Math.max(0, context.rows - 4);
  const queueColumns = new Int32Array(context.columns * context.rows);
  const queueRows = new Int32Array(context.columns * context.rows);

  const enqueueNeighbors = (column: number, row: number, writeIndex: number): number => {
    let nextWriteIndex = writeIndex;
    const candidates: Array<[number, number]> = [
      [column - 1, row],
      [column + 1, row],
      [column, row - 1],
      [column, row + 1],
    ];
    for (const candidate of candidates) {
      const neighborColumn = candidate[0];
      const neighborRow = candidate[1];
      if (neighborColumn < 0 || neighborColumn >= context.columns || neighborRow < 0 || neighborRow >= context.rows) {
        continue;
      }

      const neighborIndex = cellIndex(neighborColumn, neighborRow, context.columns);
      if (visited[neighborIndex] === 1) {
        continue;
      }

      const materialId = context.materials[neighborIndex] ?? TERRAIN_MATERIAL.EMPTY;
      if (!isSolidMaterial(materialId)) {
        continue;
      }

      visited[neighborIndex] = 1;
      queueColumns[nextWriteIndex] = neighborColumn;
      queueRows[nextWriteIndex] = neighborRow;
      nextWriteIndex += 1;
    }

    return nextWriteIndex;
  };

  for (let row = 0; row < context.rows; row += 1) {
    for (let column = 0; column < context.columns; column += 1) {
      const startIndex = cellIndex(column, row, context.columns);
      if (visited[startIndex] === 1) {
        continue;
      }

      const materialId = context.materials[startIndex] ?? TERRAIN_MATERIAL.EMPTY;
      if (!isSolidMaterial(materialId)) {
        visited[startIndex] = 1;
        continue;
      }

      let readIndex = 0;
      let writeIndex = 1;
      queueColumns[0] = column;
      queueRows[0] = row;
      visited[startIndex] = 1;

      const componentColumns: number[] = [];
      const componentRows: number[] = [];
      let touchesFloorAnchor = false;

      while (readIndex < writeIndex) {
        const currentColumn = queueColumns[readIndex] ?? 0;
        const currentRow = queueRows[readIndex] ?? 0;
        readIndex += 1;

        componentColumns.push(currentColumn);
        componentRows.push(currentRow);
        if (currentRow >= floorAnchorRow) {
          touchesFloorAnchor = true;
        }

        writeIndex = enqueueNeighbors(currentColumn, currentRow, writeIndex);
      }

      if (touchesFloorAnchor || componentColumns.length >= minComponentCells) {
        continue;
      }

      for (let index = 0; index < componentColumns.length; index += 1) {
        const targetColumn = componentColumns[index] ?? 0;
        const targetRow = componentRows[index] ?? 0;
        carveEmpty(context, targetColumn, targetRow);
      }
    }
  }
};

const fillMicroPockets: TerrainFeatureModule = (context) => {
  const fillTargets: Array<[number, number]> = [];

  for (let row = 1; row < context.rows - 1; row += 1) {
    for (let column = 1; column < context.columns - 1; column += 1) {
      const index = cellIndex(column, row, context.columns);
      const current = context.materials[index] ?? TERRAIN_MATERIAL.EMPTY;
      if (isSolidMaterial(current)) {
        continue;
      }

      const leftSolid = isSolidMaterial(context.materials[cellIndex(column - 1, row, context.columns)] ?? TERRAIN_MATERIAL.EMPTY);
      const rightSolid = isSolidMaterial(context.materials[cellIndex(column + 1, row, context.columns)] ?? TERRAIN_MATERIAL.EMPTY);
      const upSolid = isSolidMaterial(context.materials[cellIndex(column, row - 1, context.columns)] ?? TERRAIN_MATERIAL.EMPTY);
      const downSolid = isSolidMaterial(context.materials[cellIndex(column, row + 1, context.columns)] ?? TERRAIN_MATERIAL.EMPTY);
      if (leftSolid && rightSolid && upSolid && downSolid) {
        fillTargets.push([column, row]);
      }
    }
  }

  for (const target of fillTargets) {
    setSolid(context, target[0], target[1]);
  }
};

const hasVerticalHeadroom = (
  context: TerrainFeatureContext,
  column: number,
  topRow: number,
  headroomCells: number,
): boolean => {
  const clearance = Math.max(1, headroomCells);
  for (let offset = 1; offset <= clearance; offset += 1) {
    const row = topRow - offset;
    if (row < 0) {
      break;
    }

    const materialId = context.materials[cellIndex(column, row, context.columns)] ?? TERRAIN_MATERIAL.EMPTY;
    if (isSolidMaterial(materialId)) {
      return false;
    }
  }

  return true;
};

const collectPlayableRuns = (
  context: TerrainFeatureContext,
  minRunWidth: number,
  flatTolerance: number,
  headroomCells: number,
): PlayableRun[] => {
  const minWidth = Math.max(3, minRunWidth);
  const runs: PlayableRun[] = [];
  recomputeSurfaceRows(context.columns, context.rows, context.materials, context.surfaceRows);

  let runStart = -1;
  let runLength = 0;
  let runMinRow = context.rows;
  let runMaxRow = 0;
  let runRowSum = 0;
  let previousTopRow = context.rows;

  const closeRun = (endColumn: number): void => {
    if (runStart < 0 || runLength < minWidth) {
      runStart = -1;
      runLength = 0;
      runMinRow = context.rows;
      runMaxRow = 0;
      runRowSum = 0;
      return;
    }

    if ((runMaxRow - runMinRow) <= Math.max(0, flatTolerance)) {
      runs.push({
        startColumn: runStart,
        endColumn,
        topRow: Math.round(runRowSum / runLength),
        width: runLength,
      });
    }

    runStart = -1;
    runLength = 0;
    runMinRow = context.rows;
    runMaxRow = 0;
    runRowSum = 0;
  };

  for (let column = 0; column < context.columns; column += 1) {
    const topRow = context.surfaceRows[column] ?? context.rows;
    const isSolidTop = topRow >= 1 && topRow < context.rows - 2;
    const hasHeadroom = isSolidTop && hasVerticalHeadroom(context, column, topRow, headroomCells);

    if (!isSolidTop || !hasHeadroom) {
      closeRun(column - 1);
      previousTopRow = context.rows;
      continue;
    }

    if (
      runStart >= 0
      && previousTopRow < context.rows
      && Math.abs(topRow - previousTopRow) > (Math.max(0, flatTolerance) + 1)
    ) {
      closeRun(column - 1);
    }

    if (runStart < 0) {
      runStart = column;
    }

    runLength += 1;
    runMinRow = Math.min(runMinRow, topRow);
    runMaxRow = Math.max(runMaxRow, topRow);
    runRowSum += topRow;
    previousTopRow = topRow;
  }

  closeRun(context.columns - 1);
  return runs;
};

const rangesOverlap = (
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  padding = 0,
): boolean => (
  (aStart - padding) <= (bEnd + padding)
  && (bStart - padding) <= (aEnd + padding)
);

const buildPlatformBand = (
  columns: number,
  desiredCenter: number,
  desiredWidth: number,
): PlatformBand => {
  const width = clamp(Math.round(desiredWidth), 3, Math.max(3, columns - 2));
  const halfWidth = Math.floor(width * 0.5);
  const minCenter = halfWidth + 1;
  const maxCenter = Math.max(minCenter, columns - halfWidth - 2);
  const centerColumn = clamp(Math.round(desiredCenter), minCenter, maxCenter);
  let startColumn = centerColumn - halfWidth;
  let endColumn = startColumn + width - 1;

  if (startColumn < 1) {
    endColumn += 1 - startColumn;
    startColumn = 1;
  }
  if (endColumn > columns - 2) {
    const shift = endColumn - (columns - 2);
    startColumn -= shift;
    endColumn -= shift;
  }

  startColumn = clamp(startColumn, 1, Math.max(1, columns - 3));
  endColumn = clamp(endColumn, startColumn + 2, columns - 2);
  return {
    startColumn,
    endColumn,
    centerColumn: Math.round((startColumn + endColumn) * 0.5),
    width: (endColumn - startColumn) + 1,
  };
};

const averageSurfaceRow = (
  context: TerrainFeatureContext,
  startColumn: number,
  endColumn: number,
): number => {
  let sum = 0;
  let count = 0;
  for (let column = startColumn; column <= endColumn; column += 1) {
    const row = context.surfaceRows[column] ?? context.rows;
    if (row < 0 || row >= context.rows) {
      continue;
    }
    sum += row;
    count += 1;
  }

  if (count <= 0) {
    return context.rows;
  }

  return Math.round(sum / count);
};

const paintPlayablePlatform = (
  context: TerrainFeatureContext,
  startColumn: number,
  endColumn: number,
  topRow: number,
  thickness: number,
  headroomCells: number,
): void => {
  const clampedStart = clamp(startColumn, 1, Math.max(1, context.columns - 3));
  const clampedEnd = clamp(endColumn, clampedStart + 2, context.columns - 2);
  const width = (clampedEnd - clampedStart) + 1;
  const edgeRamp = Math.max(2, Math.floor(width * 0.16));
  const minRow = 2;
  const maxTopRow = context.rows - Math.max(3, thickness + 2);

  for (let column = clampedStart; column <= clampedEnd; column += 1) {
    const distanceToEdge = Math.min(column - clampedStart, clampedEnd - column);
    const edgeLift = distanceToEdge < edgeRamp
      ? Math.round(((edgeRamp - distanceToEdge) / edgeRamp) * 1.3)
      : 0;
    const microJitter = Math.round(Math.sin(column * 0.37) * 0.45);
    const localTopRow = clamp(topRow + edgeLift + microJitter, minRow, maxTopRow);
    const localThickness = Math.max(
      2,
      thickness + (distanceToEdge < Math.max(2, edgeRamp - 1) ? 1 : 0),
    );

    for (let row = 0; row < localTopRow; row += 1) {
      carveEmpty(context, column, row);
    }
    const clearanceStart = Math.max(0, localTopRow - Math.max(3, headroomCells + 1));
    for (let row = clearanceStart; row < localTopRow; row += 1) {
      carveEmpty(context, column, row);
    }

    for (let row = localTopRow; row < Math.min(context.rows, localTopRow + localThickness); row += 1) {
      setSolid(context, column, row);
    }
  }
};

const ensurePlayablePlatforms: TerrainFeatureModule = (context) => {
  const minCount = clamp(Math.round(context.features.playablePlatformMinCount), 1, 6);
  const maxCount = clamp(Math.round(context.features.playablePlatformMaxCount), minCount, 6);
  const desiredCount = context.random.int(minCount, maxCount + 1);
  const minWidth = clamp(
    Math.round(context.features.playablePlatformMinWidth),
    8,
    context.columns,
  );
  const maxWidth = clamp(
    Math.round(context.features.playablePlatformMaxWidth),
    minWidth,
    context.columns,
  );
  const minThickness = clamp(Math.round(context.features.playablePlatformMinThickness), 2, 8);
  const maxThickness = clamp(Math.round(context.features.playablePlatformMaxThickness), minThickness, 10);
  const flatTolerance = clamp(Math.round(context.features.playablePlatformFlatTolerance), 0, 6);
  const headroomCells = clamp(Math.round(context.features.playablePlatformHeadroom), 2, 12);
  const minYRatio = Math.min(
    context.features.playablePlatformMinYRatio,
    context.features.playablePlatformMaxYRatio,
  );
  const maxYRatio = Math.max(
    context.features.playablePlatformMinYRatio,
    context.features.playablePlatformMaxYRatio,
  );
  const minTopRow = clamp(Math.round(context.rows * minYRatio), 1, context.rows - 6);
  const maxTopRow = clamp(Math.round(context.rows * maxYRatio), minTopRow + 1, context.rows - 5);

  let playableRuns = collectPlayableRuns(context, minWidth, flatTolerance, headroomCells);
  if (playableRuns.length >= desiredCount) {
    return;
  }

  const spawnBands = [0.13, 0.28, 0.46, 0.64, 0.8];
  const levelBands = [0.34, 0.45, 0.56];
  const platformBands: PlatformBand[] = [];

  for (let attempt = 0; attempt < 56 && playableRuns.length < desiredCount; attempt += 1) {
    const width = randomIntInclusive(context.random, minWidth, maxWidth);
    const bandRatio = spawnBands[attempt % spawnBands.length] ?? 0.5;
    const centerNoise = context.random.int(-12, 13);
    const desiredCenter = Math.round((context.columns * bandRatio) + centerNoise);
    const band = buildPlatformBand(context.columns, desiredCenter, width);
    const overlapPadding = Math.max(4, Math.round(minWidth * 0.45));
    const intersects = platformBands.some((existing) => rangesOverlap(
      existing.startColumn,
      existing.endColumn,
      band.startColumn,
      band.endColumn,
      overlapPadding,
    ));
    if (intersects) {
      continue;
    }

    const localSurfaceRow = averageSurfaceRow(context, band.startColumn, band.endColumn);
    let targetTopRow = randomIntInclusive(context.random, minTopRow, maxTopRow);
    if (localSurfaceRow < context.rows - 4) {
      const lift = randomIntInclusive(context.random, 8, 19);
      targetTopRow = Math.min(targetTopRow, localSurfaceRow - lift);
    }
    const layerRatio = levelBands[attempt % levelBands.length] ?? 0.46;
    const snappedRow = Math.round(minTopRow + ((maxTopRow - minTopRow) * layerRatio));
    targetTopRow = clamp(
      Math.round((targetTopRow * 0.56) + (snappedRow * 0.44)),
      minTopRow,
      maxTopRow,
    );
    const thickness = randomIntInclusive(context.random, minThickness, maxThickness);
    paintPlayablePlatform(
      context,
      band.startColumn,
      band.endColumn,
      targetTopRow,
      thickness,
      headroomCells,
    );
    platformBands.push(band);
    recomputeSurfaceRows(context.columns, context.rows, context.materials, context.surfaceRows);
    playableRuns = collectPlayableRuns(context, minWidth, flatTolerance, headroomCells);
  }

  if (playableRuns.length >= minCount) {
    return;
  }

  const fallbackCenters = [0.24, 0.5, 0.76];
  for (let index = 0; index < fallbackCenters.length && playableRuns.length < minCount; index += 1) {
    const band = buildPlatformBand(
      context.columns,
      Math.round(context.columns * fallbackCenters[index]),
      Math.round((minWidth + maxWidth) * 0.5),
    );
    const overlapPadding = Math.max(2, Math.round(minWidth * 0.2));
    const intersects = platformBands.some((existing) => rangesOverlap(
      existing.startColumn,
      existing.endColumn,
      band.startColumn,
      band.endColumn,
      overlapPadding,
    ));
    if (intersects) {
      continue;
    }

    const stepRatio = (index + 1) / (fallbackCenters.length + 1);
    const targetTopRow = clamp(
      Math.round(minTopRow + ((maxTopRow - minTopRow) * stepRatio)),
      minTopRow,
      maxTopRow,
    );
    paintPlayablePlatform(
      context,
      band.startColumn,
      band.endColumn,
      targetTopRow,
      Math.round((minThickness + maxThickness) * 0.5),
      headroomCells,
    );
    platformBands.push(band);
    recomputeSurfaceRows(context.columns, context.rows, context.materials, context.surfaceRows);
    playableRuns = collectPlayableRuns(context, minWidth, flatTolerance, headroomCells);
  }
};

const recomputeSurfaceRowsRange = (
  columns: number,
  rows: number,
  materials: Uint8Array,
  surfaceRows: Int16Array,
  minColumn: number,
  maxColumn: number,
): void => {
  const startColumn = clamp(Math.floor(minColumn), 0, Math.max(0, columns - 1));
  const endColumn = clamp(Math.floor(maxColumn), startColumn, Math.max(0, columns - 1));
  for (let column = startColumn; column <= endColumn; column += 1) {
    let row = 0;
    for (; row < rows; row += 1) {
      if (isSolidMaterial(materials[cellIndex(column, row, columns)] ?? 0)) {
        break;
      }
    }
    surfaceRows[column] = row;
  }
};

const recomputeSurfaceRows = (
  columns: number,
  rows: number,
  materials: Uint8Array,
  surfaceRows: Int16Array,
): void => {
  recomputeSurfaceRowsRange(columns, rows, materials, surfaceRows, 0, columns - 1);
};

const applyMaterialLayersRange = (
  columns: number,
  rows: number,
  materials: Uint8Array,
  surfaceRows: Int16Array,
  layers: TerrainLayerConfig,
  minColumn: number,
  maxColumn: number,
): void => {
  const startColumn = clamp(Math.floor(minColumn), 0, Math.max(0, columns - 1));
  const endColumn = clamp(Math.floor(maxColumn), startColumn, Math.max(0, columns - 1));
  const topsoilDepth = Math.max(0, Math.round(layers.topsoilDepth));
  const dirtDepth = Math.max(1, Math.round(layers.dirtDepth));
  const bedrockDepth = Math.max(1, Math.round(layers.bedrockDepth));
  const bedrockStartRow = Math.max(0, rows - bedrockDepth);

  for (let row = 0; row < rows; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const index = cellIndex(column, row, columns);
      const materialId = materials[index] ?? TERRAIN_MATERIAL.EMPTY;
      if (!isSolidMaterial(materialId)) {
        continue;
      }

      if (row >= bedrockStartRow) {
        materials[index] = TERRAIN_MATERIAL.BEDROCK;
        continue;
      }

      const surfaceRow = surfaceRows[column] ?? rows;
      const depthFromSurface = Math.max(0, row - surfaceRow);
      const dirtNoise = Math.round(
        (Math.sin((column * 0.27) + (row * 0.13)) * 1.4)
        + (Math.sin(row * 0.09) * 0.8),
      );
      const dirtLimit = topsoilDepth + Math.max(1, dirtDepth + dirtNoise);

      if (depthFromSurface <= topsoilDepth) {
        materials[index] = TERRAIN_MATERIAL.TOPSOIL;
      } else if (depthFromSurface <= dirtLimit) {
        materials[index] = TERRAIN_MATERIAL.DIRT;
      } else {
        materials[index] = TERRAIN_MATERIAL.ROCK;
      }
    }
  }
};

const applyMaterialLayers = (
  columns: number,
  rows: number,
  materials: Uint8Array,
  surfaceRows: Int16Array,
  layers: TerrainLayerConfig,
): void => {
  applyMaterialLayersRange(columns, rows, materials, surfaceRows, layers, 0, columns - 1);
};

export class TerrainFeatureGenerator {
  private readonly features: TerrainFeatureConfig;
  private readonly layers: TerrainLayerConfig;
  private readonly modules: TerrainFeatureModule[] = [
    applyMountainLifts,
    fillBaseFromHeightMap,
    addFloatingPlateaus,
    carveCaves,
    carveTunnels,
    cleanupLooseFragments,
    fillMicroPockets,
    ensurePlayablePlatforms,
  ];

  constructor(terrainConfig: TerrainConfig) {
    this.features = {
      ...DEFAULT_FEATURES,
      ...(terrainConfig.generation?.features ?? {}),
    };
    this.layers = {
      ...DEFAULT_LAYERS,
      ...(terrainConfig.generation?.layers ?? {}),
    };
  }

  generate(
    worldConfig: WorldConfig,
    terrainConfig: TerrainConfig,
    random: SeededRandom,
    cellSize: number,
    columns: number,
    rows: number,
    heights: Float32Array,
    materials: Uint8Array,
    surfaceRows: Int16Array,
  ): void {
    materials.fill(TERRAIN_MATERIAL.EMPTY);
    const context: TerrainFeatureContext = {
      worldConfig,
      terrainConfig,
      random,
      cellSize,
      columns,
      rows,
      heights,
      materials,
      surfaceRows,
      features: this.features,
      anchors: [],
    };

    for (const module of this.modules) {
      module(context);
    }

    this.refreshSurfaceAndLayers(columns, rows, materials, surfaceRows);
  }

  refreshSurfaceAndLayers(
    columns: number,
    rows: number,
    materials: Uint8Array,
    surfaceRows: Int16Array,
  ): void {
    this.ensureBedrockFloor(columns, rows, materials);
    recomputeSurfaceRows(columns, rows, materials, surfaceRows);
    applyMaterialLayers(columns, rows, materials, surfaceRows, this.layers);
  }

  refreshSurfaceAndLayersInColumnRange(
    columns: number,
    rows: number,
    materials: Uint8Array,
    surfaceRows: Int16Array,
    minColumn: number,
    maxColumn: number,
  ): void {
    this.ensureBedrockFloorInColumnRange(columns, rows, materials, minColumn, maxColumn);
    recomputeSurfaceRowsRange(columns, rows, materials, surfaceRows, minColumn, maxColumn);
    applyMaterialLayersRange(columns, rows, materials, surfaceRows, this.layers, minColumn, maxColumn);
  }

  private ensureBedrockFloor(columns: number, rows: number, materials: Uint8Array): void {
    const bedrockDepth = Math.max(1, Math.round(this.layers.bedrockDepth));
    const minRow = Math.max(0, rows - bedrockDepth);
    for (let row = minRow; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        materials[cellIndex(column, row, columns)] = TERRAIN_MATERIAL.DIRT;
      }
    }
  }

  private ensureBedrockFloorInColumnRange(
    columns: number,
    rows: number,
    materials: Uint8Array,
    minColumn: number,
    maxColumn: number,
  ): void {
    const startColumn = clamp(Math.floor(minColumn), 0, Math.max(0, columns - 1));
    const endColumn = clamp(Math.floor(maxColumn), startColumn, Math.max(0, columns - 1));
    const bedrockDepth = Math.max(1, Math.round(this.layers.bedrockDepth));
    const minRow = Math.max(0, rows - bedrockDepth);
    for (let row = minRow; row < rows; row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) {
        materials[cellIndex(column, row, columns)] = TERRAIN_MATERIAL.DIRT;
      }
    }
  }
}
