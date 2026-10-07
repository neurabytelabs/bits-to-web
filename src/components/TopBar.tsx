import React from 'react';
import { Play, Pause, RotateCcw, Zap, Scissors, FastForward, Clock } from 'lucide-react';
import { NetworkEngine } from '../simulation/networkEngine';

interface TopBarProps {
  engine: NetworkEngine;
  isRunning: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  simSpeed: number;
  onChangeSpeed: (speed: number) => void;
  onTriggerChaos: () => void;
  primaryCut: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  engine,
  isRunning,
  onTogglePlay,
  onReset,
  simSpeed,
  onChangeSpeed,
  onTriggerChaos,
  primaryCut,
}) => {
  return (
    <header className="h-14 bg-slate-900/90 border-b border-slate-800 px-4 flex items-center justify-between select-none z-30 shrink-0">
      {/* Zone 1: Brand title wordmark */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-gradient-to-tr from-cyan-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-950/50">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="font-bold text-slate-100 tracking-tight text-sm">
            From Bits to the Web
          </span>
          <span className="text-slate-400 text-xs ml-2 hidden sm:inline">
            The Self-Invented Internet
          </span>
        </div>
      </div>

      {/* Zone 2: Navigation & Simulation Clock Controls */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-slate-950 border border-slate-800 rounded px-2 py-1 gap-2 text-xs font-mono text-slate-300">
          <Clock className="w-3.5 h-3.5 text-cyan-400" />
          <span className="tabular-nums">{(engine.simTimeMs / 1000).toFixed(2)}s</span>
        </div>

        <div className="flex items-center bg-slate-950 border border-slate-800 rounded p-0.5">
          <button
            onClick={onTogglePlay}
            className={`p-1.5 rounded text-xs transition-colors ${
              isRunning ? 'text-amber-400 hover:bg-slate-800' : 'text-emerald-400 hover:bg-slate-800'
            }`}
            title={isRunning ? 'Pause Clock' : 'Start Clock'}
          >
            {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={onReset}
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors"
            title="Reset Network Topology"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Speed Selector */}
        <div className="hidden md:flex items-center bg-slate-950 border border-slate-800 rounded text-xs font-mono">
          {[0.2, 0.5, 1.0, 2.0].map((s) => (
            <button
              key={s}
              onClick={() => onChangeSpeed(s)}
              className={`px-2 py-1 rounded transition-colors ${
                simSpeed === s
                  ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Zone 3: Primary Action */}
      <div className="flex items-center gap-2">
        <button
          onClick={onTriggerChaos}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-all shadow-sm ${
            primaryCut
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : 'bg-rose-600/90 hover:bg-rose-500 text-white'
          }`}
        >
          <Scissors className="w-3.5 h-3.5" />
          <span className="whitespace-nowrap">
            {primaryCut ? 'Repair Primary Cable' : 'Cut Primary Cable (Alpha ↔ Beta)'}
          </span>
        </button>
      </div>
    </header>
  );
};
