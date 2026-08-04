/**
 * Read image kind and pixel dimensions from JPEG/PNG headers without decoding
 * the bitmap. Decoding a 4K image inflates to a ~67MB bitmap plus codec
 * workspace — enough to blow an action's memory cap — so metadata is sniffed
 * from a few bytes. Also the validation gate for sandbox-produced files, which
 * are untrusted bytes until proven to be a real PNG/JPEG.
 */
export function sniffImage(
  bytes: Uint8Array,
): { mimeType: "image/png" | "image/jpeg"; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: 8-byte signature, then IHDR with width/height at offsets 16/20.
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk the marker stream to the first SOFn frame header.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSOF) {
        return {
          mimeType: "image/jpeg",
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }
  return null;
}

/** Above this, a Jimp decode risks the action's memory cap — never decode. */
export const MAX_DECODE_PIXELS = 9_000_000;
