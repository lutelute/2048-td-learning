// High-performance headless 2048 game engine for 4x4 board
// Board: Uint8Array(16) with log2 encoding (0=empty, 1=2, 2=4, ..., 15=32768)

const SIZE = 4;
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

export function tileValue(log2val) {
  return log2val === 0 ? 0 : 1 << log2val;
}

export function toLog2(val) {
  if (val === 0) return 0;
  let n = 0;
  let v = val;
  while (v > 1) { v >>= 1; n++; }
  return n;
}

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

function slideLine(line, size) {
  let write = 0;
  for (let i = 0; i < size; i++) {
    if (line[i] !== 0) {
      line[write++] = line[i];
    }
  }
  for (let i = write; i < size; i++) line[i] = 0;

  let reward = 0;
  for (let i = 0; i < size - 1; i++) {
    if (line[i] !== 0 && line[i] === line[i + 1]) {
      line[i]++;
      reward += 1 << line[i];
      line[i + 1] = 0;
      i++;
    }
  }

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
export function move(board, dir) {
  let reward = 0;
  let moved = false;
  const line = new Uint8Array(SIZE);

  for (let k = 0; k < SIZE; k++) {
    for (let i = 0; i < SIZE; i++) {
      switch (dir) {
        case 0: line[i] = board[i * SIZE + k]; break;
        case 1: line[i] = board[k * SIZE + (SIZE - 1 - i)]; break;
        case 2: line[i] = board[(SIZE - 1 - i) * SIZE + k]; break;
        case 3: line[i] = board[k * SIZE + i]; break;
      }
    }

    const orig = new Uint8Array(line);
    reward += slideLine(line, SIZE);

    for (let i = 0; i < SIZE; i++) {
      if (line[i] !== orig[i]) { moved = true; break; }
    }

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

export function moveClone(board, dir) {
  const after = cloneBoard(board);
  const result = move(after, dir);
  return { board: after, moved: result.moved, reward: result.reward };
}

export function canMove(board) {
  for (let i = 0; i < TOTAL; i++) {
    if (board[i] === 0) return true;
  }
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r * SIZE + c];
      if (c < SIZE - 1 && v === board[r * SIZE + c + 1]) return true;
      if (r < SIZE - 1 && v === board[(r + 1) * SIZE + c]) return true;
    }
  }
  return false;
}

export function maxTile(board) {
  let max = 0;
  for (let i = 0; i < TOTAL; i++) {
    if (board[i] > max) max = board[i];
  }
  return max;
}

export function emptyCount(board) {
  let count = 0;
  for (let i = 0; i < TOTAL; i++) {
    if (board[i] === 0) count++;
  }
  return count;
}

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

export function fromGrid(grid) {
  const board = new Uint8Array(TOTAL);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      board[r * SIZE + c] = toLog2(grid[r][c]);
    }
  }
  return board;
}

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
