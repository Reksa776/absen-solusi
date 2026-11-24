import assert from "node:assert/strict";
import test from "node:test";

import { fitImageWithin, readImageDimensions } from "./image-dimensions.js";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
}

test("IMG-1: logo persegi 512x512 menjadi 32x32 tanpa gepeng", () => {
  assert.deepEqual(readImageDimensions(png(512, 512)), {
    width: 512,
    height: 512,
  });
  assert.deepEqual(fitImageWithin(png(512, 512), 140, 32), {
    width: 32,
    height: 32,
  });
});

test("IMG-2: rasio aspek PNG dan JPEG dipertahankan", () => {
  assert.deepEqual(fitImageWithin(png(800, 200), 140, 32), {
    width: 128,
    height: 32,
  });
  assert.deepEqual(fitImageWithin(png(200, 800), 140, 32), {
    width: 8,
    height: 32,
  });
  assert.deepEqual(readImageDimensions(jpeg(400, 100)), {
    width: 400,
    height: 100,
  });
  assert.deepEqual(fitImageWithin(jpeg(400, 100), 140, 32), {
    width: 128,
    height: 32,
  });
});

test("IMG-3: gambar tak dikenal memakai fallback persegi", () => {
  assert.equal(readImageDimensions(new Uint8Array([1, 2, 3])), null);
  assert.deepEqual(fitImageWithin(new Uint8Array([1, 2, 3]), 140, 32), {
    width: 32,
    height: 32,
  });
});
