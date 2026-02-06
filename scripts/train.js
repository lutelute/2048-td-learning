#!/usr/bin/env node
// Training script: node scripts/train.js [options]
// Options:
//   --episodes N       Total episodes (default: 100000)
//   --lr N             Learning rate (default: 0.0025)
//   --eval-interval N  Eval every N episodes (default: 10000)
//   --checkpoint-interval N  Save every N episodes (default: 50000)
//   --lr-decay-interval N    Decay LR every N episodes (0=off, default: 0)
//   --lr-decay-factor N      LR decay factor (default: 0.5)
//   --resume PATH      Resume from checkpoint file

import { Trainer } from '../src/training/trainer.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const val = args[i + 1];
    switch (key) {
      case '--episodes': opts.totalEpisodes = parseInt(val); break;
      case '--lr': opts.learningRate = parseFloat(val); break;
      case '--eval-interval': opts.evalInterval = parseInt(val); break;
      case '--checkpoint-interval': opts.checkpointInterval = parseInt(val); break;
      case '--lr-decay-interval': opts.lrDecayInterval = parseInt(val); break;
      case '--lr-decay-factor': opts.lrDecayFactor = parseFloat(val); break;
      case '--resume': opts.resumeFrom = val; break;
      default:
        console.error(`Unknown option: ${key}`);
        process.exit(1);
    }
  }
  return opts;
}

const opts = parseArgs();
const trainer = new Trainer(opts);
trainer.train();
