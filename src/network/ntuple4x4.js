// N-tuple Network for 4x4 board evaluation

import { readFileSync, writeFileSync } from 'node:fs';
import { BASE_PATTERNS, NUM_VALUES, lutSize } from './patterns4x4.js';
import { allSymmetries } from './symmetry4x4.js';

export class NTupleNetwork {
  constructor() {
    this.patterns = [];

    for (const basePattern of BASE_PATTERNS) {
      const variants = allSymmetries(basePattern);
      const size = lutSize(basePattern.length);
      this.patterns.push({
        tupleLen: basePattern.length,
        variants,
        lut: new Float32Array(size),
      });
    }

    this._totalLUTs = this.patterns.length;
    this._totalVariants = this.patterns.reduce((s, p) => s + p.variants.length, 0);
  }

  _index(board, pattern) {
    let idx = 0;
    for (let i = 0; i < pattern.length; i++) {
      idx = idx * NUM_VALUES + board[pattern[i]];
    }
    return idx;
  }

  evaluate(board) {
    let value = 0;
    for (const { variants, lut } of this.patterns) {
      for (const variant of variants) {
        value += lut[this._index(board, variant)];
      }
    }
    return value;
  }

  update(board, delta) {
    for (const { variants, lut } of this.patterns) {
      for (const variant of variants) {
        lut[this._index(board, variant)] += delta;
      }
    }
  }

  save(filepath) {
    const data = {
      version: 1,
      boardSize: 4,
      numPatterns: this.patterns.length,
      patterns: this.patterns.map(p => ({
        tupleLen: p.tupleLen,
        numVariants: p.variants.length,
        lutSize: p.lut.length,
        lut: Array.from(p.lut),
      })),
    };
    writeFileSync(filepath, JSON.stringify(data));
  }

  saveBinary(filepath) {
    let totalSize = 8;
    for (const p of this.patterns) {
      totalSize += 8 + p.lut.length * 4;
    }
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    view.setInt32(offset, 1, true); offset += 4;
    view.setInt32(offset, this.patterns.length, true); offset += 4;

    for (const p of this.patterns) {
      view.setInt32(offset, p.tupleLen, true); offset += 4;
      view.setInt32(offset, p.lut.length, true); offset += 4;
      const src = new Uint8Array(p.lut.buffer, p.lut.byteOffset, p.lut.byteLength);
      new Uint8Array(buffer, offset, src.byteLength).set(src);
      offset += src.byteLength;
    }

    writeFileSync(filepath, Buffer.from(buffer));
  }

  load(filepath) {
    const data = JSON.parse(readFileSync(filepath, 'utf-8'));
    if (data.numPatterns !== this.patterns.length) {
      throw new Error(`Pattern count mismatch: file has ${data.numPatterns}, network has ${this.patterns.length}`);
    }
    for (let i = 0; i < this.patterns.length; i++) {
      const saved = data.patterns[i];
      if (saved.lutSize !== this.patterns[i].lut.length) {
        throw new Error(`LUT size mismatch at pattern ${i}`);
      }
      this.patterns[i].lut.set(saved.lut);
    }
  }

  loadBinary(filepath) {
    const buf = readFileSync(filepath);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let offset = 0;

    const version = view.getInt32(offset, true); offset += 4;
    const numPatterns = view.getInt32(offset, true); offset += 4;

    if (numPatterns !== this.patterns.length) {
      throw new Error(`Pattern count mismatch: file has ${numPatterns}, network has ${this.patterns.length}`);
    }

    for (let i = 0; i < numPatterns; i++) {
      const tupleLen = view.getInt32(offset, true); offset += 4;
      const lutLen = view.getInt32(offset, true); offset += 4;
      if (lutLen !== this.patterns[i].lut.length) {
        throw new Error(`LUT size mismatch at pattern ${i}`);
      }
      const src = new Float32Array(buf.buffer, buf.byteOffset + offset, lutLen);
      this.patterns[i].lut.set(src);
      offset += lutLen * 4;
    }
  }

  stats() {
    let totalEntries = 0;
    let totalBytes = 0;
    for (const p of this.patterns) {
      totalEntries += p.lut.length;
      totalBytes += p.lut.byteLength;
    }
    return {
      numBasePatterns: this.patterns.length,
      totalVariants: this._totalVariants,
      totalEntries,
      totalMB: (totalBytes / (1024 * 1024)).toFixed(1),
    };
  }
}
