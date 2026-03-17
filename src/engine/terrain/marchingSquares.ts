export interface MarchingPoint {
  x: number;
  y: number;
}

export interface MarchingSegment {
  a: MarchingPoint;
  b: MarchingPoint;
}

export interface MarchingLoop {
  points: MarchingPoint[];
  area: number;
}

interface GridPoint {
  x: number;
  y: number;
}

const POINT_KEY_FACTOR = 1000;
const pointKey = (x: number, y: number): string => (
  `${Math.round(x * POINT_KEY_FACTOR)}:${Math.round(y * POINT_KEY_FACTOR)}`
);

const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const polygonArea = (points: MarchingPoint[]): number => {
  if (points.length < 3) {
    return 0;
  }

  let areaTwice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) {
      continue;
    }
    areaTwice += (current.x * next.y) - (current.y * next.x);
  }

  return areaTwice * 0.5;
};

const edgeCrossesIso = (a: number, b: number, iso: number): boolean => (
  (a < iso && b >= iso) || (b < iso && a >= iso)
);

const interpolate = (
  x1: number,
  y1: number,
  v1: number,
  x2: number,
  y2: number,
  v2: number,
  iso: number,
): GridPoint => {
  const delta = v2 - v1;
  if (Math.abs(delta) < 1e-8) {
    return { x: (x1 + x2) * 0.5, y: (y1 + y2) * 0.5 };
  }

  const t = (iso - v1) / delta;
  return {
    x: x1 + ((x2 - x1) * t),
    y: y1 + ((y2 - y1) * t),
  };
};

const collectCellSegments = (
  x: number,
  y: number,
  a: number,
  b: number,
  c: number,
  d: number,
  iso: number,
): GridPoint[][] => {
  const corners = [
    { x, y, value: a },
    { x: x + 1, y, value: b },
    { x: x + 1, y: y + 1, value: c },
    { x, y: y + 1, value: d },
  ] as const;
  const edgePointById = new Map<number, GridPoint>();

  const setEdgePoint = (edgeId: number, start: number, end: number): void => {
    const from = corners[start];
    const to = corners[end];
    if (!from || !to || !edgeCrossesIso(from.value, to.value, iso)) {
      return;
    }

    edgePointById.set(
      edgeId,
      interpolate(from.x, from.y, from.value, to.x, to.y, to.value, iso),
    );
  };

  setEdgePoint(0, 0, 1); // top
  setEdgePoint(1, 1, 2); // right
  setEdgePoint(2, 2, 3); // bottom
  setEdgePoint(3, 3, 0); // left

  const crossedEdges = [...edgePointById.keys()];
  if (crossedEdges.length < 2) {
    return [];
  }

  const pair = (edgeA: number, edgeB: number): GridPoint[] | null => {
    const pointA = edgePointById.get(edgeA);
    const pointB = edgePointById.get(edgeB);
    if (!pointA || !pointB) {
      return null;
    }
    return [pointA, pointB];
  };

  if (crossedEdges.length === 2) {
    const single = pair(crossedEdges[0] ?? 0, crossedEdges[1] ?? 0);
    return single ? [single] : [];
  }

  const stateA = a >= iso;
  const stateB = b >= iso;
  const stateC = c >= iso;
  const stateD = d >= iso;
  const caseIndex = (stateA ? 1 : 0)
    | (stateB ? 2 : 0)
    | (stateC ? 4 : 0)
    | (stateD ? 8 : 0);
  const center = (a + b + c + d) * 0.25;

  const segments: GridPoint[][] = [];
  if (caseIndex === 5) {
    const first = center >= iso ? pair(0, 1) : pair(3, 0);
    const second = center >= iso ? pair(2, 3) : pair(1, 2);
    if (first) {
      segments.push(first);
    }
    if (second) {
      segments.push(second);
    }
    return segments;
  }

  if (caseIndex === 10) {
    const first = center >= iso ? pair(3, 0) : pair(0, 1);
    const second = center >= iso ? pair(1, 2) : pair(2, 3);
    if (first) {
      segments.push(first);
    }
    if (second) {
      segments.push(second);
    }
    return segments;
  }

  const first = pair(crossedEdges[0] ?? 0, crossedEdges[1] ?? 0);
  const second = pair(crossedEdges[2] ?? 0, crossedEdges[3] ?? 0);
  if (first) {
    segments.push(first);
  }
  if (second) {
    segments.push(second);
  }
  return segments;
};

