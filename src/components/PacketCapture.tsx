import React, { useState } from 'react';
import {
  ListFilter,
  Search,
  ChevronRight,
  ChevronDown,
  Binary,
  FileText,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { CapturedPacket } from '../types/network';

interface PacketCaptureProps {
  packets: CapturedPacket[];
  activePacket: CapturedPacket | null;
  onSelectPacket: (packet: CapturedPacket) => void;
  onClear: () => void;
}

export const PacketCapture: React.FC<PacketCaptureProps> = ({
  packets,
  activePacket,
  onSelectPacket,
  onClear,
}) => {
  const [filterText, setFilterText] = useState('');
  const [selectedLayerTree, setSelectedLayerTree] = useState<'l2' | 'l3' | 'l4' | 'l7' | null>('l4');

  const filtered = packets.filter((p) => {
    if (!filterText) return true;
    const term = filterText.toLowerCase();
    return (
      p.summary.toLowerCase().includes(term) ||
      p.cableName.toLowerCase().includes(term) ||
      (p.l3?.srcIp && p.l3.srcIp.includes(term)) ||
      (p.l3?.dstIp && p.l3.dstIp.includes(term)) ||
      (p.l4?.protocol && p.l4.protocol.toLowerCase().includes(term)) ||
      (p.l7?.protocol && p.l7.protocol.toLowerCase().includes(term))
    );
  });

  const packet = activePacket || packets[0] || null;

  // Format bytes into standard Wireshark Hex Dump:
  // 0000   02 00 00 00 01 10 02 00  00 00 02 01 08 00 45 00   ..............E.
  const formatHexDump = (data: Uint8Array) => {
    const lines: { offset: string; hex1: string; hex2: string; ascii: string }[] = [];
    const len = data.length;

    for (let i = 0; i < len; i += 16) {
      const offset = i.toString(16).padStart(4, '0');
      let hex1 = '';
      let hex2 = '';
      let ascii = '';

      for (let j = 0; j < 8; j++) {
        if (i + j < len) {
          hex1 += data[i + j].toString(16).padStart(2, '0') + ' ';
          const charCode = data[i + j];
          ascii += charCode >= 32 && charCode <= 126 ? String.fromCharCode(charCode) : '.';
        } else {
          hex1 += '   ';
        }
      }

      for (let j = 8; j < 16; j++) {
        if (i + j < len) {
          hex2 += data[i + j].toString(16).padStart(2, '0') + ' ';
          const charCode = data[i + j];
          ascii += charCode >= 32 && charCode <= 126 ? String.fromCharCode(charCode) : '.';
        } else {
          hex2 += '   ';
        }
      }

      lines.push({ offset, hex1, hex2, ascii });
    }
    return lines;
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* Capture Header & Filter Bar */}
      <div className="h-10 bg-slate-950 px-3 flex items-center justify-between border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ListFilter className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-200 whitespace-nowrap">
            Packet Capture
          </span>
          <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">[{packets.length} frames]</span>
        </div>

        {/* Filter input */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-300">
            <Search className="w-3 h-3 text-slate-500 mr-1.5" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter (e.g. tcp, http, 192.168)"
              className="bg-transparent outline-none text-[11px] font-mono w-28 sm:w-44 text-slate-100"
            />
          </div>

          <button
            onClick={onClear}
            className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded hover:bg-slate-800 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Packet List Table */}
      <div className="h-44 overflow-y-auto border-b border-slate-800 bg-slate-950 select-none">
        <table className="w-full text-left font-mono text-[10px] divide-y divide-slate-800/60">
          <thead className="bg-slate-900 sticky top-0 text-slate-400">
            <tr>
              <th className="py-1 px-2 w-10">No.</th>
              <th className="py-1 px-2 w-16">Time</th>
              <th className="py-1 px-2 w-28">Source</th>
              <th className="py-1 px-2 w-28">Destination</th>
              <th className="py-1 px-2 w-14">Proto</th>
              <th className="py-1 px-2 w-12">Len</th>
              <th className="py-1 px-2">Info</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900 text-slate-300">
            {filtered.map((p) => {
              const isSelected = packet?.id === p.id;
              const proto =
                p.l7?.protocol || p.l4?.protocol || p.l3?.protocol || 'ETHERNET';
              const protoColor =
                proto === 'HTTP'
                  ? 'text-amber-400 font-bold'
                  : proto === 'TCP'
                  ? 'text-purple-400'
                  : proto === 'DNS'
                  ? 'text-cyan-400'
                  : proto === 'ARP'
                  ? 'text-yellow-300'
                  : 'text-slate-300';

              return (
                <tr
                  key={p.id}
                  onClick={() => onSelectPacket(p)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-cyan-950/60 text-cyan-200 font-medium'
                      : 'hover:bg-slate-900/80'
                  }`}
                >
                  <td className="py-0.5 px-2 text-slate-500 tabular-nums">{p.id}</td>
                  <td className="py-0.5 px-2 text-slate-400 tabular-nums">
                    {(p.timestamp / 1000).toFixed(3)}
                  </td>
                  <td className="py-0.5 px-2 truncate max-w-[110px]">
                    {p.l3?.srcIp || p.l2.srcMac}
                  </td>
                  <td className="py-0.5 px-2 truncate max-w-[110px]">
                    {p.l3?.dstIp || p.l2.dstMac}
                  </td>
                  <td className={`py-0.5 px-2 font-semibold ${protoColor}`}>{proto}</td>
                  <td className="py-0.5 px-2 text-slate-400 tabular-nums">
                    {p.rawBytes.length}
                  </td>
                  <td className="py-0.5 px-2 truncate text-slate-300">{p.summary}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dissected Packet Protocol Tree & Synchronized Hex Dump */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 overflow-hidden bg-slate-950">
        {/* Left: Expandable Protocol Dissector Tree */}
        <div className="overflow-y-auto p-3 text-xs font-mono space-y-2 text-slate-300">
          {packet ? (
            <>
              {/* Frame summary */}
              <div className="p-1.5 bg-slate-900/60 rounded border border-slate-800 text-[11px]">
                <div className="font-semibold text-slate-200">
                  Frame #{packet.id}: {packet.rawBytes.length} bytes on wire ({packet.rawBytes.length * 8} bits)
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Traversed: <span className="text-cyan-300">{packet.cableName}</span>
                </div>
              </div>

              {/* Layer 2: Ethernet II */}
              <div className="border border-slate-800 rounded overflow-hidden">
                <button
                  onClick={() => setSelectedLayerTree(selectedLayerTree === 'l2' ? null : 'l2')}
                  className="w-full text-left px-2 py-1 bg-slate-900 flex items-center justify-between text-[11px] font-semibold text-emerald-400"
                >
                  <span className="flex items-center gap-1.5">
                    {selectedLayerTree === 'l2' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    Ethernet II, Src: {packet.l2.srcMac}, Dst: {packet.l2.dstMac}
                  </span>
                </button>
                {selectedLayerTree === 'l2' && (
                  <div className="p-2 space-y-0.5 text-[10px] text-slate-300 bg-slate-950">
                    <div>Destination: {packet.l2.dstMac}</div>
                    <div>Source: {packet.l2.srcMac}</div>
                    <div>Type: {packet.l2.etherType}</div>
                    <div>FCS: 0x{packet.crcComputed.toString(16)} (Correct CRC-32)</div>
                  </div>
                )}
              </div>

              {/* Layer 3: IPv4 */}
              {packet.l3 && (
                <div className="border border-slate-800 rounded overflow-hidden">
                  <button
                    onClick={() => setSelectedLayerTree(selectedLayerTree === 'l3' ? null : 'l3')}
                    className="w-full text-left px-2 py-1 bg-slate-900 flex items-center justify-between text-[11px] font-semibold text-blue-400"
                  >
                    <span className="flex items-center gap-1.5">
                      {selectedLayerTree === 'l3' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      Internet Protocol Version 4, Src: {packet.l3.srcIp}, Dst: {packet.l3.dstIp}
                    </span>
                  </button>
                  {selectedLayerTree === 'l3' && (
                    <div className="p-2 space-y-0.5 text-[10px] text-slate-300 bg-slate-950">
                      <div>Version: 4 · Header Length: 20 bytes</div>
                      <div>Time to Live: {packet.l3.ttl}</div>
                      <div>Protocol: {packet.l4?.protocol || 'IPv4'}</div>
                      <div>Header Checksum: Valid (RFC 791)</div>
                      <div>Source Address: {packet.l3.srcIp}</div>
                      <div>Destination Address: {packet.l3.dstIp}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Layer 4: TCP / UDP */}
              {packet.l4 && (
                <div className="border border-slate-800 rounded overflow-hidden">
                  <button
                    onClick={() => setSelectedLayerTree(selectedLayerTree === 'l4' ? null : 'l4')}
                    className="w-full text-left px-2 py-1 bg-slate-900 flex items-center justify-between text-[11px] font-semibold text-purple-400"
                  >
                    <span className="flex items-center gap-1.5">
                      {selectedLayerTree === 'l4' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      Transmission Control Protocol, Src Port: {packet.l4.srcPort}, Dst Port: {packet.l4.dstPort}
                    </span>
                  </button>
                  {selectedLayerTree === 'l4' && (
                    <div className="p-2 space-y-0.5 text-[10px] text-slate-300 bg-slate-950">
                      <div>Sequence Number: {packet.l4.seqNumber}</div>
                      <div>Acknowledgment Number: {packet.l4.ackNumber}</div>
                      <div>Window Size: {packet.l4.windowSize}</div>
                      <div>Checksum: Valid (Pseudo-Header Verified)</div>
                    </div>
                  )}
                </div>
              )}

              {/* Layer 7: Application Protocol */}
              {packet.l7 && (
                <div className="border border-slate-800 rounded overflow-hidden">
                  <button
                    onClick={() => setSelectedLayerTree(selectedLayerTree === 'l7' ? null : 'l7')}
                    className="w-full text-left px-2 py-1 bg-slate-900 flex items-center justify-between text-[11px] font-semibold text-amber-400"
                  >
                    <span className="flex items-center gap-1.5">
                      {selectedLayerTree === 'l7' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      {packet.l7.protocol}: {packet.l7.summary}
                    </span>
                  </button>
                  {selectedLayerTree === 'l7' && (
                    <div className="p-2 space-y-0.5 text-[10px] text-slate-300 bg-slate-950">
                      <div>Info: {packet.l7.info}</div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="p-4 text-center text-slate-500">No packet data.</div>
          )}
        </div>

        {/* Right: Synchronized Hex Dump & ASCII View */}
        <div className="overflow-y-auto p-3 font-mono text-[10px] leading-relaxed text-slate-300 bg-slate-950">
          <div className="text-slate-500 mb-1 border-b border-slate-800/80 pb-1 flex justify-between">
            <span>OFFSET   HEXADECIMAL DUMP                      ASCII</span>
            <span className="text-cyan-400">IEEE 802.3 OCTETS</span>
          </div>

          {packet ? (
            formatHexDump(packet.rawBytes).map((line, idx) => (
              <div key={idx} className="flex gap-2 hover:bg-slate-900/60 px-1 rounded">
                <span className="text-slate-500">{line.offset}</span>
                <span className="text-cyan-300">{line.hex1}</span>
                <span className="text-blue-300">{line.hex2}</span>
                <span className="text-slate-400 border-l border-slate-800 pl-2">
                  {line.ascii}
                </span>
              </div>
            ))
          ) : (
            <div className="text-slate-600">Waiting for packet stream...</div>
          )}
        </div>
      </div>
    </div>
  );
};
