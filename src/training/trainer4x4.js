// Training orchestrator for 4x4: manages episodes, progress, checkpoints, and GIF recording

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NTupleNetwork } from '../network/ntuple4x4.js';
import { playEpisode, evaluateNetwork } from './td-learning4x4.js';
import { createBoard, move, cloneBoard, canMove, addRandomTile, maxTile } from '../game/engine4x4.js';
import { GifEncoder } from '../gif/encoder.js';
import { renderBoard, PALETTE, IMAGE_WIDTH, IMAGE_HEIGHT } from '../gif/board-renderer.js';

export class Trainer {
  constructor(options = {}) {
    this.totalEpisodes = options.totalEpisodes || 100000;
    this.learningRate = options.learningRate || 0.001;
    this.evalInterval = options.evalInterval || 5000;
    this.evalGames = options.evalGames || 100;
    this.checkpointInterval = options.checkpointInterval || 25000;
    this.checkpointDir = options.checkpointDir || 'weights4x4';
    this.gifDir = options.gifDir || 'gifs';
    this.lrDecayInterval = options.lrDecayInterval || 0;
    this.lrDecayFactor = options.lrDecayFactor || 0.5;
    this.resumeFrom = options.resumeFrom || null;

    // GIF recording milestones
    this.gifMilestones = new Set([0, 1000, 5000, 10000, 25000, 50000, 75000, 100000]);

    this.network = new NTupleNetwork();
    this.startEpisode = 0;
    this.bestScore = 0;

    if (this.resumeFrom) {
      console.log(`Resuming from ${this.resumeFrom}`);
      if (this.resumeFrom.endsWith('.bin')) {
        this.network.loadBinary(this.resumeFrom);
      } else {
        this.network.load(this.resumeFrom);
      }
    }
  }

  // Play a game and record every step for GIF
  _playRecordedGame() {
    const board = createBoard();
    const steps = [{ board: new Uint8Array(board), score: 0 }];
    let score = 0;

    while (true) {
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

      if (bestDir === -1) break;

      const result = move(board, bestDir);
      score += result.reward;
      addRandomTile(board);

      steps.push({ board: new Uint8Array(board), score });

      if (!canMove(board)) break;
    }

    return { steps, score, maxTileLog2: maxTile(board) };
  }

  // Record a game as GIF
  _recordGif(episode, label) {
    const game = this._playRecordedGame();
    const gif = new GifEncoder(IMAGE_WIDTH, IMAGE_HEIGHT);
    gif.setGlobalPalette(PALETTE);

    // Sample frames to keep GIF size manageable (max ~200 frames)
    const maxFrames = 200;
    const totalSteps = game.steps.length;
    let selectedSteps;

    if (totalSteps <= maxFrames) {
      selectedSteps = game.steps;
    } else {
      // Evenly sample + always include first and last
      selectedSteps = [game.steps[0]];
      const step = (totalSteps - 1) / (maxFrames - 1);
      for (let i = 1; i < maxFrames - 1; i++) {
        selectedSteps.push(game.steps[Math.round(i * step)]);
      }
      selectedSteps.push(game.steps[totalSteps - 1]);
    }

    for (let i = 0; i < selectedSteps.length; i++) {
      const s = selectedSteps[i];
      const pixels = renderBoard(s.board, s.score);
      // Last frame holds for 3 seconds, others 150ms
      const delay = (i === selectedSteps.length - 1) ? 300 : 15;
      gif.addFrame(pixels, delay);
    }

    const buf = gif.encode();
    const tileVal = 1 << game.maxTileLog2;
    const filename = `ep${episode}_${label}_score${game.score}_tile${tileVal}.gif`;
    const filepath = join(this.gifDir, filename);
    writeFileSync(filepath, buf);
    console.log(`  GIF saved: ${filename} (${selectedSteps.length} frames, ${(buf.length / 1024).toFixed(0)}KB)`);
  }

