// Board-to-pixel renderer for GIF output
// Renders a 4x4 2048 board with colored tiles and bitmap numbers

import { tileValue } from '../game/engine4x4.js';

// 3x5 bitmap font for digits 0-9
// Each character is 3 pixels wide, 5 pixels tall
// Encoded as 5 rows of 3-bit values
const FONT_3x5 = {
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b001, 0b001, 0b001],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  'k': [0b101, 0b110, 0b100, 0b110, 0b101],
};

// Tile colors: palette index for each tile value (log2)
// Color indices into the global palette
const TILE_COLORS = {
  0:  0,  // empty (dark bg)
  1:  1,  // 2
  2:  2,  // 4
  3:  3,  // 8
  4:  4,  // 16
  5:  5,  // 32
  6:  6,  // 64
  7:  7,  // 128
  8:  8,  // 256
  9:  9,  // 512
  10: 10, // 1024
  11: 11, // 2048
  12: 12, // 4096
  13: 13, // 8192
  14: 14, // 16384
  15: 15, // 32768
};

// Text color per tile (light vs dark)
const TEXT_COLOR = {
  0: 17,  // dim text on empty
  1: 16,  // dark text on light tile
  2: 16,  // dark text
  3: 17,  // white on orange
  4: 17,  // white on red
  5: 17,  // white
  6: 17,  // white
  7: 17,  // white
  8: 17,  // white
  9: 17,  // white
  10: 17, // white
  11: 17, // white
  12: 17, // white
  13: 17, // white
  14: 17, // white
  15: 17, // white
};

// Global palette: 32 colors (next power of 2 above our needs)
// Indices 0-15: tile backgrounds, 16: dark text, 17: light text, 18: grid bg, 19: score bg
export const PALETTE = [
  [42,  46,  66],   // 0: empty tile (#2a2e42)
  [61,  90, 128],   // 1: 2 (#3d5a80)
  [74, 124,  89],   // 2: 4 (#4a7c59)
  [224, 124, 63],   // 3: 8 (#e07c3f)
  [211,  95, 95],   // 4: 16 (#d35f5f)
  [199,  75, 122],  // 5: 32 (#c74b7a)
  [168,  85, 247],  // 6: 64 (#a855f7)
  [124,  58, 237],  // 7: 128 (#7c3aed)
  [109,  40, 217],  // 8: 256 (#6d28d9)
  [79,   70, 229],  // 9: 512 (#4f46e5)
  [37,   99, 235],  // 10: 1024 (#2563eb)
  [14,  165, 233],  // 11: 2048 (#0ea5e9)
  [6,   182, 212],  // 12: 4096 (#06b6d4)
  [20,  184, 166],  // 13: 8192 (#14b8a6)
  [16,  185, 129],  // 14: 16384 (#10b981)
  [245, 158, 11],   // 15: 32768 (#f59e0b)
  [30,   30,  40],  // 16: dark text
  [240, 240, 245],  // 17: light text
  [26,   27,  38],  // 18: grid background (#1a1b26)
  [36,   40,  59],  // 19: score area bg (#24283b)
  [122, 162, 247],  // 20: accent blue (#7aa2f7)
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
];

// Rendering parameters
const TILE_SIZE = 20;   // pixels per tile
const GAP = 2;          // gap between tiles
const PADDING = 4;      // outer padding
const SCORE_HEIGHT = 12; // height for score bar at top

const BOARD_SIZE = 4;
const GRID_SIZE = PADDING * 2 + BOARD_SIZE * TILE_SIZE + (BOARD_SIZE - 1) * GAP;

export const IMAGE_WIDTH = GRID_SIZE;
export const IMAGE_HEIGHT = GRID_SIZE + SCORE_HEIGHT;

// Draw a character at position (x, y) in pixel buffer
function drawChar(pixels, width, ch, x, y, colorIdx) {
  const bitmap = FONT_3x5[ch];
  if (!bitmap) return;
  for (let row = 0; row < 5; row++) {
    const bits = bitmap[row];
    for (let col = 0; col < 3; col++) {
      if (bits & (1 << (2 - col))) {
        const px = x + col;
        const py = y + row;
        if (px >= 0 && px < width && py >= 0 && py < IMAGE_HEIGHT) {
          pixels[py * width + px] = colorIdx;
        }
      }
    }
  }
}

// Draw a string of digits centered at (cx, cy)
function drawText(pixels, width, text, cx, cy, colorIdx) {
  const charWidth = 4; // 3 pixel char + 1 pixel gap
  const totalWidth = text.length * charWidth - 1;
  const startX = cx - Math.floor(totalWidth / 2);
  const startY = cy - 2; // center vertically (font is 5px tall)
  for (let i = 0; i < text.length; i++) {
    drawChar(pixels, width, text[i], startX + i * charWidth, startY, colorIdx);
  }
}

// Render a board state (Uint8Array of log2 values) to pixel buffer
export function renderBoard(board, score) {
  const pixels = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT);

  // Fill background
  pixels.fill(18);

  // Draw score bar
  for (let y = 0; y < SCORE_HEIGHT; y++) {
    for (let x = 0; x < IMAGE_WIDTH; x++) {
      pixels[y * IMAGE_WIDTH + x] = 19;
    }
  }

  // Draw score text
  const scoreText = String(score);
  drawText(pixels, IMAGE_WIDTH, scoreText, Math.floor(IMAGE_WIDTH / 2), Math.floor(SCORE_HEIGHT / 2), 20);

  // Draw tiles
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const tileLog2 = board[r * BOARD_SIZE + c];
      const tileColorIdx = TILE_COLORS[tileLog2] || 0;
      const textColorIdx = TEXT_COLOR[tileLog2] || 17;

      const tileX = PADDING + c * (TILE_SIZE + GAP);
      const tileY = SCORE_HEIGHT + PADDING + r * (TILE_SIZE + GAP);

      // Fill tile
      for (let dy = 0; dy < TILE_SIZE; dy++) {
        for (let dx = 0; dx < TILE_SIZE; dx++) {
          pixels[(tileY + dy) * IMAGE_WIDTH + (tileX + dx)] = tileColorIdx;
        }
      }

      // Draw tile value text
      if (tileLog2 > 0) {
        const val = tileValue(tileLog2);
        let text;
        if (val >= 1024) {
          text = Math.floor(val / 1024) + 'k';
        } else {
          text = String(val);
        }
        const cx = tileX + Math.floor(TILE_SIZE / 2);
        const cy = tileY + Math.floor(TILE_SIZE / 2);
        drawText(pixels, IMAGE_WIDTH, text, cx, cy, textColorIdx);
      }
    }
  }

  return pixels;
}

// Render a complete game as a series of frames
// steps: array of { board: Uint8Array, score: number }
export function renderGameFrames(steps) {
  return steps.map(step => renderBoard(step.board, step.score));
}
