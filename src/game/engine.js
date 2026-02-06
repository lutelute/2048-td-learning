// High-performance headless 2048 game engine for 5x5 board
// Board: Uint8Array(25) with log2 encoding (0=empty, 1=2, 2=4, ..., 15=32768)

const SIZE = 5;
const TOTAL = SIZE * SIZE;

export function createBoard() {
  const board = new Uint8Array(TOTAL);
  addRandomTile(board);
  addRandomTile(board);
  return board;
}

export function cloneBoard(board) {
  return new Uint8Array(board);
}

// Convert log2 value to actual value
export function tileValue(log2val) {
  return log2val === 0 ? 0 : 1 << log2val;
}

// Convert actual value to log2
export function toLog2(val) {
  if (val === 0) return 0;
  let n = 0;
  let v = val;
  while (v > 1) { v >>= 1; n++; }
  return n;
}

// Add a random tile (90% = 2 i.e. log2=1, 10% = 4 i.e. log2=2)
export function addRandomTile(board) {
  const empty = [];
  for (let i = 0; i < TOTAL; i++) {
    if (board[i] === 0) empty.push(i);
  }
  if (empty.length === 0) return false;
  const idx = empty[Math.floor(Math.random() * empty.length)];
  board[idx] = Math.random() < 0.9 ? 1 : 2;
  return true;
}

// Slide a single row/col toward index 0, returning reward
function slideLine(line, size) {
  // Compact: remove zeros
  let write = 0;
  for (let i = 0; i < size; i++) {
    if (line[i] !== 0) {
      line[write++] = line[i];
    }
  }
  for (let i = write; i < size; i++) line[i] = 0;

  // Merge
  let reward = 0;
  for (let i = 0; i < size - 1; i++) {
    if (line[i] !== 0 && line[i] === line[i + 1]) {
      line[i]++;
      reward += 1 << line[i]; // merged value
      line[i + 1] = 0;
      i++; // skip merged tile
    }
  }

  // Compact again after merge
  write = 0;
  for (let i = 0; i < size; i++) {
    if (line[i] !== 0) {
      line[write++] = line[i];
    }
  }
  for (let i = write; i < size; i++) line[i] = 0;

  return reward;
}

// Directions: 0=up, 1=right, 2=down, 3=left
// Returns { moved, reward } and mutates board to afterstate (before random tile)
export function move(board, dir) {
  let reward = 0;
  let moved = false;
  const line = new Uint8Array(SIZE);

  for (let k = 0; k < SIZE; k++) {
    // Extract line
    for (let i = 0; i < SIZE; i++) {
      switch (dir) {
        case 0: line[i] = board[i * SIZE + k]; break;       // up: column k, top to bottom
        case 1: line[i] = board[k * SIZE + (SIZE - 1 - i)]; break; // right: row k, right to left
        case 2: line[i] = board[(SIZE - 1 - i) * SIZE + k]; break; // down: column k, bottom to top
        case 3: line[i] = board[k * SIZE + i]; break;       // left: row k, left to right
      }
    }

    // Save original for comparison
    const orig = new Uint8Array(line);

    reward += slideLine(line, SIZE);

    // Check if changed
    for (let i = 0; i < SIZE; i++) {
      if (line[i] !== orig[i]) { moved = true; break; }
    }

    // Write back
    for (let i = 0; i < SIZE; i++) {
      switch (dir) {
        case 0: board[i * SIZE + k] = line[i]; break;
        case 1: board[k * SIZE + (SIZE - 1 - i)] = line[i]; break;
        case 2: board[(SIZE - 1 - i) * SIZE + k] = line[i]; break;
        case 3: board[k * SIZE + i] = line[i]; break;
      }
    }
  }

  return { moved, reward };
}

// Move without mutating (returns new board as afterstate)
export function moveClone(board, dir) {
  const after = cloneBoard(board);
  const result = move(after, dir);
  return { board: after, moved: result.moved, reward: result.reward };
}

// Check if any move is possible
export function canMove(board) {
  for (let i = 0; i < TOTAL; i++) {
    if (board[i] === 0) return true;
  }
  // Check adjacent merges
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r * SIZE + c];
      if (c < SIZE - 1 && v === board[r * SIZE + c + 1]) return true;
      if (r < SIZE - 1 && v === board[(r + 1) * SIZE + c]) return true;
    }
  }
  return false;
}

// Get the maximum tile value (log2)
export function maxTile(board) {
  let max = 0;
  for (let i = 0; i < TOTAL; i++) {
    if (board[i] > max) max = board[i];
  }
  return max;
}

// Count empty cells
export function emptyCount(board) {
  let count = 0;
  for (let i = 0; i < TOTAL; i++) {
    if (board[i] === 0) count++;
  }
  return count;
}

// Pretty print the board
export function printBoard(board) {
  const lines = [];
  for (let r = 0; r < SIZE; r++) {
    const row = [];
    for (let c = 0; c < SIZE; c++) {
      row.push(String(tileValue(board[r * SIZE + c])).padStart(6));
    }
    lines.push(row.join(''));
  }
  return lines.join('\n');
}

// Convert from 2D actual-value array to Uint8Array log2 board
export function fromGrid(grid) {
  const board = new Uint8Array(TOTAL);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      board[r * SIZE + c] = toLog2(grid[r][c]);
    }
  }
  return board;
}

// Convert to 2D actual-value array
export function toGrid(board) {
  const grid = [];
  for (let r = 0; r < SIZE; r++) {
    const row = [];
    for (let c = 0; c < SIZE; c++) {
      row.push(tileValue(board[r * SIZE + c]));
    }
    grid.push(row);
  }
  return grid;
}

export { SIZE, TOTAL };