const buildScalarField = (
  columns: number,
  rows: number,
  isSolid: (column: number, row: number) => boolean,
): Float32Array => {
  const nodeColumns = columns + 1;
  const nodeRows = rows + 1;
  const values = new Float32Array(nodeColumns * nodeRows);
  const nodeIndex = (x: number, y: number): number => (y * nodeColumns) + x;

  for (let y = 0; y < nodeRows; y += 1) {
    for (let x = 0; x < nodeColumns; x += 1) {
      let solidCount = 0;
      let sampleCount = 0;

      for (let offsetY = -1; offsetY <= 0; offsetY += 1) {
        const row = y + offsetY;
        if (row < 0 || row >= rows) {
          continue;
        }

        for (let offsetX = -1; offsetX <= 0; offsetX += 1) {
          const column = x + offsetX;
          if (column < 0 || column >= columns) {
            continue;
          }

          sampleCount += 1;
          if (isSolid(column, row)) {
            solidCount += 1;
          }
        }
      }

      values[nodeIndex(x, y)] = sampleCount > 0
        ? solidCount / sampleCount
        : 0;
    }
  }

  return values;
};

export const buildMarchingSegments = (
  columns: number,
  rows: number,
  cellSize: number,
  isSolid: (column: number, row: number) => boolean,
  iso = 0.5,
): MarchingSegment[] => {
  const padding = 1;
  const paddedColumns = columns + (padding * 2);
  const paddedRows = rows + (padding * 2);
  const nodeColumns = paddedColumns + 1;
  const field = buildScalarField(
    paddedColumns,
    paddedRows,
    (column, row) => isSolid(column - padding, row - padding),
  );
  const valueAt = (x: number, y: number): number => field[(y * nodeColumns) + x] ?? 0;
  const seenSegments = new Set<string>();
  const segments: MarchingSegment[] = [];

  for (let row = 0; row < paddedRows; row += 1) {
    for (let column = 0; column < paddedColumns; column += 1) {
      const cellSegments = collectCellSegments(
        column,
        row,
        valueAt(column, row),
        valueAt(column + 1, row),
        valueAt(column + 1, row + 1),
        valueAt(column, row + 1),
        iso,
      );

      for (const segment of cellSegments) {
        const a = segment[0];
        const b = segment[1];
        if (!a || !b) {
          continue;
        }

        const ax = (a.x - padding) * cellSize;
        const ay = (a.y - padding) * cellSize;
        const bx = (b.x - padding) * cellSize;
        const by = (b.y - padding) * cellSize;
        const keyA = pointKey(ax, ay);
        const keyB = pointKey(bx, by);
        const dedupeKey = keyA < keyB
          ? `${keyA}|${keyB}`
          : `${keyB}|${keyA}`;
        if (seenSegments.has(dedupeKey)) {
          continue;
        }
        seenSegments.add(dedupeKey);

        segments.push({
          a: { x: ax, y: ay },
          b: { x: bx, y: by },
        });
      }
    }
  }

  return segments;
};

