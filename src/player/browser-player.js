// Browser player: reads board from DOM via Playwright, uses N-tuple network for moves

import { fromGrid, toLog2 } from '../game/engine.js';
import { GreedyPlayer } from './greedy-player.js';
import { ExpectimaxPlayer } from './expectimax-player.js';

const GRID_SIZE = 5;
const DIR_KEYS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
const MOVE_DELAY = 160;

export class BrowserPlayer {
  constructor(page, network, options = {}) {
    this.page = page;
    this.network = network;
    this.useExpectimax = options.useExpectimax || false;
    this.depth = options.depth || 2;

    this.player = this.useExpectimax
      ? new ExpectimaxPlayer(network, this.depth)
      : new GreedyPlayer(network);
  }

  async readBoard() {
    return this.page.evaluate((gs) => {
      const tiles = document.querySelectorAll('.tile-slide');
      const board = Array.from({ length: gs }, () => Array(gs).fill(0));
      if (tiles.length === 0) return board;
      const ts = parseFloat(tiles[0].style.width);
      const step = ts + 8;
      for (const t of tiles) {
        const v = parseInt(t.textContent, 10);
        const r = Math.round(parseFloat(t.style.top) / step);
        const c = Math.round(parseFloat(t.style.left) / step);
        if (r >= 0 && r < gs && c >= 0 && c < gs) board[r][c] = v;
      }
      return board;
    }, GRID_SIZE);
  }

  async getScore() {
    return this.page.evaluate(() => {
      const els = document.querySelectorAll('.text-\\[22px\\]');
      return els.length > 0 ? parseInt(els[0].textContent, 10) || 0 : 0;
    });
  }

  async checkOverlay() {
    return this.page.evaluate(() => {
      const el = document.querySelector('.overlay-fade');
      if (!el || getComputedStyle(el).opacity !== '1') return { active: false };
      const isWin = el.textContent.includes('You Win');
      const isOver = el.textContent.includes('Game Over');
      return { active: true, isWin, isOver };
    });
  }

  async clickNewGame() {
    await this.page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'New Game');
      if (btn) btn.click();
    });
    await this.page.waitForTimeout(500);
  }

  async clickContinue() {
    await this.page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.overlay-fade button'))
        .find(b => b.textContent.includes('Continue'));
      if (btn) btn.click();
    });
    await this.page.waitForTimeout(300);
  }

  async playOneGame() {
    await this.clickNewGame();
    let moveCount = 0;
    let maxTileSeen = 0;

    while (true) {
      // Check overlay
      const overlay = await this.checkOverlay();
      if (overlay.active) {
        if (overlay.isOver) break;
        if (overlay.isWin) {
          await this.clickContinue();
          continue;
        }
      }

      // Read board and select move
      const grid = await this.readBoard();
      const board = fromGrid(grid);
      const dir = this.player.selectMove(board);

      if (dir === -1) break; // no valid move

      // Track max tile
      for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[i].length; j++) {
          if (grid[i][j] > maxTileSeen) maxTileSeen = grid[i][j];
        }
      }

      // Send key
      await this.page.keyboard.press(DIR_KEYS[dir]);
      await this.page.waitForTimeout(MOVE_DELAY);
      moveCount++;

      // Log progress
      if (moveCount % 50 === 0) {
        const score = await this.getScore();
        console.log(`  Move ${moveCount} | Score: ${score} | Max Tile: ${maxTileSeen}`);
      }
    }

    const finalScore = await this.getScore();
    console.log(`Game over: Score=${finalScore}, Max Tile=${maxTileSeen}, Moves=${moveCount}`);
    return { score: finalScore, maxTile: maxTileSeen, moves: moveCount };
  }
}
