// Expectimax player with N-tuple network evaluation
// N-ply search with chance nodes (random tile placement)

import { move, cloneBoard, emptyCount, SIZE, TOTAL } from '../game/engine.js';

export class ExpectimaxPlayer {
  constructor(network, depth = 2) {
    this.network = network;
    this.depth = depth;
  }

  selectMove(board) {
    let bestDir = -1;
    let bestValue = -Infinity;

    for (let dir = 0; dir < 4; dir++) {
      const after = cloneBoard(board);
      const result = move(after, dir);
      if (!result.moved) continue;

      const value = result.reward + this._chanceNode(after, this.depth - 1);
      if (value > bestValue) {
        bestValue = value;
        bestDir = dir;
      }
    }

    return bestDir;
  }

  _chanceNode(board, depth) {
    if (depth <= 0) return this.network.evaluate(board);

    const empty = [];
    for (let i = 0; i < TOTAL; i++) {
      if (board[i] === 0) empty.push(i);
    }
    if (empty.length === 0) return this.network.evaluate(board);

    // Sample if too many empty cells to keep computation manageable
    const cells = empty.length <= 8 ? empty : sampleCells(empty, 8);
    let total = 0;

    for (const idx of cells) {
      // Tile 2 (log2=1) with 90% probability
      board[idx] = 1;
      total += 0.9 * this._playerNode(board, depth);

      // Tile 4 (log2=2) with 10% probability
      board[idx] = 2;
      total += 0.1 * this._playerNode(board, depth);

      board[idx] = 0; // restore
    }

    return total / cells.length;
  }

  _playerNode(board, depth) {
    let bestValue = -Infinity;
    let anyMoved = false;

    for (let dir = 0; dir < 4; dir++) {
      const after = cloneBoard(board);
      const result = move(after, dir);
      if (!result.moved) continue;
      anyMoved = true;

      const value = result.reward + this._chanceNode(after, depth - 1);
      if (value > bestValue) bestValue = value;
    }

    return anyMoved ? bestValue : this.network.evaluate(board);
  }
}

function sampleCells(cells, n) {
  const sampled = [...cells];
  for (let i = sampled.length - 1; i > 0 && sampled.length > n; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sampled[i], sampled[j]] = [sampled[j], sampled[i]];
  }
  return sampled.slice(0, n);
}
