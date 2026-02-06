// 1-ply greedy player: picks the move that maximizes reward + V(afterstate)

import { move, cloneBoard } from '../game/engine.js';

export class GreedyPlayer {
  constructor(network) {
    this.network = network;
  }

  // Returns best direction (0-3) or -1 if no valid move
  selectMove(board) {
    let bestDir = -1;
    let bestValue = -Infinity;

    for (let dir = 0; dir < 4; dir++) {
      const after = cloneBoard(board);
      const result = move(after, dir);
      if (!result.moved) continue;

      const value = result.reward + this.network.evaluate(after);
      if (value > bestValue) {
        bestValue = value;
        bestDir = dir;
      }
    }

    return bestDir;
  }
}
