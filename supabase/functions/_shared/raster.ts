// Pure JavaScript codecs: no native binaries, FFI, remote WASM or cold-start fetches.
import jpeg from "npm:jpeg-js@0.4.4";
import { read as readPng } from "npm:pngjs@7.0.0/lib/png-sync.js";
import { Buffer } from "node:buffer";
export type Raster = { width: number; height: number; data: Uint8Array };
export function decodePhoto(bytes: Uint8Array): Raster {
  if (bytes.length > 5 * 1024 * 1024) throw new Error("image_too_large");
  if (bytes[0] === 0xff && bytes[1] === 0xd8)
    return jpeg.decode(bytes, {
      useTArray: true,
      maxResolutionInMP: 20,
      maxMemoryUsageInMB: 128,
    });
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x)
  ) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      w = v.getUint32(16),
      h = v.getUint32(20);
    if (!w || !h || w * h > 20_000_000) throw new Error("invalid_photo");
    const result = readPng(Buffer.from(bytes), { checkCRC: true });
    return {
      width: result.width,
      height: result.height,
      data: new Uint8Array(result.data),
    };
  }
  throw new Error("unsupported_photo");
}
const rgb = (hex: string) => {
  const c = parseInt(hex.replace("#", ""), 16);
  return [c >>> 16, (c >>> 8) & 255, c & 255];
};
export function renderPhoto(
  source: Raster,
  background: string,
  border: string | null,
): Uint8Array {
  const width = 600,
    height = 760,
    out = new Uint8Array(width * height * 4),
    base = rgb(background);
  for (let p = 0; p < out.length; p += 4) {
    out[p] = base[0];
    out[p + 1] = base[1];
    out[p + 2] = base[2];
    out[p + 3] = 255;
  }
  const dw = 552,
    dh = 688,
    scale = Math.max(dw / source.width, dh / source.height),
    ox = (source.width - dw / scale) / 2,
    oy = (source.height - dh / scale) / 2;
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      // Round the photo corners while preserving the full face crop.
      const cx = x < 16 ? 16 - x : x > dw - 17 ? x - (dw - 17) : 0,
        cy = y < 16 ? 16 - y : y > dh - 17 ? y - (dh - 17) : 0;
      if (cx && cy && cx * cx + cy * cy > 256) continue;
      const sx = Math.min(source.width - 1, Math.floor(ox + x / scale)),
        sy = Math.min(source.height - 1, Math.floor(oy + y / scale)),
        s = (sy * source.width + sx) * 4,
        d = ((y + 36) * width + x + 24) * 4;
      const a = source.data[s + 3] / 255;
      for (let c = 0; c < 3; c++)
        out[d + c] = Math.round(source.data[s + c] * a + base[c] * (1 - a));
    }
  if (border) {
    const color = rgb(border);
    for (let y = 30; y < 730; y++)
      for (let x = 18; x < 582; x++)
        if (y < 36 || y >= 724 || x < 24 || x >= 576) {
          const p = (y * width + x) * 4;
          out[p] = color[0];
          out[p + 1] = color[1];
          out[p + 2] = color[2];
        }
  }
  return new Uint8Array(jpeg.encode({ data: out, width, height }, 85).data);
}