export const buildMarchingLoops = (
  segments: MarchingSegment[],
  minAbsArea = 32,
): MarchingLoop[] => {
  if (segments.length === 0) {
    return [];
  }

  const pointByKey = new Map<string, MarchingPoint>();
  const adjacency = new Map<string, string[]>();
  const segmentEdges: Array<{ aKey: string; bKey: string; key: string }> = [];

  const registerPoint = (point: MarchingPoint): string => {
    const key = pointKey(point.x, point.y);
    if (!pointByKey.has(key)) {
      pointByKey.set(key, { x: point.x, y: point.y });
    }
    return key;
  };

  for (const segment of segments) {
    const aKey = registerPoint(segment.a);
    const bKey = registerPoint(segment.b);
    if (aKey === bKey) {
      continue;
    }

    const canonicalEdge = edgeKey(aKey, bKey);
    segmentEdges.push({ aKey, bKey, key: canonicalEdge });

    const neighborsA = adjacency.get(aKey) ?? [];
    neighborsA.push(bKey);
    adjacency.set(aKey, neighborsA);

    const neighborsB = adjacency.get(bKey) ?? [];
    neighborsB.push(aKey);
    adjacency.set(bKey, neighborsB);
  }

  const visited = new Set<string>();
  const loops: MarchingLoop[] = [];

  for (const segment of segmentEdges) {
    if (visited.has(segment.key)) {
      continue;
    }

    const startKey = segment.aKey;
    let previousKey = segment.aKey;
    let currentKey = segment.bKey;
    const chain: string[] = [segment.aKey, segment.bKey];
    visited.add(segment.key);
    let closed = false;

    const maxSteps = segmentEdges.length + 8;
    for (let step = 0; step < maxSteps; step += 1) {
      const neighbors = adjacency.get(currentKey) ?? [];
      let nextKey: string | null = null;

      for (const neighborKey of neighbors) {
        if (neighborKey === previousKey) {
          continue;
        }

        const nextEdgeKey = edgeKey(currentKey, neighborKey);
        if (visited.has(nextEdgeKey)) {
          continue;
        }

        nextKey = neighborKey;
        visited.add(nextEdgeKey);
        break;
      }

      if (!nextKey) {
        break;
      }

      if (nextKey === startKey) {
        closed = true;
        break;
      }

      chain.push(nextKey);
      previousKey = currentKey;
      currentKey = nextKey;
    }

    if (!closed || chain.length < 3) {
      continue;
    }

    const points: MarchingPoint[] = [];
    for (const key of chain) {
      const point = pointByKey.get(key);
      if (point) {
        points.push(point);
      }
    }

    if (points.length < 3) {
      continue;
    }

    const area = polygonArea(points);
    if (Math.abs(area) < minAbsArea) {
      continue;
    }

    loops.push({ points, area });
  }

  return loops;
};

export const smoothClosedLoop = (
  points: MarchingPoint[],
  iterations: number,
): MarchingPoint[] => {
  if (iterations <= 0 || points.length < 3) {
    return points.map((point) => ({ x: point.x, y: point.y }));
  }

  let current = points.map((point) => ({ x: point.x, y: point.y }));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next: MarchingPoint[] = [];
    const count = current.length;
    for (let index = 0; index < count; index += 1) {
      const p0 = current[index];
      const p1 = current[(index + 1) % count];
      if (!p0 || !p1) {
        continue;
      }

      next.push({
        x: (p0.x * 0.75) + (p1.x * 0.25),
        y: (p0.y * 0.75) + (p1.y * 0.25),
      });
      next.push({
        x: (p0.x * 0.25) + (p1.x * 0.75),
        y: (p0.y * 0.25) + (p1.y * 0.75),
      });
    }

    if (next.length >= 3) {
      current = next;
    } else {
      break;
    }
  }

  return current;
};

const distanceSquared = (a: MarchingPoint, b: MarchingPoint): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return (dx * dx) + (dy * dy);
};

export const simplifyClosedLoop = (
  points: MarchingPoint[],
  minSegmentLength = 1.5,
  collinearSinThreshold = 0.02,
  passes = 2,
): MarchingPoint[] => {
  if (points.length < 4) {
    return points.map((point) => ({ x: point.x, y: point.y }));
  }

  let current = points.map((point) => ({ x: point.x, y: point.y }));
  const minSegmentLengthSq = Math.max(0.01, minSegmentLength * minSegmentLength);

  for (let pass = 0; pass < Math.max(1, passes); pass += 1) {
    const next: MarchingPoint[] = [];
    const count = current.length;

    for (let index = 0; index < count; index += 1) {
      const prev = current[(index - 1 + count) % count];
      const curr = current[index];
      const nextPoint = current[(index + 1) % count];
      if (!prev || !curr || !nextPoint) {
        continue;
      }

      if (distanceSquared(prev, curr) < minSegmentLengthSq) {
        continue;
      }

      if (distanceSquared(curr, nextPoint) < minSegmentLengthSq) {
        continue;
      }

      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = nextPoint.x - curr.x;
      const v2y = nextPoint.y - curr.y;
      const len1 = Math.sqrt((v1x * v1x) + (v1y * v1y));
      const len2 = Math.sqrt((v2x * v2x) + (v2y * v2y));
      if (len1 < 1e-6 || len2 < 1e-6) {
        continue;
      }

      const cross = Math.abs((v1x * v2y) - (v1y * v2x));
      const sinTheta = cross / (len1 * len2);
      if (sinTheta < collinearSinThreshold) {
        continue;
      }

      next.push(curr);
    }

    if (next.length < 3 || next.length >= current.length) {
      break;
    }

    current = next;
  }

  return current;
};
