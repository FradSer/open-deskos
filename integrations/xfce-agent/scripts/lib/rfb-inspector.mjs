const WIDTH = 1280;
const HEIGHT = 800;
const LIMIT = 8 * 1024 * 1024;
const HEADER_POINTS = [[850, 65], [900, 65], [1000, 65], [1100, 65]];

/** Fixed fixture regression probe. Private framebuffer bytes never leave this object.
 * This detects the fixture's known white password bubble, not arbitrary overlays.
 */
export class RfbFixtureInspector {
  #rgb;
  #coverage;
  #header = Buffer.alloc(16);
  #have = 0;
  #mode = 'message';
  #remaining = 0;
  #rectangle;
  #pixel = Buffer.alloc(4);
  #pixelHave = 0;
  #covered = 0;
  #updateBytes = 0;
  #complete = false;
  #frameNumber = 0;
  #failed = false;
  #bigEndian;
  #shifts;

  constructor({ pixelFormat, width, height }) {
    if (width !== WIDTH || height !== HEIGHT || !Buffer.isBuffer(pixelFormat) || pixelFormat.length !== 16) throw Error('Unsupported fixture framebuffer');
    const shifts = [pixelFormat[10], pixelFormat[11], pixelFormat[12]];
    if (pixelFormat[0] !== 32 || ![24, 32].includes(pixelFormat[1]) || ![0, 1].includes(pixelFormat[2]) || pixelFormat[3] !== 1 || [4, 6, 8].some(offset => pixelFormat.readUInt16BE(offset) !== 255) || shifts.some(shift => ![0, 8, 16, 24].includes(shift)) || new Set(shifts).size !== 3) throw Error('Unsupported fixture pixel format');
    this.#bigEndian = pixelFormat[2] === 1;
    this.#shifts = shifts;
    this.#rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
    this.#coverage = new Uint8Array(WIDTH * HEIGHT);
  }

  #read(bytes, offset, size) {
    const count = Math.min(size - this.#have, bytes.length - offset);
    bytes.copy(this.#header, this.#have, offset, offset + count);
    this.#have += count;
    return offset + count;
  }

  #next(mode) { this.#mode = mode; this.#have = 0; }

  #finishRectangle() {
    this.#remaining--;
    if (this.#remaining) this.#next('rectangle');
    else {
      this.#frameNumber++;
      this.#complete = this.#covered === WIDTH * HEIGHT;
      this.#next('message');
    }
  }

  #putPixel(bytes, offset) {
    const value = this.#bigEndian ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset);
    const rectangle = this.#rectangle;
    const pixel = (rectangle.y + Math.floor(rectangle.index / rectangle.width)) * WIDTH + rectangle.x + rectangle.index % rectangle.width;
    const rgb = pixel * 3;
    for (let channel = 0; channel < 3; channel++) this.#rgb[rgb + channel] = (value >>> this.#shifts[channel]) & 255;
    if (!this.#coverage[pixel]) { this.#coverage[pixel] = 1; this.#covered++; }
    rectangle.index++;
    if (rectangle.index === rectangle.width * rectangle.height) this.#finishRectangle();
  }

  feed(bytes) {
    if (this.#failed) throw Error('Fixture framebuffer inspector is closed');
    try {
      if (!Buffer.isBuffer(bytes) || bytes.length > LIMIT) throw Error('RFB input limit exceeded');
      let offset = 0;
      while (offset < bytes.length) {
        if (this.#mode === 'skip') {
          const count = Math.min(this.#remaining, bytes.length - offset);
          offset += count; this.#remaining -= count;
          if (!this.#remaining) this.#next('message');
        } else if (this.#mode === 'pixels') {
          if (this.#pixelHave || bytes.length - offset < 4) {
            const count = Math.min(4 - this.#pixelHave, bytes.length - offset);
            bytes.copy(this.#pixel, this.#pixelHave, offset, offset + count);
            offset += count; this.#pixelHave += count;
            if (this.#pixelHave === 4) { this.#pixelHave = 0; this.#putPixel(this.#pixel, 0); this.#pixel.fill(0); }
          } else { this.#putPixel(bytes, offset); offset += 4; }
        } else {
          const size = this.#mode === 'message' ? 1 : this.#mode === 'update' ? 3 : this.#mode === 'rectangle' ? 12 : 7;
          offset = this.#read(bytes, offset, size);
          if (this.#have !== size) continue;
          if (this.#mode === 'message') {
            const type = this.#header[0];
            if (type === 0) { this.#complete = false; this.#coverage.fill(0); this.#covered = 0; this.#updateBytes = 4; this.#next('update'); }
            else if (type === 2) this.#next('message');
            else if (type === 3) this.#next('clipboard');
            else throw Error('Unsupported RFB server message');
          } else if (this.#mode === 'update') {
            this.#remaining = this.#header.readUInt16BE(1);
            if (this.#remaining > 256) throw Error('RFB rectangle limit exceeded');
            if (!this.#remaining) { this.#frameNumber++; this.#next('message'); }
            else this.#next('rectangle');
          } else if (this.#mode === 'rectangle') {
            const x = this.#header.readUInt16BE(0), y = this.#header.readUInt16BE(2), width = this.#header.readUInt16BE(4), height = this.#header.readUInt16BE(6);
            if (!width || !height || x + width > WIDTH || y + height > HEIGHT || this.#header.readInt32BE(8) !== 0) throw Error('Unsupported RFB rectangle');
            this.#updateBytes += 12 + width * height * 4;
            if (this.#updateBytes > LIMIT) throw Error('RFB framebuffer update limit exceeded');
            this.#rectangle = { x, y, width, height, index: 0 };
            this.#next('pixels');
          } else {
            this.#remaining = this.#header.readUInt32BE(3);
            if (this.#remaining > LIMIT) throw Error('RFB clipboard limit exceeded');
            this.#header.fill(0);
            this.#next(this.#remaining ? 'skip' : 'message');
          }
        }
      }
    } catch (error) { this.dispose(); throw error; }
  }

  reportFixtureHeader() {
    const complete = this.#complete && !this.#failed;
    const passwordBubbleAbsent = complete && HEADER_POINTS.every(([x, y]) => {
      const offset = (y * WIDTH + x) * 3;
      return this.#rgb[offset] < 96 && this.#rgb[offset + 1] < 96 && this.#rgb[offset + 2] < 112;
    });
    return { frameNumber: this.#frameNumber, complete, passwordBubbleAbsent };
  }

  dispose() {
    this.#failed = true; this.#complete = false;
    this.#rgb.fill(0); this.#coverage.fill(0); this.#header.fill(0); this.#pixel.fill(0);
    this.#rectangle = undefined;
  }
}
