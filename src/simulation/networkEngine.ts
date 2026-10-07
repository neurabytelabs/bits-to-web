/**
 * The Master Internet Simulation Engine
 * Physical Cables <-> Manchester <-> Switched Ethernet <-> IPv4 <-> OSPF Dijkstra <-> TCP <-> DNS <-> HTTP
 */

import {
  Cable,
  HostNode,
  RouterNode,
  SwitchNode,
  NetworkNode,
  NetworkInterface,
  CapturedPacket,
  WireBit,
  Bit,
  VoltageLevel,
  TcpConnection,
  TcpSegmentBuffer,
  LinkStateLSA,
  ForwardingEntry,
} from '../types/network';

import { createCable, tickCablePhysics, cutCable, repairCable, toggleCableNoise, transmitBitsOnCable } from './physical';
import {
  frameToPhysicalBitstream,
  decodePhysicalBitstream,
  bufferToBits,
  generateWaveformSamples,
} from './manchester';
import {
  serializeEthernetFrame,
  deserializeEthernetFrame,
  processSwitchFrame,
  BROADCAST_MAC,
  ETHERTYPE_IPV4,
  ETHERTYPE_ARP,
  ETHERTYPE_LINK_STATE,
} from './ethernet';
import {
  serializeArp,
  deserializeArp,
  ARP_OPCODE_REQUEST,
  ARP_OPCODE_REPLY,
} from './arp';
import {
  serializeIpv4Packet,
  deserializeIpv4Packet,
  lookupRoute,
  IP_PROTO_TCP,
  IP_PROTO_UDP,
  IP_PROTO_OSPF,
} from './ip';
import { rebuildForwardingTableFromLSDB } from './ospf';
import {
  serializeTcpSegment,
  deserializeTcpSegment,
} from './tcp';
import {
  serializeDnsQuery,
  serializeDnsResponse,
  deserializeDnsMessage,
  DNS_PORT,
} from './dns';
import {
  serializeHttpRequest,
  serializeHttpResponse,
  parseHttpRequest,
  parseHttpResponse,
  WEB_CATALOG,
  bytesToString,
} from './http';

/** The other usable host address on a /30 point-to-point link. */
/**
 * Initial TCP retransmission timeout. A frame takes a few hundred simulated
 * milliseconds per hop, so the first RTO is sized above one round trip across
 * the six-hop path; after that the RTO follows measured round trips (RFC 6298).
 */
const INITIAL_RTO_MS = 10000;
const MIN_RTO_MS = 1000;
const MAX_RTO_MS = 20000;

function pointToPointPeer(ip: string): string {
  const parts = ip.split('.').map(Number);
  const base = parts[3] & ~3;
  parts[3] = parts[3] === base + 1 ? base + 2 : base + 1;
  return parts.join('.');
}

export class NetworkEngine {
  public nodes: Record<string, NetworkNode> = {};
  public cables: Record<string, Cable> = {};
  public capturedPackets: CapturedPacket[] = [];
  private rxBuffers = new Map<string, Bit[]>();
  public simTimeMs = 0;
  public isRunning = true;
  public simSpeed = 1.0; // 0.2x to 5.0x
  private packetIdCounter = 1;

  // Browser state on client
  public currentUrl = 'http://hypertext.org';
  public browserState: {
    status: 'idle' | 'resolving_dns' | 'connecting_tcp' | 'sending_http' | 'receiving_stream' | 'loaded' | 'error';
    renderedHtml: string;
    resolvedIp: string | null;
    bytesReceived: number;
    totalExpectedBytes: number;
    loadTimeMs: number;
    errorMessage?: string;
  } = {
    status: 'idle',
    renderedHtml: '',
    resolvedIp: null,
    bytesReceived: 0,
    totalExpectedBytes: 0,
    loadTimeMs: 0,
  };

  // Selected cable for oscilloscope inspection
  public selectedCableId = 'cable_alpha_beta';

  constructor() {
    this.buildTopology();
    this.initRoutingProtocols();
  }

  /**
   * Builds the network topology:
   * Client LAN (192.168.1.0/24) -> Router Alpha ->
   *   [Primary Route: Router Beta (Metric 1)]
   *   [Backup Route: Router Gamma (Metric 2)]
   * -> Router Delta -> Core DMZ (192.168.20.0/24 & 192.168.30.0/24) -> Web Servers
   */
  private buildTopology(): void {
    // 1. Client Node
    const client: HostNode = {
      id: 'client',
      name: 'Client Workstation',
      type: 'host',
      x: 120,
      y: 220,
      defaultGateway: '192.168.1.1',
      dnsServer: '192.168.1.53',
      arpTable: {},
      tcpConnections: {},
      interfaces: {
        eth0: {
          name: 'eth0',
          mac: '02:00:00:00:01:10',
          ip: '192.168.1.10',
          netmask: '255.255.255.0',
          cableId: 'cable_client_sw',
          carrierUp: true,
          txQueue: [],
          rxBuffer: [],
          txBitBuffer: [],
          stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 },
        },
      },
    };

