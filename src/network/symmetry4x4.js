// 8-fold symmetry transformations for 4x4 board
// 4 rotations x 2 reflections = 8 transformations

const SIZE = 4;

function buildMap(transformFn) {
  const map = new Int32Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const [nr, nc] = transformFn(r, c);
      map[r * SIZE + c] = nr * SIZE + nc;
    }
  }
  return map;
}

const identity = buildMap((r, c) => [r, c]);
const rot90 = buildMap((r, c) => [c, SIZE - 1 - r]);
const rot180 = buildMap((r, c) => [SIZE - 1 - r, SIZE - 1 - c]);
const rot270 = buildMap((r, c) => [SIZE - 1 - c, r]);
const flipH = buildMap((r, c) => [r, SIZE - 1 - c]);
const flipH_rot90 = buildMap((r, c) => {
  const r1 = r, c1 = SIZE - 1 - c;
  return [c1, SIZE - 1 - r1];
});
const flipH_rot180 = buildMap((r, c) => {
  const r1 = r, c1 = SIZE - 1 - c;
  return [SIZE - 1 - r1, SIZE - 1 - c1];
});
const flipH_rot270 = buildMap((r, c) => {
  const r1 = r, c1 = SIZE - 1 - c;
  return [SIZE - 1 - c1, r1];
});

export const SYMMETRY_MAPS = [
  identity, rot90, rot180, rot270,
  flipH, flipH_rot90, flipH_rot180, flipH_rot270,
];

export function applySymmetry(pattern, symMap) {
  return pattern.map(idx => symMap[idx]);
}

export function allSymmetries(pattern) {
  const seen = new Set();
  const variants = [];
  for (const symMap of SYMMETRY_MAPS) {
    const transformed = applySymmetry(pattern, symMap);
    const key = transformed.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      variants.push(transformed);
    }
  }
  return variants;
}
