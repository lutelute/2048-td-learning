// Training orchestrator: manages episodes, progress reporting, checkpoints

import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { NTupleNetwork } from '../network/ntuple.js';
import { playEpisode, evaluateNetwork } from './td-learning.js';

export class Trainer {
  constructor(options = {}) {
    this.totalEpisodes = options.totalEpisodes || 100000;
    this.learningRate = options.learningRate || 0.0025;
    this.evalInterval = options.evalInterval || 10000;
    this.evalGames = options.evalGames || 100;
    this.checkpointInterval = options.checkpointInterval || 50000;
    this.checkpointDir = options.checkpointDir || 'weights';
    this.lrDecayInterval = options.lrDecayInterval || 0; // 0 = no decay
    this.lrDecayFactor = options.lrDecayFactor || 0.5;
    this.resumeFrom = options.resumeFrom || null;

    this.network = new NTupleNetwork();
    this.startEpisode = 0;

    // Load checkpoint if resuming
    if (this.resumeFrom) {
      console.log(`Resuming from ${this.resumeFrom}`);
      if (this.resumeFrom.endsWith('.bin')) {
        this.network.loadBinary(this.resumeFrom);
      } else {
        this.network.load(this.resumeFrom);
      }
    }
  }

  train() {
    const stats = this.network.stats();
    console.log(`N-tuple Network: ${stats.numBasePatterns} patterns, ${stats.totalVariants} variants, ${stats.totalEntries} entries (${stats.totalMB} MB)`);
    console.log(`Training ${this.totalEpisodes} episodes, lr=${this.learningRate}`);
    console.log('---');

    // Ensure checkpoint directory
    if (!existsSync(this.checkpointDir)) {
      mkdirSync(this.checkpointDir, { recursive: true });
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

      const result = playEpisode(this.network, currentLR);

      recentScores.push(result.score);
      recentMaxTiles.push(result.maxTileLog2);
      if (recentScores.length > windowSize) {
        recentScores.shift();
        recentMaxTiles.shift();
      }

      // Progress report every evalInterval episodes
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
