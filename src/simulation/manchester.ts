/**
 * Physical Layer (L1): Manchester Coding & Voltage Signaling
 * 
 * In IEEE 802.3 Ethernet:
 * - A bit 0 is signaled as High (+2.5V) followed by Low (-2.5V) -> Falling edge transition.
 * - A bit 1 is signaled as Low (-2.5V) followed by High (+2.5V) -> Rising edge transition.
 * - Preamble: 7 bytes of 10101010 (0xAA) for receiver clock synchronization.
 * - Start Frame Delimiter (SFD): 1 byte of 10101011 (0xAB) marking frame boundary.
 */

import { Bit, VoltageLevel, PhysicalSignalSample } from '../types/network';
import { appendEthernetFCS, verifyEthernetFCS } from './crc32';

export const PREAMBLE_OCTET = 0xAA; // 10101010
export const SFD_OCTET = 0xAB;      // 10101011

/**
 * Converts a byte to an array of 8 bits (MSB first).
 */
export function byteToBits(byte: number): Bit[] {
  const bits: Bit[] = [];
  for (let i = 7; i >= 0; i--) {
    bits.push(((byte >> i) & 1) as Bit);
  }
  return bits;
}

/**
 * Converts an array of 8 bits (MSB first) to a byte.
 */
export function bitsToByte(bits: Bit[], offset = 0): number {
  let val = 0;
  for (let i = 0; i < 8; i++) {
    val = (val << 1) | (bits[offset + i] || 0);
  }
  return val;
}

/**
 * Converts an entire byte buffer into a bit stream.
 */
export function bufferToBits(buffer: Uint8Array): Bit[] {
  const out: Bit[] = [];
  for (let i = 0; i < buffer.length; i++) {
    for (let j = 7; j >= 0; j--) {
      out.push(((buffer[i] >> j) & 1) as Bit);
    }
  }
  return out;
}

/**
 * Converts a bit stream (length must be multiple of 8) back into a byte buffer.
 */
export function bitsToBuffer(bits: Bit[]): Uint8Array {
  const byteCount = Math.floor(bits.length / 8);
  const out = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    out[i] = bitsToByte(bits, i * 8);
  }
  return out;
}

/**
 * Prepares a full L1 Physical Bitstream from an Ethernet MAC frame:
 * 1. Appends 4-byte CRC-32 (FCS) if not already present.
 * 2. Prepends 7 bytes of Preamble (0xAA).
 * 3. Prepends 1 byte of SFD (0xAB).
 */
export function frameToPhysicalBitstream(frameBytesWithoutFcs: Uint8Array): {
  bitsWithPreamble: Bit[];
  payloadBits: Bit[];
  fullBufferWithFcs: Uint8Array;
} {
  const fullFrame = appendEthernetFCS(frameBytesWithoutFcs);
  
  // 7 octets of preamble + 1 octet SFD = 8 octets
  const preambleAndSfd = new Uint8Array(8);
  for (let i = 0; i < 7; i++) {
    preambleAndSfd[i] = PREAMBLE_OCTET;
  }
  preambleAndSfd[7] = SFD_OCTET;

  const preambleBits = bufferToBits(preambleAndSfd);
  const payloadBits = bufferToBits(fullFrame);

  return {
    bitsWithPreamble: [...preambleBits, ...payloadBits],
    payloadBits,
    fullBufferWithFcs: fullFrame,
  };
}

/**
 * Manchester encodes a single bit into two voltage halves:
 * Bit 0: [+1, -1] (+2.5V -> -2.5V)
 * Bit 1: [-1, +1] (-2.5V -> +2.5V)
 */
export function encodeManchesterBit(bit: Bit): VoltageLevel[] {
  return bit === 1 ? [-1, 1] : [1, -1];
}

/**
 * Manchester decodes two voltage halves back to a bit:
 * [+1, -1] -> Bit 0
 * [-1, +1] -> Bit 1
 * Anything else -> Loss of clock / signal fault
 */
export function decodeManchesterSymbol(half1: VoltageLevel, half2: VoltageLevel): Bit | null {
  if (half1 === 1 && half2 === -1) return 0;
  if (half1 === -1 && half2 === 1) return 1;
  return null; // Invalid transition or idle
}

/**
 * Generates an oscilloscope sample array suitable for analog graphing.
 */
export function generateWaveformSamples(
  bits: Bit[],
  samplesPerHalfBit = 8
): PhysicalSignalSample[] {
  const samples: PhysicalSignalSample[] = [];
  let timeMs = 0;
  const timeStep = 0.5 / samplesPerHalfBit; // normalized time

  for (let bitIdx = 0; bitIdx < bits.length; bitIdx++) {
    const bit = bits[bitIdx];
    const [v1, v2] = encodeManchesterBit(bit);

    // First half of bit period
    for (let s = 0; s < samplesPerHalfBit; s++) {
      samples.push({
        voltage: v1,
        clock: s < samplesPerHalfBit / 2 ? 1 : 0,
        bitValue: bit,
        isTransition: s === 0,
        timeMs,
      });
      timeMs += timeStep;
    }

    // Second half of bit period (contains the mandatory clock synchronization edge)
    for (let s = 0; s < samplesPerHalfBit; s++) {
      samples.push({
        voltage: v2,
        clock: s < samplesPerHalfBit / 2 ? 1 : 0,
        bitValue: bit,
        isTransition: s === 0, // Mid-bit transition!
        timeMs,
      });
      timeMs += timeStep;
    }
  }

  return samples;
}

/**
 * Physical Receiver: Searches bit stream for preamble + SFD pattern (0xAA... 0xAB),
 * extracts the serialized Ethernet frame bytes, and verifies CRC-32.
 */
export function decodePhysicalBitstream(bits: Bit[]): {
  success: boolean;
  frameBytes?: Uint8Array;
  crcValid?: boolean;
  error?: string;
} {
  if (bits.length < 64) { // Minimum 8 bytes (preamble + SFD)
    return { success: false, error: 'Bitstream too short (< 64 bits)' };
  }

  // Look for SFD pattern: 10101011
  let sfdIndex = -1;
  for (let i = 0; i <= bits.length - 8; i++) {
    const byte = bitsToByte(bits, i);
    if (byte === SFD_OCTET) {
      // Check if preceded by at least some preamble (0xAA)
      sfdIndex = i + 8; // Data begins right after SFD
      break;
    }
  }

  if (sfdIndex === -1) {
    return { success: false, error: 'Start Frame Delimiter (SFD 0xAB) not detected' };
  }

  const payloadBits = bits.slice(sfdIndex);
  if (payloadBits.length < 14 * 8 + 32) { // 14 bytes eth header + 4 bytes FCS
    return { success: false, error: 'Frame payload shorter than minimal Ethernet header + FCS' };
  }

  const frameBytes = bitsToBuffer(payloadBits);
  const fcsCheck = verifyEthernetFCS(frameBytes);

  return {
    success: true,
    frameBytes,
    crcValid: fcsCheck.valid,
  };
}
