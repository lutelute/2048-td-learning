#!/usr/bin/env node
// Benchmark: evaluate N-tuple network vs random play
// Usage: node scripts/benchmark.js [--weights PATH] [--games N] [--expectimax] [--depth N]

import { NTupleNetwork } from '../src/network/ntuple.js';
import { createBoard, move, cloneBoard, canMove, addRandomTile, maxTile, printBoard, tileValue } from '../src/game/engine.js';
import { GreedyPlayer } from '../src/player/greedy-player.js';
import { ExpectimaxPlayer } from '../src/player/expectimax-player.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { games: 1000, weights: 'weights/final.bin', expectimax: false, depth: 2 };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--weights': opts.weights = args[++i]; break;
      case '--games': opts.games = parseInt(args[++i]); break;
      case '--expectimax': opts.expectimax = true; break;
      case '--depth': opts.depth = parseInt(args[++i]); break;
    }
  }
  return opts;
}

function runBenchmark(player, numGames, label) {
  console.log(`\n=== ${label} (${numGames} games) ===`);
  const scores = [];
  const maxTiles = [];
  const startTime = Date.now();

  for (let i = 0; i < numGames; i++) {
    const board = createBoard();
    let score = 0;

    while (true) {
      const dir = player.selectMove(board);
      if (dir === -1) break;

      const result = move(board, dir);
      score += result.reward;
      addRandomTile(board);

      if (!canMove(board)) break;
    }

    scores.push(score);
    maxTiles.push(maxTile(board));

    if ((i + 1) % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
      process.stdout.write(`\r  ${i + 1}/${numGames} games | Avg: ${Math.round(avg)} | ${(scores.length / elapsed).toFixed(0)} games/s`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log('');

  // Stats
  scores.sort((a, b) => a - b);
  const avg = scores.reduce((s, v) => s + v, 0) / numGames;
  const med = scores[Math.floor(numGames / 2)];
  const max = scores[numGames - 1];
  const min = scores[0];

  console.log(`  Avg Score: ${Math.round(avg)}`);
  console.log(`  Med Score: ${Math.round(med)}`);
  console.log(`  Min/Max:   ${min} / ${max}`);
  console.log(`  Time:      ${elapsed.toFixed(1)}s (${(numGames / elapsed).toFixed(0)} games/s)`);

  // Tile distribution
  const tileDist = {};
  for (const t of maxTiles) {
    const val = tileValue(t);
    tileDist[val] = (tileDist[val] || 0) + 1;
  }
  console.log(`  Tile distribution:`);
  const sortedTiles = Object.entries(tileDist).sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
  for (const [val, count] of sortedTiles) {
    console.log(`    ${val}: ${count} (${(count / numGames * 100).toFixed(1)}%)`);
  }

  // Reach rates
  console.log(`  Reach rates:`);
  for (const threshold of [11, 12, 13, 14]) {
    const tileVal = 1 << threshold;
    const count = maxTiles.filter(t => t >= threshold).length;
    console.log(`    ${tileVal}+: ${(count / numGames * 100).toFixed(1)}%`);
  }
}

// Random player for baseline
class RandomPlayer {
  selectMove(board) {
    const dirs = [];
    for (let dir = 0; dir < 4; dir++) {
      const after = cloneBoard(board);
      const result = move(after, dir);
      if (result.moved) dirs.push(dir);
    }
    if (dirs.length === 0) return -1;
    return dirs[Math.floor(Math.random() * dirs.length)];
  }
}

const opts = parseArgs();
const network = new NTupleNetwork();

// Try loading weights
try {
  if (opts.weights.endsWith('.bin')) {
    network.loadBinary(opts.weights);
  } else {
    network.load(opts.weights);
  }
  console.log(`Loaded weights from ${opts.weights}`);
} catch (e) {
  console.log(`Could not load weights from ${opts.weights}: ${e.message}`);
  console.log('Running with untrained network (essentially random play with structure)');
}

// Random baseline
runBenchmark(new RandomPlayer(), Math.min(opts.games, 100), 'Random Player');

// N-tuple greedy
const greedyPlayer = new GreedyPlayer(network);
runBenchmark(greedyPlayer, opts.games, 'N-tuple Greedy (1-ply)');

// Optionally run expectimax
if (opts.expectimax) {
  const expPlayer = new ExpectimaxPlayer(network, opts.depth);
  runBenchmark(expPlayer, Math.min(opts.games, 100), `N-tuple Expectimax (depth=${opts.depth})`);
}
