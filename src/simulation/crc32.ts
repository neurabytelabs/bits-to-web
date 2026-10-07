/**
 * Real IEEE 802.3 32-bit Cyclic Redundancy Check (CRC-32 / FCS)
 * Polynomial: 0xEDB88320 (reversed representation of 0x04C11DB7)
 * Used in standard Ethernet frame check sequences.
 */

const CRC32_TABLE = new Uint32Array(256);

// Precompute CRC32 lookup table
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Calculates 32-bit CRC checksum over a byte buffer.
 */
export function calculateCRC32(data: Uint8Array, offset = 0, length = data.length): number {
  let crc = 0xffffffff;
  const end = Math.min(offset + length, data.length);
  for (let i = offset; i < end; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Verifies if the 4-byte CRC at the end of an Ethernet frame matches the computed CRC over the payload.
 */
export function verifyEthernetFCS(frameBytes: Uint8Array): { valid: boolean; computed: number; received: number } {
  if (frameBytes.length < 4) {
    return { valid: false, computed: 0, received: 0 };
  }
  const payloadLen = frameBytes.length - 4;
  const computed = calculateCRC32(frameBytes, 0, payloadLen);
  
  // Big-endian or little-endian standard in Ethernet: 4 bytes at end
  const b0 = frameBytes[payloadLen];
  const b1 = frameBytes[payloadLen + 1];
  const b2 = frameBytes[payloadLen + 2];
  const b3 = frameBytes[payloadLen + 3];
  const received = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;

  return {
    valid: computed === received,
    computed,
    received,
  };
}

/**
 * Appends 4-byte CRC-32 to an Ethernet frame buffer.
 */
export function appendEthernetFCS(frameBytesWithoutFcs: Uint8Array): Uint8Array {
  const crc = calculateCRC32(frameBytesWithoutFcs);
  const out = new Uint8Array(frameBytesWithoutFcs.length + 4);
  out.set(frameBytesWithoutFcs, 0);
  out[frameBytesWithoutFcs.length] = (crc >>> 24) & 0xff;
  out[frameBytesWithoutFcs.length + 1] = (crc >>> 16) & 0xff;
  out[frameBytesWithoutFcs.length + 2] = (crc >>> 8) & 0xff;
  out[frameBytesWithoutFcs.length + 3] = crc & 0xff;
  return out;
}