    // 2. DNS Server Node
    const dns: HostNode = {
      id: 'dns',
      name: 'Root / Authoritative DNS',
      type: 'server',
      x: 120,
      y: 380,
      defaultGateway: '192.168.1.1',
      arpTable: {},
      tcpConnections: {},
      dnsRecords: {
        'hypertext.org': '192.168.20.80',
        'the-internals.net': '192.168.20.80',
        'retro.net': '192.168.30.50',
        'cern.ch': '192.168.20.90',
      },
      interfaces: {
        eth0: {
          name: 'eth0',
          mac: '02:00:00:00:01:53',
          ip: '192.168.1.53',
          netmask: '255.255.255.0',
          cableId: 'cable_dns_sw',
          carrierUp: true,
          txQueue: [],
          rxBuffer: [],
          txBitBuffer: [],
          stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 },
        },
      },
    };

    // 3. Local Switch (Layer 2)
    const swLocal: SwitchNode = {
      id: 'sw_local',
      name: 'Local Access Switch',
      type: 'switch',
      x: 280,
      y: 280,
      camTable: {},
      interfaces: {
        port1: { name: 'port1', mac: '02:00:00:00:02:01', carrierUp: true, cableId: 'cable_client_sw', txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
        port2: { name: 'port2', mac: '02:00:00:00:02:02', carrierUp: true, cableId: 'cable_dns_sw', txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
        port3: { name: 'port3', mac: '02:00:00:00:02:03', carrierUp: true, cableId: 'cable_alpha_sw', txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
      },
    };

    // 4. Router Alpha (Gateway)
    const routerAlpha: RouterNode = {
      id: 'router_alpha',
      name: 'Router Alpha (Gateway)',
      type: 'router',
      routerId: '10.0.0.1',
      x: 440,
      y: 280,
      forwardingTable: [],
      arpTable: {},
      lsdb: {},
      ospfSeq: 1,
      interfaces: {
        eth0: { name: 'eth0', mac: '02:00:00:00:03:01', ip: '192.168.1.1', netmask: '255.255.255.0', cableId: 'cable_alpha_sw', carrierUp: true, txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
        eth1: { name: 'eth1', mac: '02:00:00:00:03:02', ip: '10.1.1.1', netmask: '255.255.255.252', cableId: 'cable_alpha_beta', carrierUp: true, txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
        eth2: { name: 'eth2', mac: '02:00:00:00:03:03', ip: '10.2.1.1', netmask: '255.255.255.252', cableId: 'cable_alpha_gamma', carrierUp: true, txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
      },
    };

    // 5. Router Beta (High-Speed Primary Link)
    const routerBeta: RouterNode = {
      id: 'router_beta',
      name: 'Router Beta (Primary 100M)',
      type: 'router',
      routerId: '10.0.0.2',
      x: 620,
      y: 170,
      forwardingTable: [],
      arpTable: {},
      lsdb: {},
      ospfSeq: 1,
      interfaces: {
        eth0: { name: 'eth0', mac: '02:00:00:00:04:01', ip: '10.1.1.2', netmask: '255.255.255.252', cableId: 'cable_alpha_beta', carrierUp: true, txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
        eth1: { name: 'eth1', mac: '02:00:00:00:04:02', ip: '10.1.2.1', netmask: '255.255.255.252', cableId: 'cable_beta_delta', carrierUp: true, txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
      },
    };

    // 6. Router Gamma (Redundant Backup Link)
    const routerGamma: RouterNode = {
      id: 'router_gamma',
      name: 'Router Gamma (Backup 50M)',
      type: 'router',
      routerId: '10.0.0.3',
      x: 620,
      y: 390,
      forwardingTable: [],
      arpTable: {},
      lsdb: {},
      ospfSeq: 1,
      interfaces: {
        eth0: { name: 'eth0', mac: '02:00:00:00:05:01', ip: '10.2.1.2', netmask: '255.255.255.252', cableId: 'cable_alpha_gamma', carrierUp: true, txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
        eth1: { name: 'eth1', mac: '02:00:00:00:05:02', ip: '10.2.2.1', netmask: '255.255.255.252', cableId: 'cable_gamma_delta', carrierUp: true, txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
      },
    };

    // 7. Router Delta (Web Gateway)
    const routerDelta: RouterNode = {
      id: 'router_delta',
      name: 'Router Delta (Web Gateway)',
      type: 'router',
      routerId: '10.0.0.4',
      x: 800,
      y: 280,
      forwardingTable: [],
      arpTable: {},
      lsdb: {},
      ospfSeq: 1,
      interfaces: {
        eth0: { name: 'eth0', mac: '02:00:00:00:06:01', ip: '10.1.2.2', netmask: '255.255.255.252', cableId: 'cable_beta_delta', carrierUp: true, txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
        eth1: { name: 'eth1', mac: '02:00:00:00:06:02', ip: '10.2.2.2', netmask: '255.255.255.252', cableId: 'cable_gamma_delta', carrierUp: true, txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
        eth2: { name: 'eth2', mac: '02:00:00:00:06:03', ip: '192.168.20.1', netmask: '255.255.255.0', cableId: 'cable_delta_swcore', carrierUp: true, txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
      },
    };

    // 8. Core Switch (Layer 2)
    const swCore: SwitchNode = {
      id: 'sw_core',
      name: 'Core Web Switch',
      type: 'switch',
      x: 960,
      y: 280,
      camTable: {},
      interfaces: {
        port1: { name: 'port1', mac: '02:00:00:00:07:01', carrierUp: true, cableId: 'cable_delta_swcore', txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
        port2: { name: 'port2', mac: '02:00:00:00:07:02', carrierUp: true, cableId: 'cable_web_swcore', txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
        port3: { name: 'port3', mac: '02:00:00:00:07:03', carrierUp: true, cableId: 'cable_retro_swcore', txQueue: [], rxBuffer: [], txBitBuffer: [], stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 } },
      },
    };

    // 9. Web Server 1
    const server1: HostNode = {
      id: 'server1',
      name: 'HTTP Web Server (CERN / Hypertext)',
      type: 'server',
      x: 1120,
      y: 200,
      defaultGateway: '192.168.20.1',
      arpTable: {},
      tcpConnections: {},
      interfaces: {
        eth0: {
          name: 'eth0',
          mac: '02:00:00:00:20:80',
          ip: '192.168.20.80',
          netmask: '255.255.255.0',
          cableId: 'cable_web_swcore',
          carrierUp: true,
          txQueue: [],
          rxBuffer: [],
          txBitBuffer: [],
          stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 },
        },
      },
    };

    // 10. Web Server 2 (Retro Archive)
    const server2: HostNode = {
      id: 'server2',
      name: 'Retro Archive Server',
      type: 'server',
      x: 1120,
      y: 360,
      defaultGateway: '192.168.20.1',
      arpTable: {},
      tcpConnections: {},
      interfaces: {
        eth0: {
          name: 'eth0',
          mac: '02:00:00:00:30:50',
          ip: '192.168.30.50',
          netmask: '255.255.255.0',
          cableId: 'cable_retro_swcore',
          carrierUp: true,
          txQueue: [],
          rxBuffer: [],
          txBitBuffer: [],
          stats: { txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0, crcErrors: 0, collisions: 0 },
        },
      },
    };

    this.nodes = {
      client,
      dns,
      sw_local: swLocal,
      router_alpha: routerAlpha,
      router_beta: routerBeta,
      router_gamma: routerGamma,
      router_delta: routerDelta,
      sw_core: swCore,
      server1,
      server2,
    };

    // Cables connecting the nodes
    this.cables = {
      cable_client_sw: createCable('cable_client_sw', 'Client <-> Local Switch', 'client', 'eth0', 'sw_local', 'port1', 20),
      cable_dns_sw: createCable('cable_dns_sw', 'DNS <-> Local Switch', 'dns', 'eth0', 'sw_local', 'port2', 15),
      cable_alpha_sw: createCable('cable_alpha_sw', 'Switch <-> Router Alpha', 'sw_local', 'port3', 'router_alpha', 'eth0', 30),
      cable_alpha_beta: createCable('cable_alpha_beta', 'Alpha <-> Beta (Primary 100M)', 'router_alpha', 'eth1', 'router_beta', 'eth0', 100, 100),
      cable_alpha_gamma: createCable('cable_alpha_gamma', 'Alpha <-> Gamma (Backup 50M)', 'router_alpha', 'eth2', 'router_gamma', 'eth0', 120, 50),
      cable_beta_delta: createCable('cable_beta_delta', 'Beta <-> Delta (Primary 100M)', 'router_beta', 'eth1', 'router_delta', 'eth0', 100, 100),
      cable_gamma_delta: createCable('cable_gamma_delta', 'Gamma <-> Delta (Backup 50M)', 'router_gamma', 'eth1', 'router_delta', 'eth1', 120, 50),
      cable_delta_swcore: createCable('cable_delta_swcore', 'Router Delta <-> Core Switch', 'router_delta', 'eth2', 'sw_core', 'port1', 30),
      cable_web_swcore: createCable('cable_web_swcore', 'Core Switch <-> Web Server', 'sw_core', 'port2', 'server1', 'eth0', 15),
      cable_retro_swcore: createCable('cable_retro_swcore', 'Core Switch <-> Retro Server', 'sw_core', 'port3', 'server2', 'eth0', 25),
    };

    // Pre-populate initial ARP tables for essential local default gateways to allow clean immediate first packet
    client.arpTable['192.168.1.1'] = { ip: '192.168.1.1', mac: routerAlpha.interfaces.eth0.mac, expiresAt: Infinity };
    client.arpTable['192.168.1.53'] = { ip: '192.168.1.53', mac: dns.interfaces.eth0.mac, expiresAt: Infinity };
    dns.arpTable['192.168.1.10'] = { ip: '192.168.1.10', mac: client.interfaces.eth0.mac, expiresAt: Infinity };

    routerAlpha.arpTable['192.168.1.10'] = { ip: '192.168.1.10', mac: client.interfaces.eth0.mac, expiresAt: Infinity };
    routerAlpha.arpTable['10.1.1.2'] = { ip: '10.1.1.2', mac: routerBeta.interfaces.eth0.mac, expiresAt: Infinity };
    routerAlpha.arpTable['10.2.1.2'] = { ip: '10.2.1.2', mac: routerGamma.interfaces.eth0.mac, expiresAt: Infinity };

    routerBeta.arpTable['10.1.1.1'] = { ip: '10.1.1.1', mac: routerAlpha.interfaces.eth1.mac, expiresAt: Infinity };
    routerBeta.arpTable['10.1.2.2'] = { ip: '10.1.2.2', mac: routerDelta.interfaces.eth0.mac, expiresAt: Infinity };

    routerGamma.arpTable['10.2.1.1'] = { ip: '10.2.1.1', mac: routerAlpha.interfaces.eth2.mac, expiresAt: Infinity };
    routerGamma.arpTable['10.2.2.2'] = { ip: '10.2.2.2', mac: routerDelta.interfaces.eth1.mac, expiresAt: Infinity };

    routerDelta.arpTable['10.1.2.1'] = { ip: '10.1.2.1', mac: routerBeta.interfaces.eth1.mac, expiresAt: Infinity };
    routerDelta.arpTable['10.2.2.1'] = { ip: '10.2.2.1', mac: routerGamma.interfaces.eth1.mac, expiresAt: Infinity };
    routerDelta.arpTable['192.168.20.80'] = { ip: '192.168.20.80', mac: server1.interfaces.eth0.mac, expiresAt: Infinity };
    routerDelta.arpTable['192.168.30.50'] = { ip: '192.168.30.50', mac: server2.interfaces.eth0.mac, expiresAt: Infinity };

    server1.arpTable['192.168.20.1'] = { ip: '192.168.20.1', mac: routerDelta.interfaces.eth2.mac, expiresAt: Infinity };
    server2.arpTable['192.168.20.1'] = { ip: '192.168.20.1', mac: routerDelta.interfaces.eth2.mac, expiresAt: Infinity };
  }

  /**
   * Initializes Link-State Routing (OSPF) across all routers.
   * Generates LSAs and runs Dijkstra SPF.
   */
  public initRoutingProtocols(): void {
    const routers = [
      this.nodes.router_alpha as RouterNode,
      this.nodes.router_beta as RouterNode,
      this.nodes.router_gamma as RouterNode,
      this.nodes.router_delta as RouterNode,
    ];

    // Compute fresh LSDB based on operational cables
    this.refreshLinkStateTopology();
  }

  /**
   * Re-evaluates all operational cable states and regenerates LSDB for all routers.
   * Runs Dijkstra SPF to update all Forwarding Tables (FIB).
   */
  public refreshLinkStateTopology(): void {
    const alphaBetaUp = this.cables.cable_alpha_beta.status !== 'severed';
    const alphaGammaUp = this.cables.cable_alpha_gamma.status !== 'severed';
    const betaDeltaUp = this.cables.cable_beta_delta.status !== 'severed';
    const gammaDeltaUp = this.cables.cable_gamma_delta.status !== 'severed';

    // Synchronize router interface carrier state with connected cables
    (this.nodes.router_alpha as RouterNode).interfaces.eth1.carrierUp = alphaBetaUp;
    (this.nodes.router_alpha as RouterNode).interfaces.eth2.carrierUp = alphaGammaUp;

    (this.nodes.router_beta as RouterNode).interfaces.eth0.carrierUp = alphaBetaUp;
    (this.nodes.router_beta as RouterNode).interfaces.eth1.carrierUp = betaDeltaUp;

    (this.nodes.router_gamma as RouterNode).interfaces.eth0.carrierUp = alphaGammaUp;
    (this.nodes.router_gamma as RouterNode).interfaces.eth1.carrierUp = gammaDeltaUp;

    (this.nodes.router_delta as RouterNode).interfaces.eth0.carrierUp = betaDeltaUp;
    (this.nodes.router_delta as RouterNode).interfaces.eth1.carrierUp = gammaDeltaUp;

    // Build LSAs
    const lsaAlpha: LinkStateLSA = {
      originRouterId: '10.0.0.1',
      sequenceNumber: 100,
      age: 1,
      links: [
        { neighborRouterId: 'client_lan', neighborSubnet: '192.168.1.0', metric: 1, interfaceName: 'eth0' },
        ...(alphaBetaUp ? [{ neighborRouterId: '10.0.0.2', neighborSubnet: '10.1.1.0', metric: 10, interfaceName: 'eth1' }] : []),
        ...(alphaGammaUp ? [{ neighborRouterId: '10.0.0.3', neighborSubnet: '10.2.1.0', metric: 30, interfaceName: 'eth2' }] : []),
      ],
    };

    const lsaBeta: LinkStateLSA = {
      originRouterId: '10.0.0.2',
      sequenceNumber: 100,
      age: 1,
      links: [
        ...(alphaBetaUp ? [{ neighborRouterId: '10.0.0.1', neighborSubnet: '10.1.1.0', metric: 10, interfaceName: 'eth0' }] : []),
        ...(betaDeltaUp ? [{ neighborRouterId: '10.0.0.4', neighborSubnet: '10.1.2.0', metric: 10, interfaceName: 'eth1' }] : []),
      ],
    };

    const lsaGamma: LinkStateLSA = {
      originRouterId: '10.0.0.3',
      sequenceNumber: 100,
      age: 1,
      links: [
        ...(alphaGammaUp ? [{ neighborRouterId: '10.0.0.1', neighborSubnet: '10.2.1.0', metric: 30, interfaceName: 'eth0' }] : []),
        ...(gammaDeltaUp ? [{ neighborRouterId: '10.0.0.4', neighborSubnet: '10.2.2.0', metric: 30, interfaceName: 'eth1' }] : []),
      ],
    };

    const lsaDelta: LinkStateLSA = {
      originRouterId: '10.0.0.4',
      sequenceNumber: 100,
      age: 1,
      links: [
        ...(betaDeltaUp ? [{ neighborRouterId: '10.0.0.2', neighborSubnet: '10.1.2.0', metric: 10, interfaceName: 'eth0' }] : []),
        ...(gammaDeltaUp ? [{ neighborRouterId: '10.0.0.3', neighborSubnet: '10.2.2.0', metric: 30, interfaceName: 'eth1' }] : []),
        { neighborRouterId: 'server_dmz', neighborSubnet: '192.168.20.0', metric: 1, interfaceName: 'eth2' },
        { neighborRouterId: 'server_dmz_retro', neighborSubnet: '192.168.30.0', metric: 1, interfaceName: 'eth2' },
      ],
    };

    const fullLsdb: Record<string, LinkStateLSA> = {
      '10.0.0.1': lsaAlpha,
      '10.0.0.2': lsaBeta,
      '10.0.0.3': lsaGamma,
      '10.0.0.4': lsaDelta,
    };

    // Update LSDB and rebuild Forwarding Tables via Dijkstra SPF for all routers
    const routers = [
      this.nodes.router_alpha as RouterNode,
      this.nodes.router_beta as RouterNode,
      this.nodes.router_gamma as RouterNode,
      this.nodes.router_delta as RouterNode,
    ];

    for (const r of routers) {
      r.lsdb = fullLsdb;
      rebuildForwardingTableFromLSDB(r);
    }
  }

  /**
   * Cuts a specific cable in the network.
   * Drops physical carrier, triggers OSPF link-state convergence, and logs event.
   */
  public cut(cableId: string): void {
    const cable = this.cables[cableId];
    if (!cable) return;
    cutCable(cable);
    // Frames that were half-received on this cable can never complete.
    const ends = [
      `${cable.nodeA.nodeId}:${cable.nodeA.interfaceName}:`,
      `${cable.nodeB.nodeId}:${cable.nodeB.interfaceName}:`,
    ];
    for (const key of [...this.rxBuffers.keys()]) {
      if (ends.some((prefix) => key.startsWith(prefix))) this.rxBuffers.delete(key);
    }
    this.refreshLinkStateTopology();
    this.logDiagnostic(
      `CABLE CUT: ${cable.name} severed! Carrier dropped. Dijkstra SPF recomputing routing tables...`
    );
  }

  /**
   * Repairs a cut cable.
   * Restores physical carrier, triggers OSPF convergence.
   */
  public repair(cableId: string): void {
    const cable = this.cables[cableId];
    if (!cable) return;
    repairCable(cable);
    this.refreshLinkStateTopology();
    this.logDiagnostic(
      `CABLE REPAIRED: ${cable.name} reconnected. Link-state advertisements flooded, shortest paths restored.`
    );
  }

  /**
   * Toggles noise injection on a cable.
   */
  public toggleNoise(cableId: string): void {
    const cable = this.cables[cableId];
    if (!cable) return;
    toggleCableNoise(cable);
  }

  /**
   * Helper to log diagnostic notices.
   */
  private logDiagnostic(msg: string): void {
    // Add diagnostic entry into captured packets table
    this.capturedPackets.unshift({
      id: this.packetIdCounter++,
      timestamp: this.simTimeMs,
      deltaMs: 0,
      cableId: 'system',
      cableName: 'Physical Telemetry',
      sourceNodeId: 'SYSTEM',
      targetNodeId: 'OPERATOR',
      rawBytes: new Uint8Array(0),
      rawBits: [],
      manchesterWaveform: [],
      crcValid: true,
      crcComputed: 0,
      crcReceived: 0,
      l2: { srcMac: '00:00:00:00:00:00', dstMac: '00:00:00:00:00:00', etherType: '0x0000', payloadLength: 0 },
      summary: msg,
      status: 'delivered',
    });
  }

  /**
   * High-level action: User requests a Web Page by domain name (e.g. "http://hypertext.org")
   */
  public fetchUrl(urlStr: string): void {
    let clean = urlStr.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'http://' + clean;
    }
    this.currentUrl = clean;

    const parsed = new URL(clean);
    const domain = parsed.hostname;

    this.browserState = {
      status: 'resolving_dns',
      renderedHtml: '',
      resolvedIp: null,
      bytesReceived: 0,
      totalExpectedBytes: 0,
      loadTimeMs: 0,
    };

    // Step 1: Initiate DNS Query from Client Workstation
    this.sendDnsQuery(domain);
  }

  /**
   * Sends real RFC 1035 DNS Query over UDP port 53.
   */
  private sendDnsQuery(domain: string): void {
    const client = this.nodes.client as HostNode;
    const dnsQueryPayload = serializeDnsQuery(domain);

    // UDP pseudo packet: [SrcPort 2B] [DstPort 2B] [Length 2B] [Checksum 2B] + Payload
    const udpLen = 8 + dnsQueryPayload.length;
    const udpBuf = new Uint8Array(udpLen);
    const clientEphemeralPort = 53042;

    udpBuf[0] = (clientEphemeralPort >> 8) & 0xff;
    udpBuf[1] = clientEphemeralPort & 0xff;
    udpBuf[2] = 0; // Dst Port 53
    udpBuf[3] = DNS_PORT;
    udpBuf[4] = (udpLen >> 8) & 0xff;
    udpBuf[5] = udpLen & 0xff;
    udpBuf[6] = 0; udpBuf[7] = 0; // Checksum optional in UDP or 0
    udpBuf.set(dnsQueryPayload, 8);

    // Wrap in IPv4 packet
    const ipPacket = serializeIpv4Packet(
      client.interfaces.eth0.ip!,
      client.dnsServer!,
      IP_PROTO_UDP,
      udpBuf
    );

    // Look up MAC of DNS server
    const targetMac = client.arpTable[client.dnsServer!]?.mac || BROADCAST_MAC;
    const ethFrame = serializeEthernetFrame(
      targetMac,
      client.interfaces.eth0.mac,
      ETHERTYPE_IPV4,
      ipPacket
    );

    // Transmit across physical cable into local switch
    this.queueFrameToCable(this.cables.cable_client_sw, ethFrame, 'a_to_b', 'client', 'sw_local');
  }

  /**
   * Connects TCP from Client to resolved Web Server IP on Port 80.
   */
  private initiateTcpHandshake(serverIp: string, hostHeader: string): void {
    const client = this.nodes.client as HostNode;
    const clientPort = 49152 + Math.floor(Math.random() * 1000);
    const serverPort = 80;
    const isn = 1000;

    const connId = `${serverIp}:${serverPort}`;
    const tcpConn: TcpConnection = {
      id: connId,
      localIp: client.interfaces.eth0.ip!,
      localPort: clientPort,
      remoteIp: serverIp,
      remotePort: serverPort,
      state: 'SYN_SENT',
      seqNumber: isn + 1,
      ackNumber: 0,
      advertisedWindow: 65535,
      unacknowledgedQueue: [],
      receiveBuffer: new Map(),
      nextExpectedSeq: 0,
      rtoTimerMs: INITIAL_RTO_MS,
      lastActivityMs: this.simTimeMs,
      appCallback: (data: Uint8Array) => {
        this.handleClientReceivedHttpData(data);
      },
    };

    client.tcpConnections[connId] = tcpConn;
    this.browserState.status = 'connecting_tcp';

    // Craft TCP SYN Segment
    const synSegment = serializeTcpSegment(
      tcpConn.localIp,
      tcpConn.remoteIp,
      tcpConn.localPort,
      tcpConn.remotePort,
      isn,
      0,
      { syn: true },
      tcpConn.advertisedWindow
    );

    // Store in unacknowledgedQueue for retransmission if cable is severed
    tcpConn.unacknowledgedQueue.push({
      seq: isn,
      data: synSegment,
      timestamp: this.simTimeMs,
      retransmitCount: 0,
    });

    this.sendIpv4FromHost(client, serverIp, IP_PROTO_TCP, synSegment);
  }

  /**
   * Client sends HTTP GET Request once TCP 3-Way Handshake is ESTABLISHED.
   */
  private sendClientHttpRequest(conn: TcpConnection): void {
    const client = this.nodes.client as HostNode;
    const parsed = new URL(this.currentUrl);
    const uri = parsed.pathname || '/';
    const host = parsed.hostname;

    const httpPayload = serializeHttpRequest('GET', uri, host);

    this.browserState.status = 'sending_http';

    // Craft TCP PSH+ACK segment
    const tcpSegment = serializeTcpSegment(
      conn.localIp,
      conn.remoteIp,
      conn.localPort,
      conn.remotePort,
      conn.seqNumber,
      conn.ackNumber,
      { psh: true, ack: true },
      conn.advertisedWindow,
      httpPayload
    );

    conn.unacknowledgedQueue.push({
      seq: conn.seqNumber,
      data: tcpSegment,
      timestamp: this.simTimeMs,
      retransmitCount: 0,
    });

    conn.seqNumber += httpPayload.length;
    this.sendIpv4FromHost(client, conn.remoteIp, IP_PROTO_TCP, tcpSegment);
  }

  /**
   * Helper to send an IPv4 packet from a Host via its default gateway.
   */
  private sendIpv4FromHost(
    host: HostNode,
    destIp: string,
    protocol: number,
    payload: Uint8Array
  ): void {
    const iface = host.interfaces.eth0;
    const ipPacket = serializeIpv4Packet(iface.ip!, destIp, protocol, payload);

    // Determine next hop MAC (direct if same subnet, or default gateway)
    const nextHopIp = host.defaultGateway || destIp;
    const nextHopMac = host.arpTable[nextHopIp]?.mac || host.arpTable[destIp]?.mac || BROADCAST_MAC;

    const ethFrame = serializeEthernetFrame(
      nextHopMac,
      iface.mac,
      ETHERTYPE_IPV4,
      ipPacket
    );

    const cable = this.cables[iface.cableId!];
    if (cable) {
      const dir = cable.nodeA.nodeId === host.id ? 'a_to_b' : 'b_to_a';
      const targetNode = dir === 'a_to_b' ? cable.nodeB.nodeId : cable.nodeA.nodeId;
      this.queueFrameToCable(cable, ethFrame, dir, host.id, targetNode);
    }
  }

  /**
   * Serializes an Ethernet frame into Manchester bits and launches it onto a physical cable.
   */
  public queueFrameToCable(
    cable: Cable,
    frameBytes: Uint8Array,
    direction: 'a_to_b' | 'b_to_a',
    sourceNodeId: string,
    targetNodeId: string
  ): void {
    // 1. Physical serialization: Adds Preamble (0xAA) + SFD (0xAB) + FCS (CRC-32)
    const { bitsWithPreamble, fullBufferWithFcs } = frameToPhysicalBitstream(frameBytes);

    // 2. Launch onto copper cable
    const frameId = transmitBitsOnCable(cable, bitsWithPreamble, direction, sourceNodeId, targetNodeId);

    // 3. Log to Packet Capture table with full decoding
    this.recordPacketCapture(cable, fullBufferWithFcs, bitsWithPreamble, sourceNodeId, targetNodeId);
  }

  /**
   * Deep Packet Inspection & Capture Logging.
   */
  private recordPacketCapture(
    cable: Cable,
    frameBytes: Uint8Array,
    bitsWithPreamble: Bit[],
    sourceNodeId: string,
    targetNodeId: string
  ): void {
    const decodedL2 = deserializeEthernetFrame(frameBytes);
    if (!decodedL2) return;

    const sampleSlice = bitsWithPreamble.slice(0, 128); // capture first 128 bits for waveform
    const waveform = generateWaveformSamples(sampleSlice, 4).map((s) => s.voltage);

    let l3Info: CapturedPacket['l3'] = undefined;
    let l4Info: CapturedPacket['l4'] = undefined;
    let l7Info: CapturedPacket['l7'] = undefined;
    let summary = `Frame: ${decodedL2.srcMac} -> ${decodedL2.dstMac} [${decodedL2.rawBytes.length} bytes]`;

    if (decodedL2.etherType === ETHERTYPE_IPV4) {
      const ipv4 = deserializeIpv4Packet(decodedL2.payload);
      if (ipv4) {
        l3Info = {
          protocol: 'IPv4',
          srcIp: ipv4.srcIp,
          dstIp: ipv4.dstIp,
          ttl: ipv4.ttl,
          identification: ipv4.identification,
          headerChecksumValid: ipv4.checksumValid,
        };

        if (ipv4.protocol === IP_PROTO_TCP) {
          const tcp = deserializeTcpSegment(ipv4.payload, ipv4.srcIp, ipv4.dstIp);
          if (tcp) {
            const flagsStr = [
              tcp.flags.syn ? 'SYN' : null,
              tcp.flags.ack ? 'ACK' : null,
              tcp.flags.psh ? 'PSH' : null,
              tcp.flags.fin ? 'FIN' : null,
              tcp.flags.rst ? 'RST' : null,
            ].filter(Boolean).join(',');

            l4Info = {
              protocol: 'TCP',
              srcPort: tcp.srcPort,
              dstPort: tcp.dstPort,
              seqNumber: tcp.seqNumber,
              ackNumber: tcp.ackNumber,
              flags: tcp.flags,
              windowSize: tcp.windowSize,
              checksumValid: tcp.checksumValid,
            };

            summary = `TCP ${tcp.srcPort} -> ${tcp.dstPort} [${flagsStr}] Seq=${tcp.seqNumber} Ack=${tcp.ackNumber} Win=${tcp.windowSize}`;

            // Check if HTTP
            if (tcp.payload.length > 0) {
              const req = parseHttpRequest(tcp.payload);
              if (req) {
                l7Info = {
                  protocol: 'HTTP',
                  info: `${req.method} ${req.uri} HTTP/1.1`,
                  summary: `HTTP Request: ${req.method} ${req.uri} (Host: ${req.headers.host || 'unknown'})`,
                  httpMethod: req.method,
                  httpUri: req.uri,
                };
                summary = `HTTP ${req.method} ${req.uri}`;
              } else {
                const res = parseHttpResponse(tcp.payload);
                if (res) {
                  l7Info = {
                    protocol: 'HTTP',
                    info: `HTTP/1.1 ${res.statusCode} ${res.statusText}`,
                    summary: `HTTP Response: ${res.statusCode} ${res.statusText} (${res.headers['content-type'] || 'text'})`,
                    httpStatusCode: res.statusCode,
                  };
                  summary = `HTTP/1.1 ${res.statusCode} ${res.statusText} (${res.body.length} bytes)`;
                }
              }
            }
          }
        } else if (ipv4.protocol === IP_PROTO_UDP) {
          if (ipv4.payload.length >= 8) {
            const dstPort = (ipv4.payload[2] << 8) | ipv4.payload[3];
            const srcPort = (ipv4.payload[0] << 8) | ipv4.payload[1];
            if (dstPort === DNS_PORT || srcPort === DNS_PORT) {
              const dns = deserializeDnsMessage(ipv4.payload.subarray(8));
              if (dns) {
                l7Info = {
                  protocol: 'DNS',
                  info: dns.isResponse
                    ? `DNS Resp: ${dns.answers[0]?.data || 'no answer'}`
                    : `DNS Query: ${dns.questions[0]?.name || ''}`,
                  summary: dns.isResponse
                    ? `Standard query response A ${dns.answers[0]?.name} -> ${dns.answers[0]?.data}`
                    : `Standard query 0x${dns.transactionId.toString(16)} A ${dns.questions[0]?.name}`,
                  dnsQuestion: dns.questions[0]?.name,
                  dnsAnswer: dns.answers[0]?.data,
                };
                summary = l7Info.summary;
              }
            }
          }
        }
      }
    } else if (decodedL2.etherType === ETHERTYPE_ARP) {
      const arp = deserializeArp(decodedL2.payload);
      if (arp) {
        summary = arp.opcode === ARP_OPCODE_REQUEST
          ? `ARP Who has ${arp.targetIp}? Tell ${arp.senderIp}`
          : `ARP ${arp.senderIp} is-at ${arp.senderMac}`;
      }
    }

    const packet: CapturedPacket = {
      id: this.packetIdCounter++,
      timestamp: this.simTimeMs,
      deltaMs: 0,
      cableId: cable.id,
      cableName: cable.name,
      sourceNodeId,
      targetNodeId,
      rawBytes: frameBytes,
      rawBits: bitsWithPreamble,
      manchesterWaveform: waveform,
      crcValid: decodedL2.fcsValid,
      crcComputed: decodedL2.computedCrc,
      crcReceived: decodedL2.receivedCrc,
      l2: {
        srcMac: decodedL2.srcMac,
        dstMac: decodedL2.dstMac,
        etherType: `0x${decodedL2.etherType.toString(16).padStart(4, '0')}`,
        payloadLength: decodedL2.payload.length,
      },
      l3: l3Info,
      l4: l4Info,
      l7: l7Info,
      summary,
      status: decodedL2.fcsValid ? 'delivered' : 'dropped_crc',
    };

    this.capturedPackets.unshift(packet);
    if (this.capturedPackets.length > 300) {
      this.capturedPackets.pop();
    }
  }

  /**
   * Master clock tick: updates physics, cable queues, node processing, and TCP timers.
   */
  public tick(rawDeltaMs: number): void {
    if (!this.isRunning) return;

    const deltaMs = rawDeltaMs * this.simSpeed;
    this.simTimeMs += deltaMs;

    // 1. Advance Physical Cable Signal Propagation
    for (const cable of Object.values(this.cables)) {
      const { deliveredToA, deliveredToB } = tickCablePhysics(cable, deltaMs);

      // Collect delivered bits on end A
      if (deliveredToA.length > 0) {
        const nodeA = this.nodes[cable.nodeA.nodeId];
        const ifaceA = nodeA.interfaces[cable.nodeA.interfaceName];
        if (ifaceA) {
          this.receiveBitsOnInterface(nodeA, ifaceA, deliveredToA, cable);
        }
      }

      // Collect delivered bits on end B
      if (deliveredToB.length > 0) {
        const nodeB = this.nodes[cable.nodeB.nodeId];
        const ifaceB = nodeB.interfaces[cable.nodeB.interfaceName];
        if (ifaceB) {
          this.receiveBitsOnInterface(nodeB, ifaceB, deliveredToB, cable);
        }
      }
    }

    // 2. TCP Retransmission Timers (RTO Check)
    this.checkTcpRetransmissions();
  }

  /**
   * Interface Physical Receiver: Decodes bits via Manchester receiver and passes to node layer.
   */
  private receiveBitsOnInterface(
    node: NetworkNode,
    iface: NetworkInterface,
    wireBits: WireBit[],
    cable: Cable
  ): void {
    // Bits of one frame arrive spread over several ticks. Buffer them per
    // interface and frame, and decode only once the whole frame has arrived.
    const completeFrames: Bit[][] = [];
    for (const wb of wireBits) {
      const key = `${node.id}:${iface.name}:${wb.frameId}`;
      let buf = this.rxBuffers.get(key);
      if (!buf) {
        buf = [];
        this.rxBuffers.set(key, buf);
      }
      buf.push(wb.bit);
      if (buf.length >= wb.frameBitCount) {
        this.rxBuffers.delete(key);
        completeFrames.push(buf);
      }
    }

    for (const bits of completeFrames) {
      // Decode physical bitstream (recovers SFD, octets, and verifies IEEE 802.3 CRC-32)
      const decoded = decodePhysicalBitstream(bits);

      if (!decoded.success || !decoded.frameBytes) {
        iface.stats.crcErrors++;
        continue;
      }

      if (!decoded.crcValid) {
        iface.stats.crcErrors++;
        continue; // Drop corrupted frame
      }

      iface.stats.rxPackets++;
      iface.stats.rxBytes += decoded.frameBytes.length;

      // Dispatch to node protocol handler
      this.handleReceivedFrameOnNode(node, iface.name, decoded.frameBytes);
    }
  }

  /**
   * Node Protocol Dispatcher: Switch vs Router vs Host
   */
  private handleReceivedFrameOnNode(
    node: NetworkNode,
    ingressPort: string,
    rawBytes: Uint8Array
  ): void {
    if (node.type === 'switch') {
      // Switched Ethernet L2 CAM forwarding
      const swResult = processSwitchFrame(node as SwitchNode, ingressPort, rawBytes, this.simTimeMs);
      for (const outPort of swResult.forwardedPorts) {
        const outIface = node.interfaces[outPort];
        if (outIface && outIface.cableId) {
          const cable = this.cables[outIface.cableId];
          if (cable && cable.status !== 'severed') {
            const dir = cable.nodeA.nodeId === node.id ? 'a_to_b' : 'b_to_a';
            const targetNode = dir === 'a_to_b' ? cable.nodeB.nodeId : cable.nodeA.nodeId;
            this.queueFrameToCable(cable, rawBytes, dir, node.id, targetNode);
          }
        }
      }
      return;
    }

    // Node is a Host or Router
    const decodedL2 = deserializeEthernetFrame(rawBytes);
    if (!decodedL2) return;

    // Filter by destination MAC: must be our MAC or BROADCAST
    const myMac = node.interfaces[ingressPort]?.mac;
    const isForMe = decodedL2.dstMac === myMac || decodedL2.dstMac === BROADCAST_MAC;
    if (!isForMe) return;

    if (node.type === 'router') {
      this.handleRouterIngress(node as RouterNode, ingressPort, decodedL2.payload, decodedL2.etherType);
    } else {
      this.handleHostIngress(node as HostNode, ingressPort, decodedL2.payload, decodedL2.etherType);
    }
  }

  /**
   * Router Forwarding Engine: Decrements TTL, recalculates checksum, looks up FIB, forwards packet.
   */
  private handleRouterIngress(
    router: RouterNode,
    ingressPort: string,
    payload: Uint8Array,
    etherType: number
  ): void {
    if (etherType === ETHERTYPE_IPV4) {
      const ipv4 = deserializeIpv4Packet(payload);
      if (!ipv4 || !ipv4.checksumValid) return;

      // Check TTL
      if (ipv4.ttl <= 1) {
        return; // Drop TTL expired
      }

      // Check if packet destination is one of the router's own IPs
      let isForRouterSelf = false;
      for (const iface of Object.values(router.interfaces)) {
        if (iface.ip === ipv4.dstIp) {
          isForRouterSelf = true;
          break;
        }
      }

      if (isForRouterSelf) {
        // Router management / control plane
        return;
      }

      // Forwarding Decision: Longest Prefix Match (LPM) on Forwarding Table (FIB)
      const route = lookupRoute(router.forwardingTable, ipv4.dstIp);
      if (!route) {
        return; // No route to host, drop
      }

      const outIface = router.interfaces[route.interfaceName];
      if (!outIface || !outIface.carrierUp || !outIface.cableId) {
        return; // Interface down or severed cable
      }

      // Decrement TTL and re-serialize IPv4 packet
      const newTtl = ipv4.ttl - 1;
      const forwardedIpv4 = serializeIpv4Packet(
        ipv4.srcIp,
        ipv4.dstIp,
        ipv4.protocol,
        ipv4.payload,
        newTtl
      );

      // Resolve Next-Hop MAC
      let nextHopMac = BROADCAST_MAC;
      if (route.nextHop === 'DIRECT') {
        nextHopMac = router.arpTable[ipv4.dstIp]?.mac || BROADCAST_MAC;
      } else {
        // OSPF routes name the next hop by router ID. On a point-to-point /30
        // link the neighbour's interface address is the other usable host.
        const nextHopIp =
          outIface.netmask === '255.255.255.252' && outIface.ip
            ? pointToPointPeer(outIface.ip)
            : route.nextHop;
        nextHopMac = router.arpTable[nextHopIp]?.mac || router.arpTable[route.nextHop]?.mac || BROADCAST_MAC;
      }

      // Encapsulate in new Ethernet II frame with router's source MAC
      const newEthFrame = serializeEthernetFrame(
        nextHopMac,
        outIface.mac,
        ETHERTYPE_IPV4,
        forwardedIpv4
      );

      const cable = this.cables[outIface.cableId];
      if (cable && cable.status !== 'severed') {
        const dir = cable.nodeA.nodeId === router.id ? 'a_to_b' : 'b_to_a';
        const targetNode = dir === 'a_to_b' ? cable.nodeB.nodeId : cable.nodeA.nodeId;
        this.queueFrameToCable(cable, newEthFrame, dir, router.id, targetNode);
      }
    }
  }

  /**
   * Host Ingress Engine: DNS Server, HTTP Server, or Client Browser
   */
  private handleHostIngress(
    host: HostNode,
    ingressPort: string,
    payload: Uint8Array,
    etherType: number
  ): void {
    if (etherType === ETHERTYPE_IPV4) {
      const ipv4 = deserializeIpv4Packet(payload);
      if (!ipv4 || !ipv4.checksumValid) return;

      // 1. DNS Server (Port 53 UDP)
      if (host.id === 'dns' && ipv4.protocol === IP_PROTO_UDP) {
        this.handleDnsServerMessage(host, ipv4);
        return;
      }

      // 2. Client receiving DNS Response
      if (host.id === 'client' && ipv4.protocol === IP_PROTO_UDP) {
        this.handleClientDnsResponse(ipv4);
        return;
      }

      // 3. Web Servers (Port 80 TCP)
      if (host.type === 'server' && ipv4.protocol === IP_PROTO_TCP) {
        this.handleHttpServerTcp(host, ipv4);
        return;
      }

      // 4. Client TCP Processing (HTTP stream)
      if (host.id === 'client' && ipv4.protocol === IP_PROTO_TCP) {
        this.handleClientTcp(host, ipv4);
        return;
      }
    }
  }

  /**
   * DNS Server processes Query and returns A record.
   */
  private handleDnsServerMessage(dnsHost: HostNode, ipv4: ReturnType<typeof deserializeIpv4Packet> & object): void {
    const udpPayload = ipv4.payload.subarray(8);
    const dnsMsg = deserializeDnsMessage(udpPayload);
    if (!dnsMsg || dnsMsg.isResponse || dnsMsg.questions.length === 0) return;

    const queryDomain = dnsMsg.questions[0].name;
    const resolvedIp = dnsHost.dnsRecords?.[queryDomain] || '192.168.20.80';

    const respDns = serializeDnsResponse(dnsMsg.transactionId, queryDomain, resolvedIp);

    // Build UDP reply
    const udpLen = 8 + respDns.length;
    const udpBuf = new Uint8Array(udpLen);
    const clientPort = (ipv4.payload[0] << 8) | ipv4.payload[1];

    udpBuf[0] = 0; udpBuf[1] = DNS_PORT;
    udpBuf[2] = (clientPort >> 8) & 0xff;
    udpBuf[3] = clientPort & 0xff;
    udpBuf[4] = (udpLen >> 8) & 0xff;
    udpBuf[5] = udpLen & 0xff;
    udpBuf.set(respDns, 8);

    this.sendIpv4FromHost(dnsHost, ipv4.srcIp, IP_PROTO_UDP, udpBuf);
  }

  /**
   * Client receives DNS Response: extracts resolved IP and launches TCP Handshake!
   */
  private handleClientDnsResponse(ipv4: ReturnType<typeof deserializeIpv4Packet> & object): void {
    const udpPayload = ipv4.payload.subarray(8);
    const dnsMsg = deserializeDnsMessage(udpPayload);
    if (!dnsMsg || !dnsMsg.isResponse || dnsMsg.answers.length === 0) return;

    const resolvedIp = dnsMsg.answers[0].data;
    const domain = dnsMsg.answers[0].name;

    this.browserState.resolvedIp = resolvedIp;
    this.browserState.status = 'connecting_tcp';

    // Proceed to Step 2: Establish TCP Connection
    this.initiateTcpHandshake(resolvedIp, domain);
  }

  /**
   * HTTP Web Server TCP State Machine & Request Handler
   */
  private handleHttpServerTcp(server: HostNode, ipv4: ReturnType<typeof deserializeIpv4Packet> & object): void {
    const tcp = deserializeTcpSegment(ipv4.payload, ipv4.srcIp, ipv4.dstIp);
    if (!tcp || !tcp.checksumValid) return;

    const connKey = `${ipv4.srcIp}:${tcp.srcPort}`;
    let conn = server.tcpConnections[connKey];

    // Case 1: Incoming SYN -> Respond with SYN-ACK
    if (tcp.flags.syn && !tcp.flags.ack) {
      const serverIsn = 5000;
      conn = {
        id: connKey,
        localIp: ipv4.dstIp,
        localPort: tcp.dstPort,
        remoteIp: ipv4.srcIp,
        remotePort: tcp.srcPort,
        state: 'SYN_RECEIVED',
        seqNumber: serverIsn + 1,
        ackNumber: tcp.seqNumber + 1,
        advertisedWindow: 65535,
        unacknowledgedQueue: [],
        receiveBuffer: new Map(),
        nextExpectedSeq: tcp.seqNumber + 1,
        rtoTimerMs: INITIAL_RTO_MS,
        lastActivityMs: this.simTimeMs,
      };
      server.tcpConnections[connKey] = conn;

      const synAck = serializeTcpSegment(
        conn.localIp,
        conn.remoteIp,
        conn.localPort,
        conn.remotePort,
        serverIsn,
        conn.ackNumber,
        { syn: true, ack: true },
        conn.advertisedWindow
      );

      this.sendIpv4FromHost(server, conn.remoteIp, IP_PROTO_TCP, synAck);
      return;
    }

    if (!conn) return;

    if (tcp.flags.ack) {
      this.processAck(conn, tcp.ackNumber);
    }

    // Case 2: Final Handshake ACK from client
    if (tcp.flags.ack && conn.state === 'SYN_RECEIVED' && tcp.payload.length === 0) {
      conn.state = 'ESTABLISHED';
      return;
    }

    // Case 3: Data received (HTTP Request payload)
    if (tcp.payload.length > 0) {
      // A retransmitted request we already answered: acknowledge it again,
      // but do not send the response a second time.
      const isDuplicate = tcp.seqNumber + tcp.payload.length <= conn.nextExpectedSeq;
      conn.ackNumber = Math.max(conn.nextExpectedSeq, tcp.seqNumber + tcp.payload.length);
      conn.nextExpectedSeq = conn.ackNumber;

      // Send ACK for data
      const ackSegment = serializeTcpSegment(
        conn.localIp,
        conn.remoteIp,
        conn.localPort,
        conn.remotePort,
        conn.seqNumber,
        conn.ackNumber,
        { ack: true },
        conn.advertisedWindow
      );
      this.sendIpv4FromHost(server, conn.remoteIp, IP_PROTO_TCP, ackSegment);
      if (isDuplicate) return;

      // Parse HTTP Request
      const req = parseHttpRequest(tcp.payload);
      if (req) {
        const hostKey = (req.headers.host || 'hypertext.org').split(':')[0];
        const page = WEB_CATALOG[hostKey] || WEB_CATALOG['hypertext.org'];

        const httpRespBytes = serializeHttpResponse(
          200,
          'OK',
          'text/html; charset=utf-8',
          page.html
        );

        // Stream HTTP response chunks across TCP (breaking into 512-byte MSS chunks)
        const MSS = 512;
        let offset = 0;
        while (offset < httpRespBytes.length) {
          const chunk = httpRespBytes.subarray(offset, Math.min(offset + MSS, httpRespBytes.length));
          const isLast = (offset + MSS >= httpRespBytes.length);

          const dataSegment = serializeTcpSegment(
            conn.localIp,
            conn.remoteIp,
            conn.localPort,
            conn.remotePort,
            conn.seqNumber,
            conn.ackNumber,
            { psh: isLast, ack: true },
            conn.advertisedWindow,
            chunk
          );

          conn.unacknowledgedQueue.push({
            seq: conn.seqNumber,
            data: dataSegment,
            timestamp: this.simTimeMs,
            retransmitCount: 0,
          });

          conn.seqNumber += chunk.length;
          offset += MSS;

          this.sendIpv4FromHost(server, conn.remoteIp, IP_PROTO_TCP, dataSegment);
        }
      }
    }
  }

  /**
   * Client TCP Processing: Receives SYN-ACK, completes handshake, accumulates HTTP stream.
   */
  private handleClientTcp(client: HostNode, ipv4: ReturnType<typeof deserializeIpv4Packet> & object): void {
    const tcp = deserializeTcpSegment(ipv4.payload, ipv4.srcIp, ipv4.dstIp);
    if (!tcp || !tcp.checksumValid) return;

    const connKey = `${ipv4.srcIp}:${tcp.srcPort}`;
    const conn = client.tcpConnections[connKey];
    if (!conn) return;

    // Remove acknowledged segments from retransmission queue
    if (tcp.flags.ack) {
      this.processAck(conn, tcp.ackNumber);
    }

    // Step 2 Completed: Received SYN-ACK from server
    if (tcp.flags.syn && tcp.flags.ack && conn.state === 'SYN_SENT') {
      conn.state = 'ESTABLISHED';
      conn.ackNumber = tcp.seqNumber + 1;
      conn.nextExpectedSeq = tcp.seqNumber + 1;

      // Send ACK to complete 3-Way Handshake
      const ackSeg = serializeTcpSegment(
        conn.localIp,
        conn.remoteIp,
        conn.localPort,
        conn.remotePort,
        conn.seqNumber,
        conn.ackNumber,
        { ack: true },
        conn.advertisedWindow
      );
      this.sendIpv4FromHost(client, conn.remoteIp, IP_PROTO_TCP, ackSeg);

      // Now send the actual HTTP GET Request!
      this.sendClientHttpRequest(conn);
      return;
    }

    // Step 3: Receiving HTTP Data Stream from Server
    if (tcp.payload.length > 0 && conn.state === 'ESTABLISHED') {
      // Deliver bytes to the application in sequence order only. Retransmitted
      // duplicates are re-acknowledged but not delivered twice; early segments
      // wait in the receive buffer until the gap before them is filled.
      const delivered: Uint8Array[] = [];
      if (tcp.seqNumber > conn.nextExpectedSeq) {
        conn.receiveBuffer.set(tcp.seqNumber, tcp.payload);
      } else if (tcp.seqNumber === conn.nextExpectedSeq) {
        delivered.push(tcp.payload);
        conn.nextExpectedSeq += tcp.payload.length;
        let next = conn.receiveBuffer.get(conn.nextExpectedSeq);
        while (next) {
          conn.receiveBuffer.delete(conn.nextExpectedSeq);
          delivered.push(next);
          conn.nextExpectedSeq += next.length;
          next = conn.receiveBuffer.get(conn.nextExpectedSeq);
        }
      }
      conn.ackNumber = conn.nextExpectedSeq;

      // Send immediate TCP ACK back to server
      const ackSeg = serializeTcpSegment(
        conn.localIp,
        conn.remoteIp,
        conn.localPort,
        conn.remotePort,
        conn.seqNumber,
        conn.ackNumber,
        { ack: true },
        conn.advertisedWindow
      );
      this.sendIpv4FromHost(client, conn.remoteIp, IP_PROTO_TCP, ackSeg);

      // Pass in-order payload to the application callback
      for (const chunk of delivered) conn.appCallback?.(chunk);
    }
  }

  /**
   * Client accumulates HTTP response chunks and renders web page once complete.
   */
  private handleClientReceivedHttpData(chunk: Uint8Array): void {
    this.browserState.status = 'receiving_stream';
    this.browserState.bytesReceived += chunk.length;

    // Parse HTTP response
    const res = parseHttpResponse(chunk);
    if (res) {
      this.browserState.renderedHtml = res.body;
      this.browserState.totalExpectedBytes = parseInt(res.headers['content-length'] || `${chunk.length}`, 10);
      this.browserState.status = 'loaded';
    } else {
      // Stream continuation
      const text = bytesToString(chunk);
      this.browserState.renderedHtml += text;
      this.browserState.status = 'loaded';
    }
  }

  /**
   * Drops segments covered by a cumulative ACK and, following Karn's rule,
   * updates the smoothed RTT from segments that were never retransmitted.
   */
  private processAck(conn: TcpConnection, ackNumber: number): void {
    const remaining: typeof conn.unacknowledgedQueue = [];
    for (const seg of conn.unacknowledgedQueue) {
      if (seg.seq < ackNumber) {
        if (seg.retransmitCount === 0) {
          const sample = this.simTimeMs - seg.timestamp;
          if (conn.srttMs === undefined || conn.rttVarMs === undefined) {
            conn.srttMs = sample;
            conn.rttVarMs = sample / 2;
          } else {
            conn.rttVarMs = 0.75 * conn.rttVarMs + 0.25 * Math.abs(conn.srttMs - sample);
            conn.srttMs = 0.875 * conn.srttMs + 0.125 * sample;
          }
          conn.rtoTimerMs = Math.min(MAX_RTO_MS, Math.max(MIN_RTO_MS, conn.srttMs + 4 * conn.rttVarMs));
        }
      } else {
        remaining.push(seg);
      }
    }
    conn.unacknowledgedQueue = remaining;
  }

  /**
   * TCP Retransmission Mechanism:
   * If packets in unacknowledgedQueue exceed RTO, retransmit them!
   * This is how the web page continues loading even when cables are cut!
   */
  private checkTcpRetransmissions(): void {
    const hosts = [this.nodes.client as HostNode, this.nodes.server1 as HostNode, this.nodes.server2 as HostNode];

    for (const host of hosts) {
      for (const conn of Object.values(host.tcpConnections)) {
        for (const seg of conn.unacknowledgedQueue) {
          // Exponential backoff: each retransmission doubles the wait.
          const rto = Math.min(MAX_RTO_MS, conn.rtoTimerMs * 2 ** seg.retransmitCount);
          if (this.simTimeMs - seg.timestamp > rto) {
            // RTO expired! Retransmit
            seg.timestamp = this.simTimeMs;
            seg.retransmitCount++;

            this.logDiagnostic(
              `TCP RETRANSMIT: Seq=${seg.seq} on ${host.name} (Retransmission #${seg.retransmitCount}). Cable cut or dropped frame recovered!`
            );

            this.sendIpv4FromHost(host, conn.remoteIp, IP_PROTO_TCP, seg.data);
          }
        }
      }
    }
  }
}