  train() {
    const stats = this.network.stats();
    console.log(`N-tuple Network (4x4): ${stats.numBasePatterns} patterns, ${stats.totalVariants} variants, ${stats.totalEntries} entries (${stats.totalMB} MB)`);
    console.log(`Training ${this.totalEpisodes} episodes, lr=${this.learningRate}`);
    console.log('---');

    // Ensure directories
    if (!existsSync(this.checkpointDir)) {
      mkdirSync(this.checkpointDir, { recursive: true });
    }
    if (!existsSync(this.gifDir)) {
      mkdirSync(this.gifDir, { recursive: true });
    }

    const windowSize = 1000;
    const recentScores = [];
    const recentMaxTiles = [];
    let totalStartTime = Date.now();
    let windowStartTime = Date.now();
    let currentLR = this.learningRate;

    for (let ep = this.startEpisode; ep < this.totalEpisodes; ep++) {
      // Learning rate decay
      if (this.lrDecayInterval > 0 && ep > 0 && ep % this.lrDecayInterval === 0) {
        currentLR *= this.lrDecayFactor;
        console.log(`  LR decayed to ${currentLR.toExponential(2)}`);
      }

      // GIF recording at milestones
      if (this.gifMilestones.has(ep)) {
        console.log(`  Recording GIF at episode ${ep}...`);
        this._recordGif(ep, 'milestone');
      }

      const result = playEpisode(this.network, currentLR);

      recentScores.push(result.score);
      recentMaxTiles.push(result.maxTileLog2);
      if (recentScores.length > windowSize) {
        recentScores.shift();
        recentMaxTiles.shift();
      }

      // Best score GIF recording
      if (result.score > this.bestScore) {
        this.bestScore = result.score;
        // Only record GIF for significant improvements (avoid too many)
        if (ep > 100 && (ep % 100 === 0 || result.score > this.bestScore * 1.1)) {
          console.log(`  New best score: ${result.score} at episode ${ep}`);
          this._recordGif(ep, 'best');
        }
      }

      // Progress report
      if ((ep + 1) % this.evalInterval === 0) {
        const elapsed = (Date.now() - windowStartTime) / 1000;
        const totalElapsed = (Date.now() - totalStartTime) / 1000;
        const eps = this.evalInterval / elapsed;
        const avgScore = recentScores.reduce((s, v) => s + v, 0) / recentScores.length;
        const maxTileVal = 1 << Math.max(...recentMaxTiles);

        console.log(
          `Episode ${ep + 1}/${this.totalEpisodes} | ` +
          `Avg Score: ${Math.round(avgScore)} | ` +
          `Max Tile: ${maxTileVal} | ` +
          `Speed: ${eps.toFixed(0)} ep/s | ` +
          `LR: ${currentLR.toExponential(2)} | ` +
          `Time: ${formatTime(totalElapsed)}`
        );

        // Detailed evaluation
        if ((ep + 1) % (this.evalInterval * 5) === 0 || ep + 1 === this.totalEpisodes) {
          console.log(`  Running ${this.evalGames}-game evaluation...`);
          const evalResult = evaluateNetwork(this.network, this.evalGames);
          console.log(`  Eval Avg Score: ${Math.round(evalResult.avgScore)} | Med Score: ${Math.round(evalResult.medScore)}`);
          console.log(`  Reach rates: ${JSON.stringify(evalResult.reachRates)}`);
          console.log(`  Tile dist: ${JSON.stringify(evalResult.tileDist)}`);
        }

        windowStartTime = Date.now();
      }

      // Checkpoint
      if ((ep + 1) % this.checkpointInterval === 0) {
        const path = join(this.checkpointDir, `checkpoint-${ep + 1}.bin`);
        this.network.saveBinary(path);
        console.log(`  Checkpoint saved: ${path}`);
      }
    }

    // Final GIF at completion
    if (!this.gifMilestones.has(this.totalEpisodes)) {
      console.log('  Recording final GIF...');
      this._recordGif(this.totalEpisodes, 'final');
    }

    // Final save
    const finalPath = join(this.checkpointDir, 'final.bin');
    this.network.saveBinary(finalPath);
    console.log(`\nTraining complete. Final weights saved to ${finalPath}`);

    // Final evaluation
    console.log(`\nFinal evaluation (${this.evalGames * 10} games)...`);
    const finalEval = evaluateNetwork(this.network, this.evalGames * 10);
    console.log(`Avg Score: ${Math.round(finalEval.avgScore)} | Med Score: ${Math.round(finalEval.medScore)}`);
    console.log(`Reach rates: ${JSON.stringify(finalEval.reachRates)}`);
    console.log(`Tile distribution: ${JSON.stringify(finalEval.tileDist)}`);

    return this.network;
  }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}
