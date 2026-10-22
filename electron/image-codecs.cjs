// Uncompressed BMP / ICO DIB → RGBA. Covers 1/4/8/24/32-bit, which is what
// Windows writes; RLE and bitfield variants other than plain BGRA are rare.
function decodeDib(buf, offset, { fileHeader, icon }) {
  if (!Buffer.isBuffer(buf) || offset < 0 || buf.length < offset + 40) throw new Error('Truncated image header');
  if (fileHeader && (buf.length < 54 || buf.toString('ascii', 0, 2) !== 'BM')) throw new Error('Invalid BMP header');
  const pixelOffset = fileHeader ? buf.readUInt32LE(10) : null;
  const h = offset;
  const headerSize = buf.readUInt32LE(h);
  if (headerSize < 40 || h + headerSize > buf.length) throw new Error('Invalid DIB header size');
  const width = buf.readInt32LE(h + 4);
  let height = buf.readInt32LE(h + 8);
  if (icon) height /= 2; // XOR mask + AND mask
  const bpp = buf.readUInt16LE(h + 14);
  const compression = buf.readUInt32LE(h + 16);
  if (compression !== 0 && compression !== 3) throw new Error('Compressed BMP files are not supported');
  const topDown = height < 0;
  height = Math.abs(height);
  if (!Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 32 * 1024 * 1024) throw new Error('Invalid image dimensions (maximum 32 megapixels)');
  if (buf.readUInt16LE(h + 12) !== 1 || ![1, 4, 8, 16, 24, 32].includes(bpp)) throw new Error('Unsupported image bit depth');
  if (compression === 3 && bpp !== 16 && bpp !== 32) throw new Error('Invalid bitfield image');
  const colors = bpp <= 8 ? (buf.readUInt32LE(h + 32) || 1 << bpp) : 0;
  const palette = h + headerSize + (compression === 3 && headerSize === 40 ? 12 : 0);
  const data = pixelOffset ?? palette + colors * 4;
  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  if (colors > (1 << bpp) && bpp <= 8) throw new Error('Invalid image palette');
  if (data < palette + colors * 4 || data + stride * height > buf.length) throw new Error('Truncated image pixels or palette');
  const out = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = data + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let b, g, r, a = 255;
      if (bpp === 32) { b = buf[row + x * 4]; g = buf[row + x * 4 + 1]; r = buf[row + x * 4 + 2]; a = buf[row + x * 4 + 3]; if (a) anyAlpha = true; }
      else if (bpp === 24) { b = buf[row + x * 3]; g = buf[row + x * 3 + 1]; r = buf[row + x * 3 + 2]; }
      else if (bpp === 16) { const v = buf.readUInt16LE(row + x * 2); r = ((v >> 10) & 31) * 8; g = ((v >> 5) & 31) * 8; b = (v & 31) * 8; }
      else {
        const perByte = 8 / bpp;
        const byte = buf[row + Math.floor(x / perByte)];
        const index = (byte >> ((perByte - 1 - (x % perByte)) * bpp)) & ((1 << bpp) - 1);
        if (index >= colors) throw new Error('Invalid palette index');
        const p = palette + index * 4;
        b = buf[p]; g = buf[p + 1]; r = buf[p + 2];
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  // 32-bit BMPs often leave alpha at zero; treat them as opaque.
  if (bpp === 32 && !anyAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { width, height, data: out };
}

function decodeIco(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('Invalid ICO header');
  const count = buf.readUInt16LE(4);
  if (!count || count > 1024 || 6 + count * 16 > buf.length) throw new Error('Invalid ICO directory');
  let best = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const entry = { width: buf[e] || 256, size: buf.readUInt32LE(e + 8), offset: buf.readUInt32LE(e + 12) };
    if (entry.size < 4 || entry.offset < 6 + count * 16 || entry.offset + entry.size > buf.length) throw new Error('Invalid ICO image bounds');
    if (!best || entry.width > best.width) best = entry;
  }
  if (!best) throw new Error('Empty icon file');
  const image = buf.subarray(best.offset, best.offset + best.size);
  if (image.readUInt32BE(0) === 0x89504e47) return { png: image };
  return decodeDib(image, 0, { icon: true });
}


module.exports = { decodeDib, decodeIco };
