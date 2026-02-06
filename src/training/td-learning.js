// TD(0) Afterstate Learning for 2048
// Key insight: learn V(afterstate) where afterstate = board after slide, before random tile

import { createBoard, move, cloneBoard, canMove, addRandomTile, maxTile } from '../game/engine.js';

// Play one episode (one complete game) and learn from it
// Returns { score, maxTileLog2, steps }
export function playEpisode(network, learningRate) {
  const board = createBoard();
  let score = 0;
  let steps = 0;
  let prevAfterstate = null;
  let prevReward = 0;

  while (true) {
    // Find best move: maximize reward + V(afterstate)
    let bestDir = -1;
    let bestValue = -Infinity;
    let bestAfterstate = null;
    let bestReward = 0;

    for (let dir = 0; dir < 4; dir++) {
      const after = cloneBoard(board);
      const result = move(after, dir);
      if (!result.moved) continue;

      const value = result.reward + network.evaluate(after);
      if (value > bestValue) {
        bestValue = value;
        bestDir = dir;
        bestAfterstate = after;
        bestReward = result.reward;
      }
    }

    // No valid move = game over
    if (bestDir === -1) break;

    // TD update for previous afterstate
    if (prevAfterstate !== null) {
      const delta = prevReward + network.evaluate(bestAfterstate) - network.evaluate(prevAfterstate);
      const updateDelta = learningRate * delta;
      network.update(prevAfterstate, updateDelta);
    }

    // Record current afterstate
    prevAfterstate = bestAfterstate;
    prevReward = bestReward;
    score += bestReward;
    steps++;

    // Apply move to actual board
    move(board, bestDir);

    // Add random tile
    addRandomTile(board);

    // Check if game is over after tile addition
    if (!canMove(board)) break;
  }

  // Terminal update: V(terminal afterstate) should be 0
  if (prevAfterstate !== null) {
    const delta = 0 - network.evaluate(prevAfterstate);
    network.update(prevAfterstate, learningRate * delta);
  }

  return {
    score,
    maxTileLog2: maxTile(board),
    steps,
  };
}

// Evaluate the network by playing games without learning
export function evaluateNetwork(network, numGames) {
  const scores = [];
  const maxTiles = [];

  for (let i = 0; i < numGames; i++) {
    const result = playEvalGame(network);
    scores.push(result.score);
    maxTiles.push(result.maxTileLog2);
  }

  // Compute stats
  scores.sort((a, b) => a - b);
  const avgScore = scores.reduce((s, v) => s + v, 0) / numGames;
  const medScore = scores[Math.floor(numGames / 2)];

  // Tile distribution
  const tileDist = {};
  for (const t of maxTiles) {
    const val = 1 << t;
    tileDist[val] = (tileDist[val] || 0) + 1;
  }

  // Reach rates
  const reachRates = {};
  for (const threshold of [11, 12, 13, 14]) { // 2048, 4096, 8192, 16384
    const count = maxTiles.filter(t => t >= threshold).length;
    reachRates[1 << threshold] = (count / numGames * 100).toFixed(1) + '%';
  }

  return { avgScore, medScore, tileDist, reachRates, numGames };
}

// Play a single evaluation game (no learning)
function playEvalGame(network) {
  const board = createBoard();
  let score = 0;

  while (true) {
    let bestDir = -1;
    let bestValue = -Infinity;

    for (let dir = 0; dir < 4; dir++) {
      const after = cloneBoard(board);
      const result = move(after, dir);
      if (!result.moved) continue;

      const value = result.reward + network.evaluate(after);
      if (value > bestValue) {
        bestValue = value;
        bestDir = dir;
      }
    }

    if (bestDir === -1) break;

    const result = move(board, bestDir);
    score += result.reward;
    addRandomTile(board);

    if (!canMove(board)) break;
  }

  return { score, maxTileLog2: maxTile(board) };
}
