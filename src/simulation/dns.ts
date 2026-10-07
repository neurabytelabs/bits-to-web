/**
 * Application Layer (L7): Domain Name System (DNS - RFC 1035) over UDP
 */

import { parseIp, formatIp } from './arp';

export const DNS_PORT = 53;

export interface DnsQuestion {
  name: string;
  type: number;  // 1 = A (Host Address)
  class: number; // 1 = IN (Internet)
}

export interface DnsAnswer {
  name: string;
  type: number;
  class: number;
  ttl: number;
  data: string; // IPv4 string e.g. "192.168.20.80"
}

export interface DnsMessage {
  transactionId: number;
  isResponse: boolean;
  recursionDesired: boolean;
  recursionAvailable: boolean;
  questions: DnsQuestion[];
  answers: DnsAnswer[];
}

/**
 * Encodes domain name into DNS label sequence:
 * "hypertext.org" -> [9, 'h','y','p','e','r','t','e','x','t', 3, 'o','r','g', 0]
 */
function encodeDnsName(name: string): Uint8Array {
  const parts = name.split('.');
  const totalLen = parts.reduce((acc, p) => acc + 1 + p.length, 1);
  const out = new Uint8Array(totalLen);

  let offset = 0;
  for (const part of parts) {
    out[offset++] = part.length;
    for (let i = 0; i < part.length; i++) {
      out[offset++] = part.charCodeAt(i);
    }
  }
  out[offset] = 0; // null terminator
  return out;
}

/**
 * Decodes DNS label sequence into domain string:
 */
function decodeDnsName(buf: Uint8Array, offset: number): { name: string; bytesRead: number } {
  const parts: string[] = [];
  let curr = offset;

  while (curr < buf.length) {
    const len = buf[curr++];
    if (len === 0) break;
    // Check for pointer compression (0xc0)
    if ((len & 0xc0) === 0xc0) {
      curr++; // skip second byte of pointer
      break;
    }
    let part = '';
    for (let i = 0; i < len; i++) {
      part += String.fromCharCode(buf[curr++]);
    }
    parts.push(part);
  }

  return {
    name: parts.join('.'),
    bytesRead: curr - offset,
  };
}

/**
 * Serializes a DNS Query (Type A, Class IN).
 */
export function serializeDnsQuery(domain: string, transactionId = 0x1a2b): Uint8Array {
  const nameBytes = encodeDnsName(domain);
  const totalLen = 12 + nameBytes.length + 4; // Header (12B) + Name + Type(2B) + Class(2B)
  const buf = new Uint8Array(totalLen);

  // Transaction ID
  buf[0] = (transactionId >> 8) & 0xff;
  buf[1] = transactionId & 0xff;

  // Flags: Standard query (0x0100 -> RD=1)
  buf[2] = 0x01;
  buf[3] = 0x00;

  // QDCOUNT = 1
  buf[4] = 0x00;
  buf[5] = 0x01;

  // ANCOUNT = 0, NSCOUNT = 0, ARCOUNT = 0
  buf[6] = 0; buf[7] = 0;
  buf[8] = 0; buf[9] = 0;
  buf[10] = 0; buf[11] = 0;

  // Question Name
  buf.set(nameBytes, 12);
  let offset = 12 + nameBytes.length;

  // QTYPE = 1 (Type A)
  buf[offset++] = 0x00;
  buf[offset++] = 0x01;

  // QCLASS = 1 (Class IN)
  buf[offset++] = 0x00;
  buf[offset++] = 0x01;

  return buf;
}

/**
 * Serializes a DNS Response (Type A).
 */
