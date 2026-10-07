/**
 * Transport Layer (L4): Transmission Control Protocol (TCP - RFC 793)
 * Full state machine, three-way handshake, sliding window, retransmissions (RTO).
 */

import { parseIp } from './arp';
import { calculateInternetChecksum } from './ip';

export interface TcpFlags {
  fin: boolean;
  syn: boolean;
  rst: boolean;
  psh: boolean;
  ack: boolean;
  urg: boolean;
}

export interface DecodedTcpSegment {
  srcPort: number;
  dstPort: number;
  seqNumber: number;
  ackNumber: number;
  dataOffset: number;
  flags: TcpFlags;
  windowSize: number;
  checksum: number;
  urgentPointer: number;
  payload: Uint8Array;
  checksumValid: boolean;
  rawBytes: Uint8Array;
}

/**
 * Calculates TCP Checksum over IPv4 Pseudo-Header + TCP Header + TCP Payload.
 */
export function calculateTcpChecksum(
  srcIp: string,
  dstIp: string,
  tcpBytes: Uint8Array
): number {
  // Pseudo-header:
  // [Src IP 4B] [Dst IP 4B] [Zero 1B] [Proto 6 1B] [TCP Length 2B] = 12 Bytes
  const pseudoLen = 12 + tcpBytes.length;
  const pseudoBuf = new Uint8Array(pseudoLen);

  pseudoBuf.set(parseIp(srcIp), 0);
  pseudoBuf.set(parseIp(dstIp), 4);
  pseudoBuf[8] = 0;
  pseudoBuf[9] = 6; // IP_PROTO_TCP
  pseudoBuf[10] = (tcpBytes.length >> 8) & 0xff;
  pseudoBuf[11] = tcpBytes.length & 0xff;

  pseudoBuf.set(tcpBytes, 12);

  return calculateInternetChecksum(pseudoBuf);
}

/**
 * Serializes a TCP segment.
 */
export function serializeTcpSegment(
  srcIp: string,
  dstIp: string,
  srcPort: number,
  dstPort: number,
  seqNumber: number,
  ackNumber: number,
  flags: Partial<TcpFlags>,
  windowSize: number,
  payload: Uint8Array = new Uint8Array(0)
): Uint8Array {
  const headerLen = 20; // 5 32-bit words
  const totalLen = headerLen + payload.length;
  const buf = new Uint8Array(totalLen);

  buf[0] = (srcPort >> 8) & 0xff;
  buf[1] = srcPort & 0xff;
  buf[2] = (dstPort >> 8) & 0xff;
  buf[3] = dstPort & 0xff;

  // 32-bit Sequence Number
  buf[4] = (seqNumber >>> 24) & 0xff;
  buf[5] = (seqNumber >>> 16) & 0xff;
  buf[6] = (seqNumber >>> 8) & 0xff;
  buf[7] = seqNumber & 0xff;

  // 32-bit Acknowledgment Number
  buf[8] = (ackNumber >>> 24) & 0xff;
  buf[9] = (ackNumber >>> 16) & 0xff;
  buf[10] = (ackNumber >>> 8) & 0xff;
  buf[11] = ackNumber & 0xff;

  // Data offset (5 words = 20 bytes) in high 4 bits
  buf[12] = (5 << 4) & 0xf0;

  // Flags byte
  let flagsByte = 0;
  if (flags.fin) flagsByte |= 0x01;
  if (flags.syn) flagsByte |= 0x02;
  if (flags.rst) flagsByte |= 0x04;
  if (flags.psh) flagsByte |= 0x08;
  if (flags.ack) flagsByte |= 0x10;
  if (flags.urg) flagsByte |= 0x20;
  buf[13] = flagsByte;

  // Window Size
  buf[14] = (windowSize >> 8) & 0xff;
  buf[15] = windowSize & 0xff;

  // Checksum initially 0
  buf[16] = 0;
  buf[17] = 0;

  // Urgent pointer 0
  buf[18] = 0;
  buf[19] = 0;

  // Payload
  if (payload.length > 0) {
    buf.set(payload, 20);
  }

  // Calculate Checksum with Pseudo Header
  const checksum = calculateTcpChecksum(srcIp, dstIp, buf);
  buf[16] = (checksum >> 8) & 0xff;
  buf[17] = checksum & 0xff;

  return buf;
}

/**
 * Deserializes a TCP segment.
 */
export function deserializeTcpSegment(
  buf: Uint8Array,
  srcIp: string,
  dstIp: string
): DecodedTcpSegment | null {
  if (buf.length < 20) return null;

  const srcPort = (buf[0] << 8) | buf[1];
  const dstPort = (buf[2] << 8) | buf[3];

  const seqNumber =
    ((buf[4] << 24) | (buf[5] << 16) | (buf[6] << 8) | buf[7]) >>> 0;
  const ackNumber =
    ((buf[8] << 24) | (buf[9] << 16) | (buf[10] << 8) | buf[11]) >>> 0;

  const dataOffset = ((buf[12] >> 4) & 0x0f) * 4;
  if (dataOffset < 20 || buf.length < dataOffset) return null;

  const flagsByte = buf[13];
  const flags: TcpFlags = {
    fin: Boolean(flagsByte & 0x01),
    syn: Boolean(flagsByte & 0x02),
    rst: Boolean(flagsByte & 0x04),
    psh: Boolean(flagsByte & 0x08),
    ack: Boolean(flagsByte & 0x10),
    urg: Boolean(flagsByte & 0x20),
  };

  const windowSize = (buf[14] << 8) | buf[15];
  const checksum = (buf[16] << 8) | buf[17];
  const urgentPointer = (buf[18] << 8) | buf[19];

  const payload = buf.subarray(dataOffset);

  // Validate checksum
  const checkCalc = calculateTcpChecksum(srcIp, dstIp, buf);
  const checksumValid = checkCalc === 0;

  return {
    srcPort,
    dstPort,
    seqNumber,
    ackNumber,
    dataOffset,
    flags,
    windowSize,
    checksum,
    urgentPointer,
    payload,
    checksumValid,
    rawBytes: buf,
  };
}
