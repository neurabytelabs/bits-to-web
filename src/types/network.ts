/**
 * Network Simulation Core Types
 * Supporting Physical (L1), Data Link (L2), Network (L3), Transport (L4), and Application (L7)
 */

export type Bit = 0 | 1;

/**
 * Manchester code voltage level:
 * +1: +2.5V (High)
 * -1: -2.5V (Low)
 *  0:  0.0V (Idle / Inter-packet gap / Carrier absent)
 */
export type VoltageLevel = -1 | 0 | 1;

export interface PhysicalSignalSample {
  voltage: VoltageLevel;
  clock: 0 | 1;
  bitValue?: Bit;
  isTransition: boolean;
  timeMs: number;
}

export type CableStatus = 'connected' | 'severed' | 'noisy';

export interface CableEnd {
  nodeId: string;
  interfaceName: string;
}

export interface WireBit {
  id: number;
  bit: Bit;
  symbol: VoltageLevel[]; // Two half-bit voltages for Manchester
  progress: number; // 0.0 (near nodeA) to 1.0 (near nodeB)
  direction: 'a_to_b' | 'b_to_a';
  sourceNodeId: string;
  targetNodeId: string;
  frameId: number;
  frameBitCount: number; // total bits in this frame, so the receiver knows when it has all of them
  isPreamble?: boolean;
}

export interface Cable {
  id: string;
  name: string;
  nodeA: CableEnd;
  nodeB: CableEnd;
  status: CableStatus;
  propagationDelayMs: number;
  lengthMeters: number;
  bitsInFlight: WireBit[];
  totalBitsTransmitted: number;
  droppedFramesCount: number;
  bandwidthMbps: number;
}

export interface NetworkInterface {
  name: string;
  mac: string;
  ip?: string;
  netmask?: string;
  cableId?: string;
  carrierUp: boolean;
  txQueue: Uint8Array[]; // Raw frame byte buffers
  rxBuffer: number[]; // Bits currently being assembled
  txBitBuffer: WireBit[];
  stats: {
    txPackets: number;
    rxPackets: number;
    txBytes: number;
    rxBytes: number;
    crcErrors: number;
    collisions: number;
  };
}

export interface ForwardingEntry {
  destinationSubnet: string;
  netmask: string;
  nextHop: string | 'DIRECT';
  interfaceName: string;
  metric: number;
  learnedVia: 'CONNECTED' | 'STATIC' | 'OSPF';
}

export interface ArpEntry {
  ip: string;
  mac: string;
  expiresAt: number;
}

export interface CamTableEntry {
  mac: string;
  port: string;
  learnedAt: number;
}

export interface LinkStateLSA {
  originRouterId: string;
  sequenceNumber: number;
  age: number;
  links: {
    neighborRouterId: string;
    neighborSubnet: string;
    metric: number;
    interfaceName: string;
  }[];
}

export type TcpState =
  | 'CLOSED'
  | 'LISTEN'
  | 'SYN_SENT'
  | 'SYN_RECEIVED'
  | 'ESTABLISHED'
  | 'FIN_WAIT_1'
  | 'FIN_WAIT_2'
  | 'CLOSE_WAIT'
  | 'CLOSING'
  | 'LAST_ACK'
  | 'TIME_WAIT';

export interface TcpSegmentBuffer {
  seq: number;
  data: Uint8Array;
  timestamp: number;
  retransmitCount: number;
}

export interface TcpConnection {
  id: string;
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  state: TcpState;
  seqNumber: number;
  ackNumber: number;
  advertisedWindow: number;
  unacknowledgedQueue: TcpSegmentBuffer[];
  receiveBuffer: Map<number, Uint8Array>; // Seq -> chunk
  nextExpectedSeq: number;
  rtoTimerMs: number;
  srttMs?: number; // smoothed round-trip time (RFC 6298)
  rttVarMs?: number; // round-trip time variation (RFC 6298)
  lastActivityMs: number;
  appCallback?: (data: Uint8Array) => void;
}

export type NodeType = 'host' | 'switch' | 'router' | 'server';

export interface BaseNode {
  id: string;
  name: string;
  type: NodeType;
  x: number; // For interactive topology visualization
  y: number;
  interfaces: Record<string, NetworkInterface>;
}

export interface SwitchNode extends BaseNode {
  type: 'switch';
  camTable: Record<string, CamTableEntry>; // MAC -> port
}

export interface RouterNode extends BaseNode {
  type: 'router';
  routerId: string;
  forwardingTable: ForwardingEntry[];
  arpTable: Record<string, ArpEntry>;
  lsdb: Record<string, LinkStateLSA>; // RouterId -> LSA
  ospfSeq: number;
}

export interface HostNode extends BaseNode {
  type: 'host' | 'server';
  defaultGateway?: string;
  dnsServer?: string;
  arpTable: Record<string, ArpEntry>;
  tcpConnections: Record<string, TcpConnection>;
  // Server-specific application hooks
  httpRoutes?: Record<string, { contentType: string; body: string }>;
  dnsRecords?: Record<string, string>; // hostname -> IP
}

export type NetworkNode = SwitchNode | RouterNode | HostNode;

// Protocols
export type ProtocolType = 'ARP' | 'IPv4' | 'OSPF' | 'TCP' | 'UDP' | 'DNS' | 'HTTP';

export interface CapturedPacket {
  id: number;
  timestamp: number; // Simulation time in ms
  deltaMs: number;
  cableId: string;
  cableName: string;
  sourceNodeId: string;
  targetNodeId: string;
  rawBytes: Uint8Array;
  rawBits: Bit[];
  manchesterWaveform: VoltageLevel[];
  crcValid: boolean;
  crcComputed: number;
  crcReceived: number;
  // Decoded OSI Layers
  l2: {
    srcMac: string;
    dstMac: string;
    etherType: string;
    payloadLength: number;
  };
  l3?: {
    protocol: 'IPv4' | 'ARP' | 'OSPF_LSP';
    srcIp?: string;
    dstIp?: string;
    ttl?: number;
    identification?: number;
    headerChecksumValid?: boolean;
  };
  l4?: {
    protocol: 'TCP' | 'UDP' | 'OSPF';
    srcPort?: number;
    dstPort?: number;
    seqNumber?: number;
    ackNumber?: number;
    flags?: {
      syn: boolean;
      ack: boolean;
      fin: boolean;
      rst: boolean;
      psh: boolean;
    };
    windowSize?: number;
    checksumValid?: boolean;
  };
  l7?: {
    protocol: 'HTTP' | 'DNS';
    info: string;
    summary: string;
    httpMethod?: string;
    httpUri?: string;
    httpStatusCode?: number;
    dnsQuestion?: string;
    dnsAnswer?: string;
  };
  summary: string;
  status: 'delivered' | 'dropped_crc' | 'dropped_cable_cut' | 'dropped_ttl';
}

export type LayerZoom = 'L7_APPLICATION' | 'L4_TCP' | 'L3_IP' | 'L2_ETHERNET' | 'L1_PHYSICAL';
