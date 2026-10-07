/**
 * Network Layer (L3): IPv4 Protocol & Router Forwarding Engine (RFC 791)
 */

import { parseIp, formatIp } from './arp';
import { ForwardingEntry } from '../types/network';

export const IP_PROTO_TCP = 6;
export const IP_PROTO_UDP = 17;
export const IP_PROTO_OSPF = 89;

export interface Ipv4Packet {
  version: number;
  ihl: number;
  totalLength: number;
  identification: number;
  flags: number;
  ttl: number;
  protocol: number;
  headerChecksum: number;
  srcIp: string;
  dstIp: string;
  payload: Uint8Array;
  checksumValid: boolean;
}

let packetIdCounter = 1000;

/**
 * Calculates RFC 791 One's Complement Internet Checksum over 16-bit words.
 */
export function calculateInternetChecksum(buf: Uint8Array, offset = 0, length = buf.length): number {
  let sum = 0;
  const end = offset + length;
  for (let i = offset; i < end - 1; i += 2) {
    const word = (buf[i] << 8) | buf[i + 1];
    sum += word;
  }
  // Odd length byte padding
  if ((end - offset) % 2 === 1) {
    sum += (buf[end - 1] << 8);
  }

  // Fold 32-bit sum into 16 bits
  while (sum >> 16) {
    sum = (sum & 0xffff) + (sum >> 16);
  }

  return (~sum) & 0xffff;
}

/**
 * Serializes an IPv4 packet:
 */
export function serializeIpv4Packet(
  srcIp: string,
  dstIp: string,
  protocol: number,
  payload: Uint8Array,
  ttl = 64
): Uint8Array {
  const headerLen = 20; // 5 32-bit words
  const totalLen = headerLen + payload.length;
  const buf = new Uint8Array(totalLen);

  buf[0] = 0x45; // Version 4, IHL 5 (20 bytes)
  buf[1] = 0x00; // DSCP / ECN
  buf[2] = (totalLen >> 8) & 0xff;
  buf[3] = totalLen & 0xff;

  const id = packetIdCounter++;
  buf[4] = (id >> 8) & 0xff;
  buf[5] = id & 0xff;

  buf[6] = 0x40; // Flags: Don't Fragment (DF = 1)
  buf[7] = 0x00; // Fragment offset 0

  buf[8] = ttl;
  buf[9] = protocol;

  // Checksum bytes initially 0 for calculation
  buf[10] = 0x00;
  buf[11] = 0x00;

  buf.set(parseIp(srcIp), 12);
  buf.set(parseIp(dstIp), 16);

  // Compute checksum over 20-byte header
  const checksum = calculateInternetChecksum(buf, 0, 20);
  buf[10] = (checksum >> 8) & 0xff;
  buf[11] = checksum & 0xff;

  // Set payload
  buf.set(payload, 20);

  return buf;
}

/**
 * Deserializes an IPv4 packet and verifies header checksum.
 */
export function deserializeIpv4Packet(buf: Uint8Array): Ipv4Packet | null {
  if (buf.length < 20) return null;

  const version = (buf[0] >> 4) & 0x0f;
  const ihl = (buf[0] & 0x0f) * 4;
  if (version !== 4 || ihl < 20 || buf.length < ihl) return null;

  const totalLength = (buf[2] << 8) | buf[3];
  const identification = (buf[4] << 8) | buf[5];
  const flags = buf[6] >> 5;
  const ttl = buf[8];
  const protocol = buf[9];
  const headerChecksum = (buf[10] << 8) | buf[11];

  const srcIp = formatIp(buf, 12);
  const dstIp = formatIp(buf, 16);

  // Verify checksum: recalculating over header with checksum in place should equal 0
  const checksumCheck = calculateInternetChecksum(buf, 0, ihl);
  const checksumValid = checksumCheck === 0;

  const payload = buf.subarray(ihl, Math.min(totalLength, buf.length));

  return {
    version,
    ihl,
    totalLength,
    identification,
    flags,
    ttl,
    protocol,
    headerChecksum,
    srcIp,
    dstIp,
    payload,
    checksumValid,
  };
}

/**
 * Tests if an IP matches a given subnet and netmask.
 */
export function ipMatchesSubnet(ip: string, subnet: string, mask: string): boolean {
  const ipBytes = parseIp(ip);
  const subBytes = parseIp(subnet);
  const maskBytes = parseIp(mask);

  for (let i = 0; i < 4; i++) {
    if ((ipBytes[i] & maskBytes[i]) !== (subBytes[i] & maskBytes[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Calculates prefix length (CIDR /X) from netmask string.
 */
export function getMaskPrefixLength(mask: string): number {
  const bytes = parseIp(mask);
  let bits = 0;
  for (let i = 0; i < 4; i++) {
    let b = bytes[i];
    while (b > 0) {
      if (b & 0x80) bits++;
      b = (b << 1) & 0xff;
    }
  }
  return bits;
}

/**
 * Router Forwarding: Longest Prefix Match (LPM).
 */
export function lookupRoute(
  forwardingTable: ForwardingEntry[],
  destinationIp: string
): ForwardingEntry | null {
  let bestMatch: ForwardingEntry | null = null;
  let longestPrefix = -1;

  for (const entry of forwardingTable) {
    if (ipMatchesSubnet(destinationIp, entry.destinationSubnet, entry.netmask)) {
      const prefixLen = getMaskPrefixLength(entry.netmask);
      if (prefixLen > longestPrefix) {
        longestPrefix = prefixLen;
        bestMatch = entry;
      }
    }
  }

  return bestMatch;
}
