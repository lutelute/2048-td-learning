// N-tuple patterns for 5x5 board
// Each pattern is an array of board indices (row*5+col)
// Memory budget: ~50-100MB
// 4-tuple: 16^4 = 65,536 entries × 4 bytes = 256KB per LUT
// 5-tuple: 16^5 = 1,048,576 entries × 4 bytes = 4MB per LUT
// 6-tuple: 16^6 = 16,777,216 entries × 4 bytes = 64MB per LUT (too large for many)

const SIZE = 5;
const idx = (r, c) => r * SIZE + c;

// ---- 6-tuple patterns (use sparingly due to 64MB each) ----
const corner_tl = [idx(0,0), idx(0,1), idx(0,2), idx(1,0), idx(1,1), idx(2,0)];
const rect_2x3  = [idx(0,0), idx(0,1), idx(0,2), idx(1,0), idx(1,1), idx(1,2)];

// ---- 5-tuple patterns (4MB each — good balance) ----
const line5_h = [idx(0,0), idx(0,1), idx(0,2), idx(0,3), idx(0,4)];
const line5_v = [idx(0,0), idx(1,0), idx(2,0), idx(3,0), idx(4,0)];
const cross5  = [idx(0,0), idx(0,1), idx(1,0), idx(1,1), idx(0,2)];
const stair5  = [idx(0,0), idx(0,1), idx(1,1), idx(1,2), idx(2,2)];
const t_shape = [idx(0,0), idx(0,1), idx(0,2), idx(1,1), idx(2,1)];

// ---- 4-tuple patterns (256KB each — fast, many variants) ----
const sq2x2   = [idx(0,0), idx(0,1), idx(1,0), idx(1,1)];
const line4_h = [idx(0,0), idx(0,1), idx(0,2), idx(0,3)];
const line4_v = [idx(0,0), idx(1,0), idx(2,0), idx(3,0)];
const stair4  = [idx(0,0), idx(0,1), idx(1,1), idx(1,2)];
const lshape  = [idx(0,0), idx(0,1), idx(1,0), idx(2,0)];

// All base patterns before symmetry expansion
// Memory estimate:
//   2 × 64MB (6-tuples) + 5 × 4MB (5-tuples) + 5 × 256KB (4-tuples)
//   ≈ 128 + 20 + 1.3 = ~149MB raw, but many symmetric variants share a LUT
//   Actual: ~149MB (within Node.js capability)
export const BASE_PATTERNS = [
  corner_tl,
  rect_2x3,
  line5_h,
  line5_v,
  cross5,
  stair5,
  t_shape,
  sq2x2,
  line4_h,
  line4_v,
  stair4,
  lshape,
];

// Max tile value (log2). For 5x5, max practical is 15 (=32768)
// LUT size per tuple: NUM_VALUES^tupleLength
export const NUM_VALUES = 16; // 0..15

export function lutSize(tupleLength) {
  return NUM_VALUES ** tupleLength;
}