export function serializeDnsResponse(
  transactionId: number,
  domain: string,
  resolvedIp: string
): Uint8Array {
  const nameBytes = encodeDnsName(domain);
  // Header (12) + Question (name + 4) + Answer (name ptr 2 + type 2 + class 2 + ttl 4 + rdlen 2 + rdata 4 = 16)
  const totalLen = 12 + nameBytes.length + 4 + 16;
  const buf = new Uint8Array(totalLen);

  // Transaction ID
  buf[0] = (transactionId >> 8) & 0xff;
  buf[1] = transactionId & 0xff;

  // Flags: Standard response, No error, Recursion Available (0x8180)
  buf[2] = 0x81;
  buf[3] = 0x80;

  // QDCOUNT = 1
  buf[4] = 0x00; buf[5] = 0x01;
  // ANCOUNT = 1
  buf[6] = 0x00; buf[7] = 0x01;
  // NSCOUNT = 0, ARCOUNT = 0
  buf[8] = 0; buf[9] = 0;
  buf[10] = 0; buf[11] = 0;

  // Question section
  buf.set(nameBytes, 12);
  let offset = 12 + nameBytes.length;
  buf[offset++] = 0x00; buf[offset++] = 0x01; // Type A
  buf[offset++] = 0x00; buf[offset++] = 0x01; // Class IN

  // Answer section: Name pointer to offset 12 (0xc00c)
  buf[offset++] = 0xc0;
  buf[offset++] = 0x0c;

  // Type A (1)
  buf[offset++] = 0x00; buf[offset++] = 0x01;
  // Class IN (1)
  buf[offset++] = 0x00; buf[offset++] = 0x01;
  // TTL = 300 seconds (0x0000012c)
  buf[offset++] = 0x00; buf[offset++] = 0x00; buf[offset++] = 0x01; buf[offset++] = 0x2c;
  // RDLENGTH = 4 bytes (IPv4)
  buf[offset++] = 0x00; buf[offset++] = 0x04;
  // RDATA = 4 IP bytes
  buf.set(parseIp(resolvedIp), offset);

  return buf;
}

/**
 * Deserializes DNS Message.
 */
export function deserializeDnsMessage(buf: Uint8Array): DnsMessage | null {
  if (buf.length < 12) return null;

  const transactionId = (buf[0] << 8) | buf[1];
  const flags = (buf[2] << 8) | buf[3];
  const isResponse = Boolean(flags & 0x8000);
  const recursionDesired = Boolean(flags & 0x0100);
  const recursionAvailable = Boolean(flags & 0x0080);

  const qdCount = (buf[4] << 8) | buf[5];
  const anCount = (buf[6] << 8) | buf[7];

  const questions: DnsQuestion[] = [];
  const answers: DnsAnswer[] = [];

  let offset = 12;

  // Parse questions
  for (let i = 0; i < qdCount && offset < buf.length; i++) {
    const { name, bytesRead } = decodeDnsName(buf, offset);
    offset += bytesRead;
    const type = (buf[offset] << 8) | buf[offset + 1];
    const qClass = (buf[offset + 2] << 8) | buf[offset + 3];
    offset += 4;
    questions.push({ name, type, class: qClass });
  }

  // Parse answers if response
  for (let i = 0; i < anCount && offset < buf.length; i++) {
    // Check if pointer or name
    let name = questions[0]?.name || 'unknown';
    if ((buf[offset] & 0xc0) === 0xc0) {
      offset += 2; // Pointer
    } else {
      const { name: parsedName, bytesRead } = decodeDnsName(buf, offset);
      name = parsedName;
      offset += bytesRead;
    }

    const type = (buf[offset] << 8) | buf[offset + 1];
    const aClass = (buf[offset + 2] << 8) | buf[offset + 3];
    const ttl =
      ((buf[offset + 4] << 24) |
        (buf[offset + 5] << 16) |
        (buf[offset + 6] << 8) |
        buf[offset + 7]) >>> 0;
    const rdLength = (buf[offset + 8] << 8) | buf[offset + 9];
    offset += 10;

    let data = '';
    if (type === 1 && rdLength === 4) {
      data = formatIp(buf, offset);
    }
    offset += rdLength;

    answers.push({ name, type, class: aClass, ttl, data });
  }

  return {
    transactionId,
    isResponse,
    recursionDesired,
    recursionAvailable,
    questions,
    answers,
  };
}
