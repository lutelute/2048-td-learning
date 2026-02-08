// N-tuple patterns for 4x4 board
// Board layout:
//  0  1  2  3
//  4  5  6  7
//  8  9 10 11
// 12 13 14 15
//
// Memory budget: ~193MB (fits in 512MB heap)
// 6-tuple: 16^6 = 16,777,216 entries x 4 bytes = 64MB per LUT
// 4-tuple: 16^4 = 65,536 entries x 4 bytes = 256KB per LUT

const SIZE = 4;
const idx = (r, c) => r * SIZE + c;

// ---- 6-tuple patterns (64MB each) ----
// rect_2x3: 2-row x 3-col rectangle at top-left
const rect_2x3 = [idx(0,0), idx(0,1), idx(0,2), idx(1,0), idx(1,1), idx(1,2)];

// rect_3x2: 3-row x 2-col rectangle at top-left
const rect_3x2 = [idx(0,0), idx(0,1), idx(1,0), idx(1,1), idx(2,0), idx(2,1)];

// corner_L: L-shaped 6-tuple at top-left corner
const corner_L = [idx(0,0), idx(0,1), idx(0,2), idx(1,0), idx(1,1), idx(2,0)];

// ---- 4-tuple patterns (256KB each) ----
// line4_h: horizontal line (full row)
const line4_h = [idx(0,0), idx(0,1), idx(0,2), idx(0,3)];

// sq2x2: 2x2 square
const sq2x2 = [idx(0,0), idx(0,1), idx(1,0), idx(1,1)];

// stair4: staircase pattern
const stair4 = [idx(0,0), idx(0,1), idx(1,1), idx(1,2)];

// lshape4: L-shaped 4-tuple
const lshape4 = [idx(0,0), idx(1,0), idx(2,0), idx(2,1)];

// All base patterns before symmetry expansion
// Memory estimate:
//   3 x 64MB (6-tuples) + 4 x 256KB (4-tuples)
//   = 192 + 1 = ~193MB
export const BASE_PATTERNS = [
  rect_2x3,
  rect_3x2,
  corner_L,
  line4_h,
  sq2x2,
  stair4,
  lshape4,
];

export const NUM_VALUES = 16; // 0..15

export function lutSize(tupleLength) {
  return NUM_VALUES ** tupleLength;
}
