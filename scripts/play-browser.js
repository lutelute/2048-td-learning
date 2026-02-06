#!/usr/bin/env node
// Browser play: uses Playwright to play the actual 2048 game
// Usage: node scripts/play-browser.js [--weights PATH] [--url URL] [--games N] [--expectimax] [--depth N]

import { chromium } from 'playwright';
import { NTupleNetwork } from '../src/network/ntuple.js';
import { BrowserPlayer } from '../src/player/browser-player.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    weights: 'weights/final.bin',
    url: 'http://localhost:5173/2048_project/',
    games: 1,
    expectimax: false,
    depth: 2,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--weights': opts.weights = args[++i]; break;
      case '--url': opts.url = args[++i]; break;
      case '--games': opts.games = parseInt(args[++i]); break;
      case '--expectimax': opts.expectimax = true; break;
      case '--depth': opts.depth = parseInt(args[++i]); break;
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  // Load network
  const network = new NTupleNetwork();
  try {
    if (opts.weights.endsWith('.bin')) {
      network.loadBinary(opts.weights);
    } else {
      network.load(opts.weights);
    }
    console.log(`Loaded weights from ${opts.weights}`);
  } catch (e) {
    console.error(`Failed to load weights: ${e.message}`);
    process.exit(1);
  }

  // Launch browser
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 520, height: 680 } });
  await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 10000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle', timeout: 10000 });

  const player = new BrowserPlayer(page, network, {
    useExpectimax: opts.expectimax,
    depth: opts.depth,
  });

  const results = [];
  for (let i = 0; i < opts.games; i++) {
    console.log(`\n--- Game ${i + 1}/${opts.games} ---`);
    const result = await player.playOneGame();
    results.push(result);
  }

  // Summary
  if (results.length > 1) {
    console.log('\n=== Summary ===');
    const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
    const maxScore = Math.max(...results.map(r => r.score));
    const maxTile = Math.max(...results.map(r => r.maxTile));
    console.log(`Games: ${results.length}`);
    console.log(`Avg Score: ${Math.round(avgScore)}`);
    console.log(`Max Score: ${maxScore}`);
    console.log(`Max Tile:  ${maxTile}`);
  }

  await browser.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
