export const createRuntimeSeed = (baseSeed: number): number => {
  const timeSeed = Date.now() >>> 0;
  const randomSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;
  return (baseSeed ^ timeSeed ^ randomSeed) >>> 0;
};
