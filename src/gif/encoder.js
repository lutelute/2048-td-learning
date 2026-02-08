// Pure JavaScript GIF89a Encoder with LZW compression
// Supports animated GIFs with per-frame delay

export class GifEncoder {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.frames = [];
    this.globalPalette = null;
  }

  // Set global color palette: array of [r, g, b] triples
  // Must be power-of-2 length (up to 256)
  setGlobalPalette(colors) {
    // Pad to next power of 2
    let size = 2;
    while (size < colors.length) size *= 2;
    this.globalPalette = [];
    for (let i = 0; i < size; i++) {
      this.globalPalette.push(colors[i] || [0, 0, 0]);
    }
  }

  // Add a frame: pixels is a Uint8Array of palette indices, delay in centiseconds (1/100 s)
  addFrame(pixels, delay = 15) {
    if (pixels.length !== this.width * this.height) {
      throw new Error(`Frame pixel count mismatch: expected ${this.width * this.height}, got ${pixels.length}`);
    }
    this.frames.push({ pixels: new Uint8Array(pixels), delay });
  }

  // Encode to a Buffer (Node.js)
  encode() {
    const parts = [];

    // ── Header ──
    parts.push(Buffer.from('GIF89a'));

    // ── Logical Screen Descriptor ──
    const lsd = Buffer.alloc(7);
    lsd.writeUInt16LE(this.width, 0);
    lsd.writeUInt16LE(this.height, 2);
    const paletteBits = Math.log2(this.globalPalette.length);
    // packed: GCT flag(1) | color resolution(3) | sort(1) | GCT size(3)
    lsd[4] = 0x80 | ((paletteBits - 1) << 4) | (paletteBits - 1);
    lsd[5] = 0; // background color index
    lsd[6] = 0; // pixel aspect ratio
    parts.push(lsd);

    // ── Global Color Table ──
    const gct = Buffer.alloc(this.globalPalette.length * 3);
    for (let i = 0; i < this.globalPalette.length; i++) {
      gct[i * 3] = this.globalPalette[i][0];
      gct[i * 3 + 1] = this.globalPalette[i][1];
      gct[i * 3 + 2] = this.globalPalette[i][2];
    }
    parts.push(gct);

    // ── Netscape Application Extension (for looping) ──
    parts.push(Buffer.from([
      0x21, 0xFF, 0x0B, // Application Extension header
      0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, // "NETSCAPE"
      0x32, 0x2E, 0x30, // "2.0"
      0x03, 0x01, 0x00, 0x00, // loop count = 0 (infinite)
      0x00 // terminator
    ]));

    // ── Frames ──
    for (const frame of this.frames) {
      // Graphic Control Extension
      const gce = Buffer.alloc(8);
      gce[0] = 0x21; // extension introducer
      gce[1] = 0xF9; // graphic control label
      gce[2] = 0x04; // block size
      gce[3] = 0x00; // packed: no disposal, no transparency
      gce.writeUInt16LE(frame.delay, 4); // delay in centiseconds
      gce[6] = 0x00; // transparent color index (unused)
      gce[7] = 0x00; // block terminator
      parts.push(gce);

      // Image Descriptor
      const id = Buffer.alloc(10);
      id[0] = 0x2C; // image separator
      id.writeUInt16LE(0, 1); // left
      id.writeUInt16LE(0, 3); // top
      id.writeUInt16LE(this.width, 5);
      id.writeUInt16LE(this.height, 7);
      id[9] = 0x00; // packed: no local color table
      parts.push(id);

      // LZW Image Data
      const minCodeSize = Math.max(2, paletteBits);
      parts.push(Buffer.from([minCodeSize]));
      const lzwData = this._lzwCompress(frame.pixels, minCodeSize);
      parts.push(lzwData);
      parts.push(Buffer.from([0x00])); // sub-block terminator
    }

    // ── Trailer ──
    parts.push(Buffer.from([0x3B]));

    return Buffer.concat(parts);
  }

  // LZW compression returning sub-blocked data
  _lzwCompress(pixels, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;

    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    const maxDictSize = 4096;

    // Dictionary: key = prefix string, value = code
    let dict = new Map();
    for (let i = 0; i < clearCode; i++) {
      dict.set(String(i), i);
    }

    // Bit buffer for output
    let bitBuffer = 0;
    let bitsInBuffer = 0;
    const output = [];

    function writeBits(code, size) {
      bitBuffer |= (code << bitsInBuffer);
      bitsInBuffer += size;
      while (bitsInBuffer >= 8) {
        output.push(bitBuffer & 0xFF);
        bitBuffer >>= 8;
        bitsInBuffer -= 8;
      }
    }

    // Start with clear code
    writeBits(clearCode, codeSize);

    let current = String(pixels[0]);

    for (let i = 1; i < pixels.length; i++) {
      const pixel = String(pixels[i]);
      const combined = current + ',' + pixel;

      if (dict.has(combined)) {
        current = combined;
      } else {
        // Output code for current
        writeBits(dict.get(current), codeSize);

        // Add to dictionary
        if (nextCode < maxDictSize) {
          dict.set(combined, nextCode++);
          // Check if we need to increase code size
          if (nextCode > (1 << codeSize) && codeSize < 12) {
            codeSize++;
          }
        } else {
          // Dictionary full: emit clear code and reset
          writeBits(clearCode, codeSize);
          dict = new Map();
          for (let j = 0; j < clearCode; j++) {
            dict.set(String(j), j);
          }
          codeSize = minCodeSize + 1;
          nextCode = eoiCode + 1;
        }

        current = pixel;
      }
    }

    // Output remaining
    writeBits(dict.get(current), codeSize);
    writeBits(eoiCode, codeSize);

    // Flush remaining bits
    if (bitsInBuffer > 0) {
      output.push(bitBuffer & 0xFF);
    }

    // Pack into sub-blocks (max 255 bytes each)
    const blocks = [];
    let offset = 0;
    while (offset < output.length) {
      const blockSize = Math.min(255, output.length - offset);
      blocks.push(blockSize);
      for (let i = 0; i < blockSize; i++) {
        blocks.push(output[offset + i]);
      }
      offset += blockSize;
    }

    return Buffer.from(blocks);
  }
}
