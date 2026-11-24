export type ImageDimensions = {
  width: number;
  height: number;
};

export type FittedImageSize = {
  width: number;
  height: number;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readPng(view: DataView): ImageDimensions | null {
  if (view.byteLength < 24) return null;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (view.getUint8(index) !== (PNG_SIGNATURE[index] ?? -1)) return null;
  }
  if (view.getUint32(8) !== 13) return null;
  const chunkType = String.fromCharCode(
    view.getUint8(12),
    view.getUint8(13),
    view.getUint8(14),
    view.getUint8(15),
  );
  if (chunkType !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpeg(view: DataView): ImageDimensions | null {
  if (view.byteLength < 4) return null;
  if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Marker tanpa panjang segmen.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;

    const length = view.getUint16(offset + 2);
    if (length < 2 || offset + 2 + length > view.byteLength) return null;
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) return null;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Membaca dimensi asli PNG (IHDR) atau JPEG (SOF0/SOF2 dan varian SOF lain)
 * langsung dari bytes, tanpa dependency gambar eksternal.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 4) return null;
  const view = viewOf(bytes);
  if (view.getUint8(0) === 0x89) return readPng(view);
  if (view.getUint8(0) === 0xff && view.getUint8(1) === 0xd8) return readJpeg(view);
  return null;
}

/**
 * Menjaga rasio aspek asli: skala ditentukan oleh batas tinggi dan lebar.
 * Gambar persegi 512x512 pada max 140x32 menghasilkan 32x32, bukan gepeng.
 */
export function fitImageWithin(
  bytes: Uint8Array,
  maxWidth: number,
  maxHeight: number,
): FittedImageSize {
  const widthLimit = Math.max(1, Math.floor(maxWidth));
  const heightLimit = Math.max(1, Math.floor(maxHeight));
  const dimensions = readImageDimensions(bytes);
  if (!dimensions) {
    // Dimensi tidak dikenal: fallback persegi agar tidak pernah gepeng.
    const side = Math.min(widthLimit, heightLimit);
    return { width: side, height: side };
  }
  const scale = Math.min(
    heightLimit / dimensions.height,
    widthLimit / dimensions.width,
  );
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
}
