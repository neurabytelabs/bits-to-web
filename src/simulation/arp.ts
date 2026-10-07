/**
 * Address Resolution Protocol (ARP - RFC 826)
 * Maps IPv4 addresses to MAC hardware addresses over switched Ethernet.
 */

import { parseMac, formatMac, BROADCAST_MAC } from './ethernet';
import { ArpEntry } from '../types/network';

export const ARP_OPCODE_REQUEST = 1;
export const ARP_OPCODE_REPLY = 2;

export interface ArpPacket {
  hardwareType: number; // 1 = Ethernet
  protocolType: number; // 0x0800 = IPv4
  hardwareSize: number; // 6
  protocolSize: number; // 4
  opcode: number;       // 1 = Request, 2 = Reply
  senderMac: string;
  senderIp: string;
  targetMac: string;
  targetIp: string;
}

export function parseIp(ipStr: string): Uint8Array {
  const parts = ipStr.split('.');
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    bytes[i] = parseInt(parts[i] || '0', 10);
  }
  return bytes;
}

export function formatIp(bytes: Uint8Array, offset = 0): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

export function serializeArp(packet: ArpPacket): Uint8Array {
  const buf = new Uint8Array(28);
  // Hardware type (1 = Ethernet)
  buf[0] = 0x00;
  buf[1] = 0x01;
  // Protocol type (0x0800 = IPv4)
  buf[2] = 0x08;
  buf[3] = 0x00;
  // Hardware size (6)
  buf[4] = 6;
  // Protocol size (4)
  buf[5] = 4;
  // Opcode (1=req, 2=reply)
  buf[6] = (packet.opcode >> 8) & 0xff;
  buf[7] = packet.opcode & 0xff;

  // Sender MAC
  buf.set(parseMac(packet.senderMac), 8);
  // Sender IP
  buf.set(parseIp(packet.senderIp), 14);
  // Target MAC
  buf.set(parseMac(packet.targetMac || BROADCAST_MAC), 18);
  // Target IP
  buf.set(parseIp(packet.targetIp), 24);

  return buf;
}

export function deserializeArp(data: Uint8Array): ArpPacket | null {
  if (data.length < 28) return null;

  const opcode = (data[6] << 8) | data[7];
  const senderMac = formatMac(data, 8);
  const senderIp = formatIp(data, 14);
  const targetMac = formatMac(data, 18);
  const targetIp = formatIp(data, 24);

  return {
    hardwareType: (data[0] << 8) | data[1],
    protocolType: (data[2] << 8) | data[3],
    hardwareSize: data[4],
    protocolSize: data[5],
    opcode,
    senderMac,
    senderIp,
    targetMac,
    targetIp,
  };
}
