// 8-fold symmetry transformations for 5x5 board
// 4 rotations × 2 reflections = 8 transformations

const SIZE = 5;

// Generate index mapping for a transformation
// transform(r, c) → [newR, newC]
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

// Identity
const identity = buildMap((r, c) => [r, c]);

// Rotate 90° clockwise
const rot90 = buildMap((r, c) => [c, SIZE - 1 - r]);

// Rotate 180°
const rot180 = buildMap((r, c) => [SIZE - 1 - r, SIZE - 1 - c]);

// Rotate 270° clockwise
const rot270 = buildMap((r, c) => [SIZE - 1 - c, r]);

// Reflect horizontally (flip left-right)
const flipH = buildMap((r, c) => [r, SIZE - 1 - c]);

// Reflect horizontally + rotate 90°
const flipH_rot90 = buildMap((r, c) => {
  // First flip: (r, c) → (r, SIZE-1-c)
  // Then rot90: (r', c') → (c', SIZE-1-r')
  const r1 = r, c1 = SIZE - 1 - c;
  return [c1, SIZE - 1 - r1];
});

// Reflect horizontally + rotate 180°
const flipH_rot180 = buildMap((r, c) => {
  const r1 = r, c1 = SIZE - 1 - c;
  return [SIZE - 1 - r1, SIZE - 1 - c1];
});

// Reflect horizontally + rotate 270°
const flipH_rot270 = buildMap((r, c) => {
  const r1 = r, c1 = SIZE - 1 - c;
  return [SIZE - 1 - c1, r1];
});

export const SYMMETRY_MAPS = [
  identity, rot90, rot180, rot270,
  flipH, flipH_rot90, flipH_rot180, flipH_rot270,
];

// Apply symmetry map to a tuple pattern (array of board indices)
// Returns the transformed indices
export function applySymmetry(pattern, symMap) {
  return pattern.map(idx => symMap[idx]);
}

// Generate all symmetric variants of a pattern
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
