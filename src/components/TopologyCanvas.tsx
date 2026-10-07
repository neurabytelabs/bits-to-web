import React, { useRef, useEffect } from 'react';
import { Scissors, Wrench, Activity, AlertTriangle, Radio } from 'lucide-react';
import { NetworkEngine } from '../simulation/networkEngine';
import { Cable, NetworkNode } from '../types/network';

interface TopologyCanvasProps {
  engine: NetworkEngine;
  selectedCableId: string;
  onSelectCable: (cableId: string) => void;
  onCutCable: (cableId: string) => void;
  onRepairCable: (cableId: string) => void;
  onToggleNoise: (cableId: string) => void;
}

export const TopologyCanvas: React.FC<TopologyCanvasProps> = ({
  engine,
  selectedCableId,
  onSelectCable,
  onCutCable,
  onRepairCable,
  onToggleNoise,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // High-frequency render loop for smooth bit particle flow and electrical sparks
  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      // Auto resize canvas to match client dimensions
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      // Coordinate scaling factor based on container width
      // Base layout design is ~1250px wide by 460px high
      const scaleX = width / 1250;
      const scaleY = height / 460;
      const scale = Math.min(scaleX, scaleY);
      const offsetX = (width - 1250 * scale) / 2;
      const offsetY = (height - 460 * scale) / 2;

      const getNodePos = (nodeId: string) => {
        const n = engine.nodes[nodeId];
        if (!n) return { x: 0, y: 0 };
        return {
          x: offsetX + n.x * scale,
          y: offsetY + n.y * scale,
        };
      };

      // 1. Draw Cables (Physical links)
      for (const cable of Object.values(engine.cables)) {
        const posA = getNodePos(cable.nodeA.nodeId);
        const posB = getNodePos(cable.nodeB.nodeId);
        const isSelected = cable.id === selectedCableId;
        const isSevered = cable.status === 'severed';
        const isNoisy = cable.status === 'noisy';

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(posA.x, posA.y);
        ctx.lineTo(posB.x, posB.y);

        if (isSevered) {
          // Severed cable: dashed red with broken gap
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = isSelected ? 4 : 2.5;
          ctx.setLineDash([8, 12]);
          ctx.stroke();

          // Draw spark effect at center
          const midX = (posA.x + posB.x) / 2;
          const midY = (posA.y + posB.y) / 2;
          ctx.fillStyle = '#f87171';
          ctx.beginPath();
          ctx.arc(midX + (Math.random() * 6 - 3), midY + (Math.random() * 6 - 3), 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Operational cable: glowing cyan/emerald
          ctx.setLineDash([]);
          ctx.strokeStyle = isSelected
            ? '#22d3ee'
            : isNoisy
            ? '#f59e0b'
            : '#0284c7';
          ctx.lineWidth = isSelected ? 3.5 : 2;
          ctx.shadowColor = isSelected ? '#22d3ee' : '#0369a1';
          ctx.shadowBlur = isSelected ? 10 : 4;
          ctx.stroke();

          // 2. Draw bits currently propagating in flight
          for (const wb of cable.bitsInFlight) {
            if (wb.progress < 0 || wb.progress > 1) continue;

            const t = wb.direction === 'a_to_b' ? wb.progress : 1 - wb.progress;
            const bitX = posA.x + (posB.x - posA.x) * t;
            const bitY = posA.y + (posB.y - posA.y) * t;

            // Draw bit pulse
            ctx.shadowBlur = 8;
            ctx.shadowColor = wb.bit === 1 ? '#38bdf8' : '#a855f7';
            ctx.fillStyle = wb.bit === 1 ? '#7dd3fc' : '#c084fc';

            ctx.beginPath();
            ctx.arc(bitX, bitY, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // 3. Draw Nodes (Hosts, Switches, Routers)
      for (const node of Object.values(engine.nodes)) {
        const pos = getNodePos(node.id);
        const nodeW = 76 * scale;
        const nodeH = 46 * scale;

        ctx.save();
        // Background card
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle =
          node.type === 'router'
            ? '#38bdf8'
            : node.type === 'switch'
            ? '#10b981'
            : '#64748b';
        ctx.lineWidth = 1.5;

        // Rounded rect
        const rx = pos.x - nodeW / 2;
        const ry = pos.y - nodeH / 2;
        ctx.beginPath();
        ctx.roundRect(rx, ry, nodeW, nodeH, 6 * scale);
        ctx.fill();
        ctx.stroke();

        // Node Title
        ctx.fillStyle = '#f1f5f9';
        ctx.font = `600 ${Math.max(10, Math.round(11 * scale))}px 'Plus Jakarta Sans', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const shortName =
          node.id === 'client'
            ? 'Client PC'
            : node.id === 'dns'
            ? 'DNS Server'
            : node.id === 'sw_local'
            ? 'LAN Switch'
            : node.id === 'router_alpha'
            ? 'Router Alpha'
            : node.id === 'router_beta'
            ? 'Router Beta'
            : node.id === 'router_gamma'
            ? 'Router Gamma'
            : node.id === 'router_delta'
            ? 'Router Delta'
            : node.id === 'sw_core'
            ? 'Core Switch'
            : node.id === 'server1'
            ? 'Web Server'
            : 'Retro Server';

        ctx.fillText(shortName, pos.x, pos.y - 6 * scale);

        // Subtext (IP or Type)
        ctx.fillStyle = '#94a3b8';
        ctx.font = `${Math.max(8, Math.round(9 * scale))}px 'JetBrains Mono', monospace`;
        const sub =
          node.type === 'switch'
            ? 'L2 MAC Bridge'
            : (node as any).routerId
            ? `ID: ${(node as any).routerId}`
            : (node as any).interfaces.eth0?.ip || '';

        ctx.fillText(sub, pos.x, pos.y + 10 * scale);
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [engine, selectedCableId]);

  return (
    <div className="w-full shrink-0 bg-slate-950 border-b border-slate-800 select-none">
      <div className="relative w-full h-[230px] overflow-hidden">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, #38bdf8 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* HTML5 Canvas for real-time electrical bits animation */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {/* Interactive Controls Overlay for Cables (Scissors, Status, Selection) */}
      <div className="absolute top-2 left-3 z-10 flex items-center gap-3 text-xs text-slate-400 bg-slate-900/80 backdrop-blur px-2.5 py-1 rounded border border-slate-800">
        <span className="flex items-center gap-1.5 text-cyan-300 font-medium">
          <Activity className="w-3.5 h-3.5" />
          Physical Copper Topology
        </span>
        <span>·</span>
        <span className="hidden sm:inline">Click any cable below to cut or inspect Manchester bits</span>
      </div>
      </div>

      {/* Interactive Cable Cutting & Selector Pills */}
      <div className="px-3 py-2 border-t border-slate-800/60 flex flex-wrap items-center gap-1.5">
        {Object.values(engine.cables).map((cable) => {
          const isSelected = cable.id === selectedCableId;
          const isSevered = cable.status === 'severed';
          const isNoisy = cable.status === 'noisy';

          return (
            <div
              key={cable.id}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono border transition-all ${
                isSelected
                  ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200'
                  : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <button
                onClick={() => onSelectCable(cable.id)}
                className="hover:underline flex items-center gap-1"
                title={`Inspect ${cable.name}`}
              >
                <span>{cable.name.split(' (')[0]}</span>
                {cable.bitsInFlight.length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                )}
              </button>

              {/* Cable Cut / Repair action */}
              <button
                onClick={() => (isSevered ? onRepairCable(cable.id) : onCutCable(cable.id))}
                className={`p-0.5 rounded transition-colors ${
                  isSevered
                    ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                    : 'text-slate-400 hover:text-rose-400'
                }`}
                title={isSevered ? 'Repair this cable' : 'Cut this cable with scissors'}
              >
                {isSevered ? <Wrench className="w-3 h-3" /> : <Scissors className="w-3 h-3" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
