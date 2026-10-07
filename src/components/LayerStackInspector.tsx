import React, { useState, useRef, useEffect } from 'react';
import {
  Layers,
  Radio,
  Network,
  Cpu,
  Binary,
  ShieldCheck,
  CheckCircle,
  Eye,
  Sliders,
} from 'lucide-react';
import { LayerZoom, CapturedPacket } from '../types/network';
import { NetworkEngine } from '../simulation/networkEngine';
import { generateWaveformSamples } from '../simulation/manchester';

interface LayerStackInspectorProps {
  engine: NetworkEngine;
  activePacket: CapturedPacket | null;
  selectedCableId: string;
  onSelectCable: (cableId: string) => void;
}

export const LayerStackInspector: React.FC<LayerStackInspectorProps> = ({
  engine,
  activePacket,
  selectedCableId,
  onSelectCable,
}) => {
  const [activeLayer, setActiveLayer] = useState<LayerZoom>('L1_PHYSICAL');
  const oscilloscopeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // If no active packet is clicked from packet capture, use the latest packet on the selected cable
  const packet =
    activePacket ||
    engine.capturedPackets.find((p) => p.cableId === selectedCableId) ||
    engine.capturedPackets[0] ||
    null;

  // Real-time oscilloscope animation for Layer 1
  useEffect(() => {
    let animId: number;
    const canvas = oscilloscopeCanvasRef.current;
    if (!canvas || activeLayer !== 'L1_PHYSICAL') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let phase = 0;

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      // Grid lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;

      // Center line (0V)
      const midY = height / 2;
      const topY = midY - height * 0.35; // +2.5V
      const botY = midY + height * 0.35; // -2.5V

      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();

      // Rail dashed lines
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, topY);
      ctx.lineTo(width, topY);
      ctx.moveTo(0, botY);
      ctx.lineTo(width, botY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Voltage labels
      ctx.fillStyle = '#64748b';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText('+2.5V', 6, topY - 3);
      ctx.fillText(' 0.0V (Idle / Ground)', 6, midY - 3);
      ctx.fillText('-2.5V', 6, botY - 3);

      // Cable state check
      const selectedCable = engine.cables[selectedCableId];
      const isSevered = selectedCable?.status === 'severed';

      if (isSevered) {
        // Flat 0V with noise
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          const noise = (Math.random() - 0.5) * 3;
          if (x === 0) ctx.moveTo(x, midY + noise);
          else ctx.lineTo(x, midY + noise);
        }
        ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText('LOSS OF CARRIER (LOS) — ZERO VOLTAGE / CABLE SEVERED', width / 2 - 160, midY - 14);
        animId = requestAnimationFrame(render);
        return;
      }

      // Generate waveform data from packet bits or continuous clock
      const bitsToDraw = packet?.rawBits && packet.rawBits.length > 0
        ? packet.rawBits.slice(0, 48)
        : [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1]; // Preamble default

      const bitWidth = 36; // pixels per bit period
      const totalBits = bitsToDraw.length;

      // Draw clock reference line at top
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      const clockY = 20;
      const clockH = 10;
      ctx.beginPath();
      for (let i = 0; i < totalBits; i++) {
        const bx = i * bitWidth - (phase % bitWidth);
        ctx.moveTo(bx, clockY + clockH);
        ctx.lineTo(bx, clockY);
        ctx.lineTo(bx + bitWidth / 2, clockY);
        ctx.lineTo(bx + bitWidth / 2, clockY + clockH);
        ctx.lineTo(bx + bitWidth, clockY + clockH);
      }
      ctx.stroke();

      ctx.fillStyle = '#475569';
      ctx.fillText('RECOVERED CLOCK', width - 110, clockY + 8);

      // Draw Manchester analog voltage transitions
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 8;
      ctx.beginPath();

      let lastY = midY;

      for (let i = 0; i < totalBits; i++) {
        const bit = bitsToDraw[i];
        const bx = i * bitWidth - (phase % bitWidth);

        // IEEE 802.3 Manchester:
        // Bit 0: High (+2.5V) -> Low (-2.5V)
        // Bit 1: Low (-2.5V) -> High (+2.5V)
        const yFirst = bit === 0 ? topY : botY;
        const ySecond = bit === 0 ? botY : topY;

        if (i === 0) {
          ctx.moveTo(bx, yFirst);
        } else {
          // Transition from previous bit end
          ctx.lineTo(bx, yFirst);
        }

        // Hold first half
        ctx.lineTo(bx + bitWidth / 2, yFirst);
        // Mid-bit transition! (Clock synchronization edge)
        ctx.lineTo(bx + bitWidth / 2, ySecond);
        // Hold second half
        ctx.lineTo(bx + bitWidth, ySecond);

        lastY = ySecond;

        // Draw bit value label
        ctx.shadowBlur = 0;
        ctx.fillStyle = bit === 1 ? '#38bdf8' : '#a855f7';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(`${bit}`, bx + bitWidth / 2 - 3, midY + (bit === 0 ? -12 : 16));
        ctx.shadowBlur = 8;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw bit boundary vertical guidelines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let i = 0; i < totalBits; i++) {
        const bx = i * bitWidth - (phase % bitWidth);
        ctx.beginPath();
        ctx.moveTo(bx, clockY + clockH + 4);
        ctx.lineTo(bx, height - 10);
        ctx.stroke();
      }

      phase += 0.5;
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [activeLayer, packet, selectedCableId, engine]);

  const layers: { id: LayerZoom; label: string; name: string; icon: React.ReactNode }[] = [
    { id: 'L7_APPLICATION', label: 'Layer 7', name: 'Application (HTTP / DNS)', icon: <Layers className="w-3.5 h-3.5 text-amber-400" /> },
    { id: 'L4_TCP', label: 'Layer 4', name: 'Transport (TCP)', icon: <Cpu className="w-3.5 h-3.5 text-purple-400" /> },
    { id: 'L3_IP', label: 'Layer 3', name: 'Network (IPv4 & OSPF)', icon: <Network className="w-3.5 h-3.5 text-blue-400" /> },
    { id: 'L2_ETHERNET', label: 'Layer 2', name: 'Data Link (Ethernet II)', icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> },
    { id: 'L1_PHYSICAL', label: 'Layer 1', name: 'Physical (Bits & Manchester)', icon: <Radio className="w-3.5 h-3.5 text-cyan-400" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* Zoom Selector Header */}
      <div className="h-10 bg-slate-950 px-3 flex items-center justify-between gap-2 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-200 whitespace-nowrap">Omni-Depth Microscope</span>
          <span className="text-[11px] text-slate-500 hidden 2xl:inline whitespace-nowrap">
            · Zoom through OSI layers into individual bits
          </span>
        </div>

        {/* Layer Tabs */}
        <div className="flex items-center bg-slate-900 p-0.5 rounded border border-slate-800 text-[11px] font-mono shrink-0">
          {layers.map((l) => (
            <button
              key={l.id}
              onClick={() => setActiveLayer(l.id)}
              className={`px-2 py-1 rounded transition-all flex items-center gap-1.5 whitespace-nowrap ${
                activeLayer === l.id
                  ? 'bg-slate-800 text-cyan-300 font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {l.icon}
              <span className="hidden 2xl:inline">{l.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Layer Content Pane */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-950 text-xs">
        {/* ================= LEVEL 1: PHYSICAL LAYER ================= */}
        {activeLayer === 'L1_PHYSICAL' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-cyan-300 flex items-center gap-2">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  Layer 1: Manchester Voltage Signaling & Bit Transitions
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  IEEE 802.3 Baseband Carrier: Self-clocking bi-phase modulation over twisted copper pairs.
                </p>
              </div>

              {/* Cable Probe Selector */}
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="text-slate-500 whitespace-nowrap">Oscilloscope Probe:</span>
                <select
                  value={selectedCableId}
                  onChange={(e) => onSelectCable(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-cyan-300 px-2 py-1 rounded outline-none"
                >
                  {Object.values(engine.cables).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.status.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Live Oscilloscope Trace Display */}
            <div className="bg-slate-900/90 border border-slate-800 rounded p-2 relative">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1 px-1">
                <span>TIMEBASE: 100ns/div · VERTICAL: 1.0V/div</span>
                <span className="text-cyan-400">TRIGGER: Mid-Bit Clock Edge Synchronized</span>
              </div>
              <canvas
                ref={oscilloscopeCanvasRef}
                className="w-full h-36 bg-slate-950 rounded border border-slate-800 block"
              />
            </div>

            {/* Bitstream Octet Breakdown */}
            <div className="p-3 bg-slate-900/60 rounded border border-slate-800 space-y-2">
              <div className="text-[11px] font-semibold text-slate-300">
                Active Frame Physical Bitstream ({packet?.rawBits?.length || 0} bits):
              </div>

              <div className="font-mono text-[10px] break-all p-2 bg-slate-950 rounded border border-slate-800/80 leading-relaxed text-slate-300">
                {packet?.rawBits && packet.rawBits.length > 0 ? (
                  <>
                    <span className="text-amber-400 bg-amber-950/40 px-1 py-0.5 rounded mr-1" title="7-byte Preamble (0xAA)">
                      {packet.rawBits.slice(0, 56).join('')} [PREAMBLE 0xAA]
                    </span>
                    <span className="text-rose-400 bg-rose-950/40 px-1 py-0.5 rounded mr-1" title="1-byte Start Frame Delimiter (0xAB)">
                      {packet.rawBits.slice(56, 64).join('')} [SFD 0xAB]
                    </span>
                    <span className="text-cyan-300">
                      {packet.rawBits.slice(64).join('')}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500">Awaiting frame transmission...</span>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono pt-1 text-slate-400">
                <div className="p-2 bg-slate-950 rounded border border-slate-800">
                  <span className="text-slate-500">Bit 0 Transition:</span>
                  <div className="text-purple-400 font-semibold mt-0.5">+2.5V &rarr; -2.5V (Falling)</div>
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800">
                  <span className="text-slate-500">Bit 1 Transition:</span>
                  <div className="text-sky-400 font-semibold mt-0.5">-2.5V &rarr; +2.5V (Rising)</div>
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800">
                  <span className="text-slate-500">Clock Recovery:</span>
                  <div className="text-emerald-400 font-semibold mt-0.5">Phase-Locked Edge</div>
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800">
                  <span className="text-slate-500">Inter-Packet Gap:</span>
                  <div className="text-amber-400 font-semibold mt-0.5">96 bit times (960ns)</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= LEVEL 2: DATA LINK LAYER ================= */}
        {activeLayer === 'L2_ETHERNET' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Layer 2: Switched Ethernet II Frame & MAC Hardware
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                48-bit Media Access Control addresses, EtherType identification, and IEEE 802.3 CRC-32 Frame Check Sequence.
              </p>
            </div>

            {packet?.l2 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono">
                <div className="p-3 bg-slate-900 rounded border border-slate-800 space-y-1.5">
                  <span className="text-slate-400 font-sans text-xs font-medium">Destination MAC Address</span>
                  <div className="text-emerald-400 text-sm font-semibold">{packet.l2.dstMac}</div>
                  <div className="text-[10px] text-slate-500">
                    {packet.l2.dstMac === 'FF:FF:FF:FF:FF:FF' ? 'Broadcast (Flooded to all switch ports)' : 'Unicast Hardware Recipient'}
                  </div>
                </div>

                <div className="p-3 bg-slate-900 rounded border border-slate-800 space-y-1.5">
                  <span className="text-slate-400 font-sans text-xs font-medium">Source MAC Address</span>
                  <div className="text-emerald-400 text-sm font-semibold">{packet.l2.srcMac}</div>
                  <div className="text-[10px] text-slate-500">Hardware Interface Transmitter</div>
                </div>

                <div className="p-3 bg-slate-900 rounded border border-slate-800 space-y-1.5">
                  <span className="text-slate-400 font-sans text-xs font-medium">EtherType</span>
                  <div className="text-cyan-400 text-sm font-semibold">{packet.l2.etherType}</div>
                  <div className="text-[10px] text-slate-500">
                    {packet.l2.etherType === '0x0800' ? 'IPv4 Protocol (RFC 791)' : packet.l2.etherType === '0x0806' ? 'ARP Address Resolution' : 'Link-State Protocol'}
                  </div>
                </div>

                <div className="p-3 bg-slate-900 rounded border border-slate-800 space-y-1.5">
                  <span className="text-slate-400 font-sans text-xs font-medium">Frame Check Sequence (CRC-32)</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-emerald-400">
                      0x{packet.crcComputed.toString(16).toUpperCase().padStart(8, '0')}
                    </span>
                    <span className="text-emerald-400 flex items-center gap-1 text-[10px]">
                      <CheckCircle className="w-3 h-3" /> MATCHED
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">Polynomial: 0xEDB88320 (IEEE 802.3 standard)</div>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500">No packet selected.</div>
            )}
          </div>
        )}

        {/* ================= LEVEL 3: NETWORK LAYER ================= */}
        {activeLayer === 'L3_IP' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-blue-300 flex items-center gap-2">
                <Network className="w-4 h-4 text-blue-400" />
                Layer 3: IPv4 Routing & Link-State Convergence (OSPF)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Hop-by-hop packet forwarding, TTL decrementing, and real-time Dijkstra Shortest Path First calculation.
              </p>
            </div>

            {packet?.l3 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono">
                <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
                  <span className="text-slate-500 text-[10px]">Source IP:</span>
                  <div className="text-blue-300 font-semibold text-xs mt-0.5">{packet.l3.srcIp}</div>
                </div>
                <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
                  <span className="text-slate-500 text-[10px]">Destination IP:</span>
                  <div className="text-blue-300 font-semibold text-xs mt-0.5">{packet.l3.dstIp}</div>
                </div>
                <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
                  <span className="text-slate-500 text-[10px]">Time To Live (TTL):</span>
                  <div className="text-amber-400 font-semibold text-xs mt-0.5">{packet.l3.ttl} hops remaining</div>
                </div>
                <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
                  <span className="text-slate-500 text-[10px]">Header Checksum:</span>
                  <div className="text-emerald-400 font-semibold text-xs mt-0.5">RFC 791 Valid</div>
                </div>
              </div>
            ) : null}

            {/* Router Alpha Live Forwarding Information Base (FIB) */}
            <div className="p-3 bg-slate-900 rounded border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">
                  Router Alpha Forwarding Table (Dijkstra Computed FIB):
                </span>
                <span className="text-[10px] font-mono text-cyan-400">OSPF LINK-STATE CONVERGED</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="py-1">Destination Subnet</th>
                      <th className="py-1">Netmask</th>
                      <th className="py-1">Next Hop</th>
                      <th className="py-1">Interface</th>
                      <th className="py-1">Metric</th>
                      <th className="py-1">Protocol</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {(engine.nodes.router_alpha as any).forwardingTable.map((entry: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-800/40">
                        <td className="py-1 text-cyan-300">{entry.destinationSubnet}</td>
                        <td className="py-1 text-slate-400">{entry.netmask}</td>
                        <td className="py-1 text-amber-300">{entry.nextHop}</td>
                        <td className="py-1 text-slate-300">{entry.interfaceName}</td>
                        <td className="py-1 font-semibold">{entry.metric}</td>
                        <td className="py-1">
                          <span className={`px-1.5 py-0.2 rounded text-[10px] ${
                            entry.learnedVia === 'OSPF' ? 'bg-blue-950 text-blue-300' : 'bg-slate-800 text-slate-400'
                          }`}>
                            {entry.learnedVia}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================= LEVEL 4: TRANSPORT LAYER ================= */}
        {activeLayer === 'L4_TCP' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-purple-300 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-purple-400" />
                Layer 4: Transmission Control Protocol (TCP - RFC 793)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Reliable stream delivery with byte-level sequence numbers, sliding window flow control, and automated retransmission timers (RTO).
              </p>
            </div>

            {packet?.l4 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono">
                  <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 text-[10px]">Source Port:</span>
                    <div className="text-purple-300 font-semibold text-xs mt-0.5">{packet.l4.srcPort}</div>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 text-[10px]">Destination Port:</span>
                    <div className="text-purple-300 font-semibold text-xs mt-0.5">
                      {packet.l4.dstPort} {packet.l4.dstPort === 80 ? '(HTTP)' : ''}
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 text-[10px]">Sequence Number:</span>
                    <div className="text-cyan-300 font-semibold text-xs mt-0.5">{packet.l4.seqNumber}</div>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 text-[10px]">Acknowledgment Number:</span>
                    <div className="text-amber-300 font-semibold text-xs mt-0.5">{packet.l4.ackNumber}</div>
                  </div>
                </div>

                {/* Flags breakdown */}
                {packet.l4.flags && (
                  <div className="p-3 bg-slate-900 rounded border border-slate-800">
                    <div className="text-slate-400 font-medium text-xs mb-2">Control Flags Active:</div>
                    <div className="flex flex-wrap gap-2 text-xs font-mono">
                      {Object.entries(packet.l4.flags).map(([flag, active]) => (
                        <div
                          key={flag}
                          className={`px-2 py-1 rounded border ${
                            active
                              ? 'bg-purple-950/80 border-purple-500 text-purple-200 font-bold'
                              : 'bg-slate-950 border-slate-800 text-slate-600'
                          }`}
                        >
                          {flag.toUpperCase()}: {active ? '1' : '0'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500">Selected packet is not TCP.</div>
            )}
          </div>
        )}

        {/* ================= LEVEL 7: APPLICATION LAYER ================= */}
        {activeLayer === 'L7_APPLICATION' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400" />
                Layer 7: Application Protocol (HTTP / DNS)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Human-readable protocol headers and raw serialized application payloads.
              </p>
            </div>

            {packet?.l7 ? (
              <div className="space-y-3">
                <div className="p-3 bg-slate-900 rounded border border-slate-800">
                  <div className="text-slate-400 font-medium text-xs mb-1">Decoded Protocol Info:</div>
                  <div className="text-amber-300 font-mono text-sm font-semibold">{packet.l7.summary}</div>
                </div>

                {packet.l7.protocol === 'HTTP' && (
                  <div className="p-3 bg-slate-900 rounded border border-slate-800 font-mono text-xs space-y-1">
                    <div className="text-slate-500 text-[10px] uppercase font-sans mb-1">Raw HTTP Payload:</div>
                    <pre className="p-2 bg-slate-950 rounded border border-slate-800 overflow-x-auto text-slate-200 leading-relaxed">
                      {new TextDecoder().decode(packet.rawBytes.subarray(14 + 20 + 20))}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500">No application payload in this frame.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
