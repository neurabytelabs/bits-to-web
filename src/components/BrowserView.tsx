import React, { useState } from 'react';
import { Globe, ArrowRight, RefreshCw, ShieldCheck, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { NetworkEngine } from '../simulation/networkEngine';
import type { HostNode } from '../types/network';

interface BrowserViewProps {
  engine: NetworkEngine;
  onNavigate: (url: string) => void;
}

export const BrowserView: React.FC<BrowserViewProps> = ({ engine, onNavigate }) => {
  const [inputUrl, setInputUrl] = useState(engine.currentUrl);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNavigate(inputUrl);
  };

  const bState = engine.browserState;

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* Browser Window Titlebar & Tab */}
      <div className="h-8 bg-slate-950 px-3 flex items-center justify-between border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5 mr-2">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          </div>

          {/* Active Tab */}
          <div className="bg-slate-900 border-t border-x border-slate-700/60 rounded-t px-3 py-1 flex items-center gap-2 text-xs font-medium text-slate-200">
            <Globe className="w-3 h-3 text-cyan-400" />
            <span className="truncate max-w-[180px]">
              {engine.currentUrl.replace('http://', '')}
            </span>
          </div>
        </div>

        {/* Transmission Phase Badge */}
        <div className="flex items-center gap-2 text-[11px] font-mono">
          {bState.status === 'resolving_dns' && (
            <span className="text-amber-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Resolving DNS (UDP:53)...
            </span>
          )}
          {bState.status === 'connecting_tcp' && (
            <span className="text-cyan-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> TCP 3-Way Handshake...
            </span>
          )}
          {bState.status === 'sending_http' && (
            <span className="text-purple-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Sending HTTP GET...
            </span>
          )}
          {bState.status === 'receiving_stream' && (
            <span className="text-emerald-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Streaming Bits ({bState.bytesReceived} B)...
            </span>
          )}
          {bState.status === 'loaded' && (
            <span className="text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> 200 OK
            </span>
          )}
          {bState.status === 'error' && (
            <span className="text-rose-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {bState.errorMessage || 'Link Dropped'}
            </span>
          )}
        </div>
      </div>

      {/* URL Address Bar & Navigation Buttons */}
      <div className="h-10 bg-slate-950/60 px-3 flex items-center gap-2 border-b border-slate-800">
        <button
          onClick={() => onNavigate(engine.currentUrl)}
          className="p-1 text-slate-400 hover:text-slate-100 transition-colors rounded"
          title="Reload page"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <form onSubmit={handleSubmit} className="flex-1 flex items-center">
          <div className="w-full flex items-center bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500/20">
            <span className="text-slate-500 font-mono select-none mr-1">http://</span>
            <input
              type="text"
              value={inputUrl.replace('http://', '')}
              onChange={(e) => setInputUrl('http://' + e.target.value.replace('http://', ''))}
              placeholder="e.g. hypertext.org, the-internals.net, retro.net"
              className="w-full bg-transparent outline-none text-slate-100 font-mono text-xs"
            />
            <button
              type="submit"
              className="ml-1 text-slate-400 hover:text-cyan-400 p-0.5 rounded transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>

        {/* Quick bookmarks */}
        <div className="hidden lg:flex items-center gap-1 text-[11px] font-mono text-slate-400">
          <button
            onClick={() => {
              setInputUrl('http://hypertext.org');
              onNavigate('http://hypertext.org');
            }}
            className="px-1.5 py-0.5 rounded hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            hypertext.org
          </button>
          <span>·</span>
          <button
            onClick={() => {
              setInputUrl('http://the-internals.net');
              onNavigate('http://the-internals.net');
            }}
            className="px-1.5 py-0.5 rounded hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            the-internals.net
          </button>
          <span>·</span>
          <button
            onClick={() => {
              setInputUrl('http://retro.net');
              onNavigate('http://retro.net');
            }}
            className="px-1.5 py-0.5 rounded hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            retro.net
          </button>
        </div>
      </div>

      {/* Rendered HTML Page Canvas */}
      <div className="flex-1 overflow-y-auto p-5 bg-slate-950 text-slate-200">
        {bState.status === 'idle' ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <Globe className="w-10 h-10 text-slate-700 mb-2" />
            <p className="text-sm font-medium text-slate-400">Type any address above or click a bookmark</p>
            <p className="text-xs mt-1 text-slate-600 max-w-sm">
              The page will be fetched across live copper cables, modulated into Manchester voltage transitions,
              switched through Ethernet, and routed via OSPF.
            </p>
          </div>
        ) : bState.renderedHtml ? (
          <div
            className="prose prose-invert max-w-none text-slate-200"
            dangerouslySetInnerHTML={{ __html: bState.renderedHtml }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
            <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
            <p className="text-xs font-mono text-slate-400">
              {bState.status === 'resolving_dns' && 'Resolving domain name via UDP:53...'}
              {bState.status === 'connecting_tcp' && 'Establishing TCP Three-Way Handshake (SYN)...'}
              {bState.status === 'sending_http' && 'Transmitting HTTP GET request across physical cables...'}
              {bState.status === 'receiving_stream' && 'Receiving serialized byte stream...'}
            </p>
          </div>
        )}
      </div>

      {/* Live Connection Diagnostics Footer */}
      <div className="h-7 bg-slate-950 border-t border-slate-800 px-3 flex items-center justify-between gap-3 text-[10px] font-mono text-slate-400 whitespace-nowrap overflow-hidden">
        <div className="flex items-center gap-3">
          <span>HOST: {engine.nodes.client.interfaces.eth0.ip}</span>
          <span>·</span>
          <span>DNS: {bState.resolvedIp ? bState.resolvedIp : 'Waiting'}</span>
          <span>·</span>
          <span>
            TCP RTO:{' '}
            {(() => {
              const conn = bState.resolvedIp ? (engine.nodes.client as HostNode).tcpConnections[`${bState.resolvedIp}:80`] : undefined;
              return conn ? `${Math.round(conn.rtoTimerMs)}ms` : '—';
            })()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>STREAM: {bState.bytesReceived} bytes</span>
          <span className="text-emerald-400 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> CRC-32 Verified
          </span>
        </div>
      </div>
    </div>
  );
};
