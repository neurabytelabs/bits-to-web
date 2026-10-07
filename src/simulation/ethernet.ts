/**
 * Data Link Layer (L2): Ethernet II Framing & MAC Learning Switch
 */

import { SwitchNode, NetworkInterface, CamTableEntry } from '../types/network';
import { appendEthernetFCS, verifyEthernetFCS } from './crc32';

export const ETHERTYPE_IPV4 = 0x0800;
export const ETHERTYPE_ARP = 0x0806;
export const ETHERTYPE_LINK_STATE = 0x8847;

export const BROADCAST_MAC = 'FF:FF:FF:FF:FF:FF';

export interface DecodedEthernetFrame {
  dstMac: string;
  srcMac: string;
  etherType: number;
  payload: Uint8Array;
  fcsValid: boolean;
  computedCrc: number;
  receivedCrc: number;
  rawBytes: Uint8Array;
}

/**
 * Formats a 6-byte array into standard colon-separated MAC string: "02:00:00:00:01:0A"
 */
export function formatMac(bytes: Uint8Array, offset = 0): string {
  const parts: string[] = [];
  for (let i = 0; i < 6; i++) {
    parts.push((bytes[offset + i] || 0).toString(16).padStart(2, '0').toUpperCase());
  }
  return parts.join(':');
}

/**
 * Parses colon-separated MAC string into 6-byte Uint8Array.
 */
export function parseMac(macStr: string): Uint8Array {
  const parts = macStr.split(':');
  const bytes = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    bytes[i] = parseInt(parts[i] || '0', 16);
  }
  return bytes;
}

/**
 * Serializes an Ethernet II frame:
 * [Dst MAC (6B)] [Src MAC (6B)] [EtherType (2B)] [Payload (>=46B)] [FCS CRC-32 (4B)]
 */
export function serializeEthernetFrame(
  dstMac: string,
  srcMac: string,
  etherType: number,
  payload: Uint8Array
): Uint8Array {
  // Ethernet minimum payload is 46 bytes (to ensure 64-byte minimum frame size for collision detection)
  const paddedLen = Math.max(payload.length, 46);
  const frameWithoutFcs = new Uint8Array(14 + paddedLen);

  // Destination MAC
  frameWithoutFcs.set(parseMac(dstMac), 0);
  // Source MAC
  frameWithoutFcs.set(parseMac(srcMac), 6);
  // EtherType (Big Endian)
  frameWithoutFcs[12] = (etherType >> 8) & 0xff;
  frameWithoutFcs[13] = etherType & 0xff;
  // Payload
  frameWithoutFcs.set(payload, 14);

  // Append real 32-bit CRC-32
  return appendEthernetFCS(frameWithoutFcs);
}

/**
 * Deserializes an Ethernet II frame and verifies FCS.
 */
export function deserializeEthernetFrame(rawBytes: Uint8Array): DecodedEthernetFrame | null {
  if (rawBytes.length < 18) { // 14 byte header + 4 byte FCS
    return null;
  }

  const fcsCheck = verifyEthernetFCS(rawBytes);
  const dstMac = formatMac(rawBytes, 0);
  const srcMac = formatMac(rawBytes, 6);
  const etherType = (rawBytes[12] << 8) | rawBytes[13];
  const payload = rawBytes.subarray(14, rawBytes.length - 4);

  return {
    dstMac,
    srcMac,
    etherType,
    payload,
    fcsValid: fcsCheck.valid,
    computedCrc: fcsCheck.computed,
    receivedCrc: fcsCheck.received,
    rawBytes,
  };
}

/**
 * Ethernet Switch Processing:
 * 1. Reads incoming frame on inputPort.
 * 2. Checks FCS. If bad, drops frame.
 * 3. Learning step: associates srcMac with inputPort in CAM table.
 * 4. Forwarding step:
 *    - If dstMac is broadcast or unlearned: flood to all other UP ports.
 *    - If dstMac is in CAM table: forward strictly to that port (if up).
 */
export function processSwitchFrame(
  sw: SwitchNode,
  inputPort: string,
  rawFrame: Uint8Array,
  nowMs: number
): {
  forwardedPorts: string[];
  droppedReason?: string;
  decodedFrame?: DecodedEthernetFrame;
} {
  const decoded = deserializeEthernetFrame(rawFrame);
  if (!decoded) {
    return { forwardedPorts: [], droppedReason: 'MALFORMED_L2_FRAME' };
  }

  if (!decoded.fcsValid) {
    sw.interfaces[inputPort].stats.crcErrors++;
    return {
      forwardedPorts: [],
      droppedReason: `CRC32_MISMATCH (calc: 0x${decoded.computedCrc.toString(16)}, got: 0x${decoded.receivedCrc.toString(16)})`,
      decodedFrame: decoded,
    };
  }

  // 1. MAC Learning (CAM Table update)
  sw.camTable[decoded.srcMac] = {
    mac: decoded.srcMac,
    port: inputPort,
    learnedAt: nowMs,
  };

  // 2. Determine target ports
  const targetPorts: string[] = [];
  const isBroadcast = decoded.dstMac === BROADCAST_MAC;

  if (isBroadcast || !sw.camTable[decoded.dstMac]) {
    // Flood to all active interfaces except the ingress port
    for (const portName of Object.keys(sw.interfaces)) {
      if (portName !== inputPort && sw.interfaces[portName].carrierUp) {
        targetPorts.push(portName);
      }
    }
  } else {
    // Unicast forward
    const entry = sw.camTable[decoded.dstMac];
    if (entry.port !== inputPort && sw.interfaces[entry.port]?.carrierUp) {
      targetPorts.push(entry.port);
    }
  }

  return {
    forwardedPorts: targetPorts,
    decodedFrame: decoded,
  };
}
