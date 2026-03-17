import { Graphics } from 'pixi.js';
import { HeightMapTerrain } from '../engine/terrain/HeightMapTerrain';
import type { MarchingLoop, MarchingPoint, MarchingSegment } from '../engine/terrain/marchingSquares';
import {
  TERRAIN_MATERIAL,
  type TerrainMaterialId,
} from '../engine/terrain/generation/TerrainFeatureGenerator';

const MATERIAL_DRAW_ORDER: TerrainMaterialId[] = [
  TERRAIN_MATERIAL.BEDROCK,
  TERRAIN_MATERIAL.ROCK,
  TERRAIN_MATERIAL.DIRT,
  TERRAIN_MATERIAL.TOPSOIL,
];

interface MaterialVisualStyle {
  fillColor: number;
  fillAlpha: number;
  outlineColor: number;
  outlineWidth: number;
  outlineAlpha: number;
  smoothIterations: number;
}

const MATERIAL_STYLE: Record<TerrainMaterialId, MaterialVisualStyle> = {
  [TERRAIN_MATERIAL.EMPTY]: {
    fillColor: 0x000000,
    fillAlpha: 0,
    outlineColor: 0x000000,
    outlineWidth: 0,
    outlineAlpha: 0,
    smoothIterations: 0,
  },
  [TERRAIN_MATERIAL.TOPSOIL]: {
    fillColor: 0x78c556,
    fillAlpha: 1,
    outlineColor: 0x4d7b38,
    outlineWidth: 1.2,
    outlineAlpha: 0.72,
    smoothIterations: 2,
  },
  [TERRAIN_MATERIAL.DIRT]: {
    fillColor: 0x8a6342,
    fillAlpha: 1,
    outlineColor: 0x593a24,
    outlineWidth: 1,
    outlineAlpha: 0.22,
    smoothIterations: 2,
  },
  [TERRAIN_MATERIAL.ROCK]: {
    fillColor: 0x66615a,
    fillAlpha: 1,
    outlineColor: 0x4d4841,
    outlineWidth: 0,
    outlineAlpha: 0,
    smoothIterations: 2,
  },
  [TERRAIN_MATERIAL.BEDROCK]: {
    fillColor: 0x4c4850,
    fillAlpha: 1,
    outlineColor: 0x2f2b33,
    outlineWidth: 0,
    outlineAlpha: 0,
    smoothIterations: 2,
  },
};

const OUTER_CONTOUR_DARK = 0x232822;
const OUTER_CONTOUR_LIGHT = 0x5e6f62;
const TOPSOIL_HIGHLIGHT = 0xb3f187;
const TOPSOIL_SHADOW = 0x36522a;
const GLOBAL_BASE_FILL = 0x6b655d;
const DIRT_TEXTURE = 0x5f3f27;
const ROCK_TEXTURE = 0x55504a;
const BEDROCK_TEXTURE = 0x39333d;
const LIGHT_X = -0.54;
const LIGHT_Y = -0.41;
const LIGHT_Z = 0.73;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number): number => a + ((b - a) * clamp01(t));
const smoothStep = (t: number): number => {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - (2 * clamped));
};

const hashNoise = (x: number, y: number, seed: number): number => {
  const value = Math.sin((x * 12.9898) + (y * 78.233) + (seed * 37.719)) * 43758.5453;
  return value - Math.floor(value);
};

const valueNoise = (x: number, y: number, seed: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const ux = smoothStep(tx);
  const uy = smoothStep(ty);
  const n00 = hashNoise(x0, y0, seed + 3.7);
  const n10 = hashNoise(x1, y0, seed + 7.9);
  const n01 = hashNoise(x0, y1, seed + 12.3);
  const n11 = hashNoise(x1, y1, seed + 18.1);
  const nx0 = lerp(n00, n10, ux);
  const nx1 = lerp(n01, n11, ux);
  return lerp(nx0, nx1, uy);
};

