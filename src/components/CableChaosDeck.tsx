import React from 'react';
import { Scissors, Wrench, Zap, Radio, ShieldAlert, Route, Play } from 'lucide-react';
import { NetworkEngine } from '../simulation/networkEngine';

interface CableChaosDeckProps {
  engine: NetworkEngine;
  onCutCable: (id: string) => void;
  onRepairCable: (id: string) => void;
  onToggleNoise: (id: string) => void;
  onRunTour: (tourId: string) => void;
}

export const CableChaosDeck: React.FC<CableChaosDeckProps> = ({
  engine,
  onCutCable,
  onRepairCable,
  onToggleNoise,
  onRunTour,
}) => {
  const primaryCable = engine.cables.cable_alpha_beta;
  const backupCable = engine.cables.cable_alpha_gamma;

  return (
    <div className="bg-slate-900 border-t border-slate-800 p-3 select-none">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Guided Chaos Scenarios */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            Proof of Invention Experiments:
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => onRunTour('normal_fetch')}
              className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 transition-colors"
            >
              1. Normal Fetch (Alpha ↔ Beta)
            </button>

            <button
              onClick={() => onRunTour('cut_mid_transfer')}
              className="px-2.5 py-1 text-[11px] font-medium bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 rounded border border-rose-800/80 transition-colors flex items-center gap-1"
            >
              <Scissors className="w-3 h-3" />
              2. Cut Cable Mid-Transfer (OSPF Failover)
            </button>

            <button
              onClick={() => onRunTour('inject_noise')}
              className="px-2.5 py-1 text-[11px] font-medium bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 rounded border border-amber-800/80 transition-colors flex items-center gap-1"
            >
              <ShieldAlert className="w-3 h-3" />
              3. Inject Bit Flips (CRC-32 Test)
            </button>
          </div>
        </div>

        {/* Right: Key Cable Quick Toggles */}
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
            <span className="text-slate-400">Primary Trunk:</span>
            <span className={primaryCable?.status === 'severed' ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
              {primaryCable?.status.toUpperCase()}
            </span>
            <button
              onClick={() =>
                primaryCable?.status === 'severed'
                  ? onRepairCable('cable_alpha_beta')
                  : onCutCable('cable_alpha_beta')
              }
              className="ml-1 text-slate-400 hover:text-white"
            >
              {primaryCable?.status === 'severed' ? <Wrench className="w-3 h-3 text-emerald-400" /> : <Scissors className="w-3 h-3 text-rose-400" />}
            </button>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
            <span className="text-slate-400">Backup Trunk:</span>
            <span className={backupCable?.status === 'severed' ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
              {backupCable?.status.toUpperCase()}
            </span>
            <button
              onClick={() =>
                backupCable?.status === 'severed'
                  ? onRepairCable('cable_alpha_gamma')
                  : onCutCable('cable_alpha_gamma')
              }
              className="ml-1 text-slate-400 hover:text-white"
            >
              {backupCable?.status === 'severed' ? <Wrench className="w-3 h-3 text-emerald-400" /> : <Scissors className="w-3 h-3 text-rose-400" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
