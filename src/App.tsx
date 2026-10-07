import React, { useRef, useState, useEffect, useCallback } from 'react';
import { NetworkEngine } from './simulation/networkEngine';
import { CapturedPacket } from './types/network';
import { TopBar } from './components/TopBar';
import { TopologyCanvas } from './components/TopologyCanvas';
import { BrowserView } from './components/BrowserView';
import { LayerStackInspector } from './components/LayerStackInspector';
import { PacketCapture } from './components/PacketCapture';
import { CableChaosDeck } from './components/CableChaosDeck';
import { Layers, ListFilter, Sparkles, Scissors, Radio, Network } from 'lucide-react';

export default function App() {
  const engineRef = useRef<NetworkEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new NetworkEngine();
  }
  const engine = engineRef.current;

  // React state for reactive updates
  const [, setTickCounter] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [simSpeed, setSimSpeed] = useState(1.0);
  const [selectedCableId, setSelectedCableId] = useState('cable_alpha_beta');
  const [activePacket, setActivePacket] = useState<CapturedPacket | null>(null);
  const [rightViewMode, setRightViewMode] = useState<'stack' | 'capture' | 'both'>('both');

  // Simulation Clock Runner
  useEffect(() => {
    let lastTime = performance.now();
    let animId: number;

    const loop = (currentTime: number) => {
      const deltaMs = Math.min(currentTime - lastTime, 100);
      lastTime = currentTime;

      if (engine.isRunning) {
        engine.tick(deltaMs);
        // Force lightweight re-render every 3 frames for reactive UI elements
        setTickCounter((prev) => (prev + 1) % 1000);
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [engine]);

  // Initial load: automatically launch first web page fetch after mount so the internet starts live!
  useEffect(() => {
    const timer = setTimeout(() => {
      engine.fetchUrl('http://hypertext.org');
    }, 400);
    return () => clearTimeout(timer);
  }, [engine]);

  const handleTogglePlay = useCallback(() => {
    engine.isRunning = !engine.isRunning;
    setIsRunning(engine.isRunning);
  }, [engine]);

  const handleReset = useCallback(() => {
    engineRef.current = new NetworkEngine();
    setSelectedCableId('cable_alpha_beta');
    setActivePacket(null);
    setTickCounter((p) => p + 1);
  }, []);

  const handleChangeSpeed = useCallback((speed: number) => {
    engine.simSpeed = speed;
    setSimSpeed(speed);
  }, [engine]);

  const handleCutCable = useCallback((id: string) => {
    engine.cut(id);
    setSelectedCableId(id);
    setTickCounter((p) => p + 1);
  }, [engine]);

  const handleRepairCable = useCallback((id: string) => {
    engine.repair(id);
    setSelectedCableId(id);
    setTickCounter((p) => p + 1);
  }, [engine]);

  const handleToggleNoise = useCallback((id: string) => {
    engine.toggleNoise(id);
    setSelectedCableId(id);
    setTickCounter((p) => p + 1);
  }, [engine]);

  const handleNavigate = useCallback((url: string) => {
    engine.fetchUrl(url);
    setActivePacket(null);
    setTickCounter((p) => p + 1);
  }, [engine]);

  // Chaos experiments & guided tours
  const handleRunTour = useCallback((tourId: string) => {
    if (tourId === 'normal_fetch') {
      engine.repair('cable_alpha_beta');
      engine.repair('cable_alpha_gamma');
      engine.fetchUrl('http://hypertext.org');
    } else if (tourId === 'cut_mid_transfer') {
      // Repair first, launch request, then cut primary cable 150ms in!
      engine.repair('cable_alpha_beta');
      engine.repair('cable_alpha_gamma');
      engine.fetchUrl('http://the-internals.net');
      setTimeout(() => {
        engine.cut('cable_alpha_beta');
        setTickCounter((p) => p + 1);
      }, 160);
    } else if (tourId === 'inject_noise') {
      engine.repair('cable_alpha_beta');
      engine.toggleNoise('cable_alpha_beta');
      engine.fetchUrl('http://retro.net');
    }
    setTickCounter((p) => p + 1);
  }, [engine]);

  const primaryCable = engine.cables.cable_alpha_beta;
  const isPrimaryCut = primaryCable?.status === 'severed';

  const handleTriggerChaos = useCallback(() => {
    if (isPrimaryCut) {
      handleRepairCable('cable_alpha_beta');
    } else {
      handleCutCable('cable_alpha_beta');
    }
  }, [isPrimaryCut, handleRepairCable, handleCutCable]);

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* 1. Universal Top Navigation Bar */}
      <TopBar
        engine={engine}
        isRunning={isRunning}
        onTogglePlay={handleTogglePlay}
        onReset={handleReset}
        simSpeed={simSpeed}
        onChangeSpeed={handleChangeSpeed}
        onTriggerChaos={handleTriggerChaos}
        primaryCut={isPrimaryCut}
      />

      {/* 2. Interactive Physical Copper Network Topology */}
      <TopologyCanvas
        engine={engine}
        selectedCableId={selectedCableId}
        onSelectCable={setSelectedCableId}
        onCutCable={handleCutCable}
        onRepairCable={handleRepairCable}
        onToggleNoise={handleToggleNoise}
      />

      {/* 3. Main Workspace: Web Browser on Left + Zoom Microscope & Packet Capture on Right */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-2 p-2 bg-slate-950 overflow-hidden">
        {/* Left Column: Browser Window (40% width on desktop) */}
        <div className="lg:col-span-5 h-full flex flex-col min-h-0">
          <BrowserView engine={engine} onNavigate={handleNavigate} />
        </div>

        {/* Right Column: Layer Stack Inspector & Packet Capture (60% width) */}
        <div className="lg:col-span-7 h-full flex flex-col min-h-0 bg-slate-900/50 rounded-lg border border-slate-800/80 overflow-hidden">
          {/* Sub-view toggle tabs */}
          <div className="h-9 bg-slate-950 px-3 flex items-center justify-between border-b border-slate-800 shrink-0 select-none">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Network className="w-3.5 h-3.5 text-cyan-400" />
              <span>Inspection Suite</span>
            </div>

            <div className="flex items-center bg-slate-900 border border-slate-800 rounded p-0.5 text-[11px] font-mono">
              <button
                onClick={() => setRightViewMode('both')}
                className={`px-2.5 py-0.5 rounded transition-colors ${
                  rightViewMode === 'both' ? 'bg-slate-800 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Split Both
              </button>
              <button
                onClick={() => setRightViewMode('stack')}
                className={`px-2.5 py-0.5 rounded transition-colors flex items-center gap-1 ${
                  rightViewMode === 'stack' ? 'bg-slate-800 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3 h-3" />
                OSI Stack & Oscilloscope
              </button>
              <button
                onClick={() => setRightViewMode('capture')}
                className={`px-2.5 py-0.5 rounded transition-colors flex items-center gap-1 ${
                  rightViewMode === 'capture' ? 'bg-slate-800 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ListFilter className="w-3 h-3" />
                Packet Capture
              </button>
            </div>
          </div>

          {/* Inspection View Body */}
          <div className="flex-1 min-h-0 grid grid-cols-1 overflow-hidden">
            {rightViewMode === 'both' && (
              <div className="h-full grid grid-cols-1 md:grid-cols-2 gap-1.5 p-1.5 min-h-0">
                <div className="h-full min-h-0 overflow-hidden">
                  <LayerStackInspector
                    engine={engine}
                    activePacket={activePacket}
                    selectedCableId={selectedCableId}
                    onSelectCable={setSelectedCableId}
                  />
                </div>
                <div className="h-full min-h-0 overflow-hidden">
                  <PacketCapture
                    packets={engine.capturedPackets}
                    activePacket={activePacket}
                    onSelectPacket={(p) => {
                      setActivePacket(p);
                      setSelectedCableId(p.cableId);
                    }}
                    onClear={() => {
                      engine.capturedPackets = [];
                      setActivePacket(null);
                      setTickCounter((p) => p + 1);
                    }}
                  />
                </div>
              </div>
            )}

            {rightViewMode === 'stack' && (
              <div className="h-full p-1.5 min-h-0 overflow-hidden">
                <LayerStackInspector
                  engine={engine}
                  activePacket={activePacket}
                  selectedCableId={selectedCableId}
                  onSelectCable={setSelectedCableId}
                />
              </div>
            )}

            {rightViewMode === 'capture' && (
              <div className="h-full p-1.5 min-h-0 overflow-hidden">
                <PacketCapture
                  packets={engine.capturedPackets}
                  activePacket={activePacket}
                  onSelectPacket={(p) => {
                    setActivePacket(p);
                    setSelectedCableId(p.cableId);
                  }}
                  onClear={() => {
                    engine.capturedPackets = [];
                    setActivePacket(null);
                    setTickCounter((p) => p + 1);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. Chaos Deck & Proof of Invention Footer */}
      <CableChaosDeck
        engine={engine}
        onCutCable={handleCutCable}
        onRepairCable={handleRepairCable}
        onToggleNoise={handleToggleNoise}
        onRunTour={handleRunTour}
      />
    </div>
  );
}