const fbmNoise = (x: number, y: number, seed: number): number => {
  let amplitude = 0.58;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency, seed + (octave * 19.7)) * amplitude;
    norm += amplitude;
    frequency *= 2.03;
    amplitude *= 0.52;
  }
  return norm > 0 ? sum / norm : 0;
};

const scaleColor = (color: number, factor: number): number => {
  const scale = Math.max(0, factor);
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * scale)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * scale)));
  const b = Math.max(0, Math.min(255, Math.round((color & 0xff) * scale)));
  return (r << 16) | (g << 8) | b;
};

const segmentLength = (segment: MarchingSegment): number => {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  return Math.sqrt((dx * dx) + (dy * dy));
};

const flattenLoop = (points: MarchingPoint[]): number[] => {
  const values: number[] = [];
  for (const point of points) {
    values.push(point.x, point.y);
  }
  return values;
};

const pointInPolygon = (point: MarchingPoint, polygon: MarchingPoint[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) {
      continue;
    }

    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && (point.x < (((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-6)) + a.x);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
};

const loopAreaAbs = (loop: MarchingLoop): number => Math.abs(loop.area);

const buildHierarchy = (loops: MarchingLoop[]): {
  parentIndex: number[];
  depth: number[];
  childrenByParent: Map<number, number[]>;
} => {
  const parentIndex = new Array<number>(loops.length).fill(-1);
  const loopAreas = loops.map(loopAreaAbs);

  for (let index = 0; index < loops.length; index += 1) {
    const loop = loops[index];
    const seedPoint = loop?.points[0];
    if (!loop || !seedPoint) {
      continue;
    }

    let bestParent = -1;
    let bestParentArea = Number.POSITIVE_INFINITY;
    for (let candidateIndex = 0; candidateIndex < loops.length; candidateIndex += 1) {
      if (candidateIndex === index) {
        continue;
      }

      const candidate = loops[candidateIndex];
      if (!candidate || loopAreas[candidateIndex] <= loopAreas[index]) {
        continue;
      }

      if (!pointInPolygon(seedPoint, candidate.points)) {
        continue;
      }

      if (loopAreas[candidateIndex] < bestParentArea) {
        bestParentArea = loopAreas[candidateIndex];
        bestParent = candidateIndex;
      }
    }

    parentIndex[index] = bestParent;
  }

  const depth = new Array<number>(loops.length).fill(0);
  for (let index = 0; index < loops.length; index += 1) {
    let current = parentIndex[index];
    let steps = 0;
    while (current !== -1 && steps < loops.length + 2) {
      depth[index] += 1;
      current = parentIndex[current] ?? -1;
      steps += 1;
    }
  }

  const childrenByParent = new Map<number, number[]>();
  for (let index = 0; index < parentIndex.length; index += 1) {
    const parent = parentIndex[index] ?? -1;
    if (parent < 0) {
      continue;
    }
    const children = childrenByParent.get(parent) ?? [];
    children.push(index);
    childrenByParent.set(parent, children);
  }

  return { parentIndex, depth, childrenByParent };
};

export class TerrainRenderer {
  readonly graphics = new Graphics();
  private renderedTerrainVersion = -1;
  private readonly hasHoleApi = typeof (this.graphics as unknown as {
    beginHole?: () => Graphics;
    endHole?: () => Graphics;
  }).beginHole === 'function'
    && typeof (this.graphics as unknown as {
      beginHole?: () => Graphics;
      endHole?: () => Graphics;
    }).endHole === 'function';

  render(terrain: HeightMapTerrain): void {
    if (this.renderedTerrainVersion === terrain.getVersion()) {
      return;
    }

    this.renderedTerrainVersion = terrain.getVersion();
    this.graphics.clear();
    this.graphics.lineStyle(0, 0x000000, 0);

    const globalLoops = terrain.getMarchingLoops(2);
    if (globalLoops.length > 0) {
      // Reliable smooth base pass: prevents blank terrain on first frame and avoids blocky fallback edges.
      this.drawFilledLoopSet(globalLoops, GLOBAL_BASE_FILL, 1);
    } else {
      // Hard fallback only if loop extraction fails entirely.
      const runs = terrain.getMaterialRuns();
      for (const run of runs) {
        this.graphics.beginFill(terrain.getMaterialColor(run.materialId), 1);
        this.graphics.drawRect(run.x, run.y, run.width, run.height);
        this.graphics.endFill();
      }
    }

    for (const materialId of MATERIAL_DRAW_ORDER) {
      const style = MATERIAL_STYLE[materialId];
      if (!style) {
        continue;
      }

      const loops = terrain.getMaterialMarchingLoops(materialId, style.smoothIterations);
      if (loops.length === 0) {
        continue;
      }

      this.drawFilledLoopSet(loops, style.fillColor, style.fillAlpha);
    }

    for (const materialId of MATERIAL_DRAW_ORDER) {
      const style = MATERIAL_STYLE[materialId];
      if (!style || style.outlineWidth <= 0 || style.outlineAlpha <= 0) {
        continue;
      }
      this.drawSegments(
        terrain.getMaterialMarchingSegments(materialId),
        style.outlineWidth,
        style.outlineColor,
        style.outlineAlpha,
      );
    }

    this.drawMaterialTexture(terrain, TERRAIN_MATERIAL.BEDROCK, BEDROCK_TEXTURE, 0.2, 11, 0.42, 0.98, 0.7, 3.4, 11.3);
    this.drawMaterialTexture(terrain, TERRAIN_MATERIAL.ROCK, ROCK_TEXTURE, 0.18, 10, 0.4, 0.92, 0.68, 3.1, 23.8);
    this.drawMaterialTexture(terrain, TERRAIN_MATERIAL.DIRT, DIRT_TEXTURE, 0.21, 9, 0.38, 0.86, 0.66, 2.8, 41.7);
    this.drawNormalRelief(terrain, TERRAIN_MATERIAL.BEDROCK, BEDROCK_TEXTURE, 0.21, 10, 2.9, 0.043, 1.32, 91.2);
    this.drawNormalRelief(terrain, TERRAIN_MATERIAL.ROCK, ROCK_TEXTURE, 0.2, 9, 2.6, 0.046, 1.2, 133.4);
    this.drawNormalRelief(terrain, TERRAIN_MATERIAL.DIRT, DIRT_TEXTURE, 0.18, 9, 2.4, 0.049, 1.08, 177.8);

    const terrainSegments = terrain.getMarchingSegments();
    const topsoilSegments = terrain.getMaterialMarchingSegments(TERRAIN_MATERIAL.TOPSOIL);
    this.drawTopsoilShadow(terrain, topsoilSegments);
    this.drawSegments(terrainSegments, 2.8, OUTER_CONTOUR_DARK, 0.22);
    this.drawSegments(terrainSegments, 1.1, OUTER_CONTOUR_LIGHT, 0.28);
    this.drawTopFacingSegments(terrain, topsoilSegments, 1.5, TOPSOIL_HIGHLIGHT, 0.72, 2.8);
    this.drawGrassTufts(terrain, topsoilSegments);
  }

  private drawFilledLoopSet(loops: MarchingLoop[], fillColor: number, fillAlpha: number): void {
    const { depth, childrenByParent } = buildHierarchy(loops);
    const drawOrder = loops
      .map((loop, index) => ({ index, areaAbs: loopAreaAbs(loop) }))
      .sort((a, b) => b.areaAbs - a.areaAbs);

    for (const entry of drawOrder) {
      const loopIndex = entry.index;
      if ((depth[loopIndex] ?? 0) % 2 !== 0) {
        continue;
      }

      const loop = loops[loopIndex];
      if (!loop || loop.points.length < 3) {
        continue;
      }

      this.graphics.beginFill(fillColor, fillAlpha);
      this.graphics.drawPolygon(flattenLoop(loop.points));

      const children = childrenByParent.get(loopIndex) ?? [];
      for (const childIndex of children) {
        if ((depth[childIndex] ?? 0) % 2 !== 1) {
          continue;
        }

        const childLoop = loops[childIndex];
        if (!childLoop || childLoop.points.length < 3) {
          continue;
        }

        if (!this.hasHoleApi) {
          continue;
        }

        try {
          const holeGraphics = this.graphics as unknown as {
            beginHole: () => Graphics;
            endHole: () => Graphics;
          };
          holeGraphics.beginHole();
          this.graphics.drawPolygon(flattenLoop(childLoop.points));
          holeGraphics.endHole();
        } catch {
          // Defensive fallback: malformed hole ring should not break rendering.
        }
      }

      this.graphics.endFill();
    }
  }

  private drawSegments(
    segments: MarchingSegment[],
    width: number,
    color: number,
    alpha: number,
  ): void {
    if (segments.length === 0 || width <= 0 || alpha <= 0) {
      return;
    }

    this.graphics.lineStyle(width, color, alpha);
    for (const segment of segments) {
      this.graphics.moveTo(segment.a.x, segment.a.y);
      this.graphics.lineTo(segment.b.x, segment.b.y);
    }
  }

  private drawMaterialTexture(
    terrain: HeightMapTerrain,
    materialId: TerrainMaterialId,
    color: number,
    alpha: number,
    spacing: number,
    minRadius: number,
    maxRadius: number,
    threshold: number,
    jitter: number,
    seed: number,
  ): void {
    if (alpha <= 0 || spacing <= 0) {
      return;
    }

    const worldWidth = terrain.getWorldWidth();
    const worldHeight = terrain.getWorldHeight();
    const halfSpacing = spacing * 0.5;
    const radiusDelta = Math.max(0.01, maxRadius - minRadius);
    const interiorProbe = Math.max(1.9, spacing * 0.24);

    this.graphics.beginFill(color, alpha);
    for (let y = halfSpacing; y < worldHeight; y += spacing) {
      for (let x = halfSpacing; x < worldWidth; x += spacing) {
        const pick = hashNoise(x * 0.07, y * 0.09, seed);
        if (pick < threshold) {
          continue;
        }

        const jitterX = (hashNoise(x * 0.11, y * 0.17, seed + 4.2) - 0.5) * jitter;
        const jitterY = (hashNoise(x * 0.19, y * 0.13, seed + 8.4) - 0.5) * jitter;
        const px = x + jitterX;
        const py = y + jitterY;
        if (!this.isInteriorMaterialSample(terrain, materialId, px, py, interiorProbe)) {
          continue;
        }

        const radius = minRadius + (hashNoise(px * 0.23, py * 0.31, seed + 12.6) * radiusDelta);
        this.graphics.drawCircle(px, py, radius);
      }
    }
    this.graphics.endFill();
  }

  private drawNormalRelief(
    terrain: HeightMapTerrain,
    materialId: TerrainMaterialId,
    baseColor: number,
    alpha: number,
    spacing: number,
    interiorProbe: number,
    noiseScale: number,
    bumpStrength: number,
    seed: number,
  ): void {
    if (alpha <= 0 || spacing <= 0) {
      return;
    }

    const worldWidth = terrain.getWorldWidth();
    const worldHeight = terrain.getWorldHeight();
    const halfSpacing = spacing * 0.5;
    const highlightColor = scaleColor(baseColor, 1.26);
    const shadowColor = scaleColor(baseColor, 0.62);

    this.graphics.beginFill(highlightColor, alpha * 0.46);
    for (let y = halfSpacing; y < worldHeight; y += spacing) {
      for (let x = halfSpacing; x < worldWidth; x += spacing) {
        const jitterX = (hashNoise(x * 0.13, y * 0.17, seed + 4.6) - 0.5) * (spacing * 0.58);
        const jitterY = (hashNoise(x * 0.19, y * 0.11, seed + 8.9) - 0.5) * (spacing * 0.52);
        const px = x + jitterX;
        const py = y + jitterY;
        if (!this.isInteriorMaterialSample(terrain, materialId, px, py, interiorProbe)) {
          continue;
        }

        const detail = fbmNoise(px * noiseScale, py * noiseScale, seed + 31.7);
        const ddx = fbmNoise((px + 4) * noiseScale, py * noiseScale, seed + 37.3)
          - fbmNoise((px - 4) * noiseScale, py * noiseScale, seed + 37.3);
        const ddy = fbmNoise(px * noiseScale, (py + 4) * noiseScale, seed + 43.5)
          - fbmNoise(px * noiseScale, (py - 4) * noiseScale, seed + 43.5);
        const nx = -ddx * bumpStrength;
        const ny = -ddy * bumpStrength;
        const nz = 1;
        const invLen = 1 / Math.sqrt((nx * nx) + (ny * ny) + (nz * nz));
        const dot = ((nx * LIGHT_X) + (ny * LIGHT_Y) + (nz * LIGHT_Z)) * invLen;
        const depth = clamp01((py - terrain.getGroundY(px)) / 190);
        const cavity = Number(terrain.isSolid(px, py + 3.2))
          + Number(terrain.isSolid(px, py + 6.4))
          - Number(terrain.isSolid(px, py - 3.2));
        const relief = dot + ((detail - 0.5) * 0.46) - (cavity * 0.11) - (depth * 0.07);
        if (relief < 0.24) {
          continue;
        }

        const radius = 0.38 + (hashNoise(px * 0.23, py * 0.29, seed + 51.9) * 0.54);
        this.graphics.drawCircle(px, py, radius);
      }
    }
    this.graphics.endFill();

    this.graphics.beginFill(shadowColor, alpha * 0.38);
    for (let y = halfSpacing; y < worldHeight; y += spacing) {
      for (let x = halfSpacing; x < worldWidth; x += spacing) {
        const jitterX = (hashNoise(x * 0.12, y * 0.16, seed + 63.2) - 0.5) * (spacing * 0.56);
        const jitterY = (hashNoise(x * 0.2, y * 0.12, seed + 67.8) - 0.5) * (spacing * 0.48);
        const px = x + jitterX;
        const py = y + jitterY;
        if (!this.isInteriorMaterialSample(terrain, materialId, px, py, interiorProbe)) {
          continue;
        }

        const detail = fbmNoise(px * noiseScale, py * noiseScale, seed + 71.5);
        const ddx = fbmNoise((px + 4) * noiseScale, py * noiseScale, seed + 79.9)
          - fbmNoise((px - 4) * noiseScale, py * noiseScale, seed + 79.9);
        const ddy = fbmNoise(px * noiseScale, (py + 4) * noiseScale, seed + 83.3)
          - fbmNoise(px * noiseScale, (py - 4) * noiseScale, seed + 83.3);
        const nx = -ddx * bumpStrength;
        const ny = -ddy * bumpStrength;
        const nz = 1;
        const invLen = 1 / Math.sqrt((nx * nx) + (ny * ny) + (nz * nz));
        const dot = ((nx * LIGHT_X) + (ny * LIGHT_Y) + (nz * LIGHT_Z)) * invLen;
        const depth = clamp01((py - terrain.getGroundY(px)) / 190);
        const cavity = Number(terrain.isSolid(px, py + 3.4))
          + Number(terrain.isSolid(px, py + 7))
          - Number(terrain.isSolid(px, py - 2.8));
        const relief = dot + ((detail - 0.5) * 0.46) - (cavity * 0.11) + (depth * 0.08);
        if (relief > -0.2) {
          continue;
        }

        const radius = 0.42 + (hashNoise(px * 0.21, py * 0.25, seed + 89.1) * 0.6);
        this.graphics.drawCircle(px, py, radius);
      }
    }
    this.graphics.endFill();

    const strokeSpacing = spacing * 1.45;
    const halfStrokeSpacing = strokeSpacing * 0.5;
    this.graphics.lineStyle(0.95, highlightColor, alpha * 0.23);
    for (let y = halfStrokeSpacing; y < worldHeight; y += strokeSpacing) {
      for (let x = halfStrokeSpacing; x < worldWidth; x += strokeSpacing) {
        const px = x + ((hashNoise(x * 0.09, y * 0.13, seed + 104.7) - 0.5) * spacing * 0.46);
        const py = y + ((hashNoise(x * 0.14, y * 0.08, seed + 111.1) - 0.5) * spacing * 0.42);
        if (!this.isInteriorMaterialSample(terrain, materialId, px, py, interiorProbe)) {
          continue;
        }

        const ddx = fbmNoise((px + 3) * noiseScale, py * noiseScale, seed + 121.4)
          - fbmNoise((px - 3) * noiseScale, py * noiseScale, seed + 121.4);
        const ddy = fbmNoise(px * noiseScale, (py + 3) * noiseScale, seed + 129.2)
          - fbmNoise(px * noiseScale, (py - 3) * noiseScale, seed + 129.2);
        const nx = -ddx * bumpStrength;
        const ny = -ddy * bumpStrength;
        const nz = 1;
        const invLen = 1 / Math.sqrt((nx * nx) + (ny * ny) + (nz * nz));
        const dot = ((nx * LIGHT_X) + (ny * LIGHT_Y) + (nz * LIGHT_Z)) * invLen;
        if (dot < 0.08 || dot > 0.74) {
          continue;
        }

        const tangentX = -ny;
        const tangentY = nx;
        const tangentLen = Math.sqrt((tangentX * tangentX) + (tangentY * tangentY)) || 1;
        const tx = tangentX / tangentLen;
        const ty = tangentY / tangentLen;
        const strokeLength = 0.6 + (hashNoise(px * 0.21, py * 0.17, seed + 141.8) * 1.35);
        this.graphics.moveTo(px - (tx * strokeLength), py - (ty * strokeLength));
        this.graphics.lineTo(px + (tx * strokeLength), py + (ty * strokeLength));
      }
    }

    this.graphics.lineStyle(0.9, shadowColor, alpha * 0.21);
    for (let y = halfStrokeSpacing; y < worldHeight; y += strokeSpacing) {
      for (let x = halfStrokeSpacing; x < worldWidth; x += strokeSpacing) {
        const px = x + ((hashNoise(x * 0.08, y * 0.12, seed + 153.4) - 0.5) * spacing * 0.42);
        const py = y + ((hashNoise(x * 0.16, y * 0.09, seed + 159.6) - 0.5) * spacing * 0.45);
        if (!this.isInteriorMaterialSample(terrain, materialId, px, py, interiorProbe)) {
          continue;
        }

        const ddx = fbmNoise((px + 3) * noiseScale, py * noiseScale, seed + 167.2)
          - fbmNoise((px - 3) * noiseScale, py * noiseScale, seed + 167.2);
        const ddy = fbmNoise(px * noiseScale, (py + 3) * noiseScale, seed + 173.5)
          - fbmNoise(px * noiseScale, (py - 3) * noiseScale, seed + 173.5);
        const nx = -ddx * bumpStrength;
        const ny = -ddy * bumpStrength;
        const nz = 1;
        const invLen = 1 / Math.sqrt((nx * nx) + (ny * ny) + (nz * nz));
        const dot = ((nx * LIGHT_X) + (ny * LIGHT_Y) + (nz * LIGHT_Z)) * invLen;
        if (dot > -0.08 || dot < -0.72) {
          continue;
        }

        const tangentX = -ny;
        const tangentY = nx;
        const tangentLen = Math.sqrt((tangentX * tangentX) + (tangentY * tangentY)) || 1;
        const tx = tangentX / tangentLen;
        const ty = tangentY / tangentLen;
        const strokeLength = 0.55 + (hashNoise(px * 0.19, py * 0.23, seed + 181.7) * 1.2);
        this.graphics.moveTo(px - (tx * strokeLength), py - (ty * strokeLength));
        this.graphics.lineTo(px + (tx * strokeLength), py + (ty * strokeLength));
      }
    }
  }

  private drawTopsoilShadow(terrain: HeightMapTerrain, segments: MarchingSegment[]): void {
    this.graphics.lineStyle(3.1, TOPSOIL_SHADOW, 0.28);
    for (const segment of segments) {
      if (!this.isTopFacingSurface(terrain, segment, 2.4)) {
        continue;
      }

      const offset = 2.2;
      this.graphics.moveTo(segment.a.x, segment.a.y + offset);
      this.graphics.lineTo(segment.b.x, segment.b.y + offset);
    }
  }

  private drawTopFacingSegments(
    terrain: HeightMapTerrain,
    segments: MarchingSegment[],
    width: number,
    color: number,
    alpha: number,
    probeDistance: number,
  ): void {
    if (width <= 0 || alpha <= 0 || segments.length === 0) {
      return;
    }

    this.graphics.lineStyle(width, color, alpha);
    for (const segment of segments) {
      if (!this.isTopFacingSurface(terrain, segment, probeDistance)) {
        continue;
      }
      this.graphics.moveTo(segment.a.x, segment.a.y);
      this.graphics.lineTo(segment.b.x, segment.b.y);
    }
  }

  private drawGrassTufts(terrain: HeightMapTerrain, segments: MarchingSegment[]): void {
    let drawnTufts = 0;
    const maxTufts = 1700;
    this.graphics.lineStyle(1.1, TOPSOIL_HIGHLIGHT, 0.78);

    for (const segment of segments) {
      if (drawnTufts >= maxTufts) {
        break;
      }

      if (!this.isTopFacingSurface(terrain, segment, 2.8)) {
        continue;
      }

      const length = segmentLength(segment);
      if (length < 15) {
        continue;
      }

      const tuftCount = Math.max(1, Math.floor(length / 18));
      for (let index = 0; index < tuftCount; index += 1) {
        if (drawnTufts >= maxTufts) {
          break;
        }

        const localSeed = drawnTufts * 0.73;
        const offsetFactor = hashNoise(segment.a.x * 0.13, segment.b.y * 0.11, localSeed + 1.7);
        const t = (index + offsetFactor) / tuftCount;
        const x = segment.a.x + ((segment.b.x - segment.a.x) * t);
        const y = segment.a.y + ((segment.b.y - segment.a.y) * t);
        const bladeHeight = 2.8 + (hashNoise(x * 0.24, y * 0.15, localSeed + 3.5) * 3.4);
        const sway = (hashNoise(x * 0.21, y * 0.18, localSeed + 5.9) - 0.5) * 2.9;
        this.graphics.moveTo(x, y + 0.2);
        this.graphics.lineTo(x + sway, y - bladeHeight);
        drawnTufts += 1;
      }
    }
  }

  private isTopFacingSurface(
    terrain: HeightMapTerrain,
    segment: MarchingSegment,
    probeDistance: number,
  ): boolean {
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    if (Math.abs(dx) < (Math.abs(dy) * 0.72)) {
      return false;
    }

    const midX = (segment.a.x + segment.b.x) * 0.5;
    const midY = (segment.a.y + segment.b.y) * 0.5;
    const surfaceY = terrain.getGroundY(midX);
    if (Math.abs(midY - surfaceY) > 12) {
      return false;
    }
    const aboveSolid = terrain.isSolid(midX, midY - probeDistance);
    const belowSolid = terrain.isSolid(midX, midY + probeDistance);
    return belowSolid && !aboveSolid;
  }

  private isInteriorMaterialSample(
    terrain: HeightMapTerrain,
    materialId: TerrainMaterialId,
    x: number,
    y: number,
    interiorProbe: number,
  ): boolean {
    if (terrain.getMaterialAtWorld(x, y) !== materialId) {
      return false;
    }

    return terrain.getMaterialAtWorld(x - interiorProbe, y) === materialId
      && terrain.getMaterialAtWorld(x + interiorProbe, y) === materialId
      && terrain.getMaterialAtWorld(x, y - interiorProbe) === materialId
      && terrain.getMaterialAtWorld(x, y + interiorProbe) === materialId;
  }
}
