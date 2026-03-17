import type { Vec2 } from '../domain/state';

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

export const distance = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt((dx * dx) + (dy * dy));
};

export const normalize = (vector: Vec2): Vec2 => {
  const length = Math.sqrt((vector.x * vector.x) + (vector.y * vector.y)) || 1;
  return { x: vector.x / length, y: vector.y / length };
};
