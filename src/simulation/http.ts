/**
 * Application Layer (L7): Hypertext Transfer Protocol (HTTP/1.1 - RFC 2616)
 */

export interface HttpRequest {
  method: string;
  uri: string;
  version: string;
  headers: Record<string, string>;
  body: string;
}

export interface HttpResponse {
  version: string;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Encodes text to UTF-8 Uint8Array.
 */
export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Decodes UTF-8 Uint8Array to string.
 */
export function bytesToString(buf: Uint8Array): string {
  return new TextDecoder().decode(buf);
}

/**
 * Serializes an HTTP/1.1 Request into raw ASCII bytes.
 */
export function serializeHttpRequest(method: string, uri: string, host: string): Uint8Array {
  const reqStr = 
    `${method.toUpperCase()} ${uri} HTTP/1.1\r\n` +
    `Host: ${host}\r\n` +
    `User-Agent: PureBits-Browser/1.0 (X11; RetroOS x86_64)\r\n` +
    `Accept: text/html,application/xhtml+xml,text/plain\r\n` +
    `Connection: close\r\n\r\n`;
  return stringToBytes(reqStr);
}

/**
 * Serializes an HTTP/1.1 Response into raw ASCII bytes.
 */
export function serializeHttpResponse(
  statusCode = 200,
  statusText = 'OK',
  contentType = 'text/html; charset=utf-8',
  body = ''
): Uint8Array {
  const bodyBytes = stringToBytes(body);
  const headerStr =
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
    `Date: Sun, 27 Sep 2026 23:30:00 GMT\r\n` +
    `Server: PureBits-OS/1.0 (BareMetal-Stack)\r\n` +
    `Content-Type: ${contentType}\r\n` +
    `Content-Length: ${bodyBytes.length}\r\n` +
    `Connection: close\r\n\r\n`;
  
  const headerBytes = stringToBytes(headerStr);
  const fullBytes = new Uint8Array(headerBytes.length + bodyBytes.length);
  fullBytes.set(headerBytes, 0);
  fullBytes.set(bodyBytes, headerBytes.length);
  return fullBytes;
}

/**
 * Parses raw bytes into HttpRequest if valid.
 */
export function parseHttpRequest(buf: Uint8Array): HttpRequest | null {
  const raw = bytesToString(buf);
  const doubleCrLf = raw.indexOf('\r\n\r\n');
  if (doubleCrLf === -1) return null;

  const headerPart = raw.substring(0, doubleCrLf);
  const body = raw.substring(doubleCrLf + 4);
  const lines = headerPart.split('\r\n');

  if (lines.length === 0) return null;
  const requestLine = lines[0].split(' ');
  if (requestLine.length < 3) return null;

  const method = requestLine[0];
  const uri = requestLine[1];
  const version = requestLine[2];

  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(':');
    if (colon > 0) {
      const k = lines[i].substring(0, colon).trim().toLowerCase();
      const v = lines[i].substring(colon + 1).trim();
      headers[k] = v;
    }
  }

  return { method, uri, version, headers, body };
}

/**
 * Parses raw bytes into HttpResponse if valid.
 */
export function parseHttpResponse(buf: Uint8Array): HttpResponse | null {
  const raw = bytesToString(buf);
  const doubleCrLf = raw.indexOf('\r\n\r\n');
  if (doubleCrLf === -1) return null;

  const headerPart = raw.substring(0, doubleCrLf);
  const body = raw.substring(doubleCrLf + 4);
  const lines = headerPart.split('\r\n');

  if (lines.length === 0) return null;
  const statusLine = lines[0].split(' ');
  if (statusLine.length < 2) return null;

  const version = statusLine[0];
  const statusCode = parseInt(statusLine[1], 10);
  const statusText = statusLine.slice(2).join(' ') || 'OK';

  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(':');
    if (colon > 0) {
      const k = lines[i].substring(0, colon).trim().toLowerCase();
      const v = lines[i].substring(colon + 1).trim();
      headers[k] = v;
    }
  }

  return { version, statusCode, statusText, headers, body };
}

/**
 * Realistic default website repository served by the web servers on the network.
 */
export const WEB_CATALOG: Record<string, { title: string; html: string }> = {
  'hypertext.org': {
    title: 'The WorldWideWeb Project',
    html: `
      <div class="space-y-4">
        <header class="border-b border-amber-500/30 pb-3">
          <div class="text-xs uppercase tracking-widest text-amber-500 font-mono mb-1">CERN NeXTcube // Pure Bits Online</div>
          <h1 class="text-2xl font-bold text-slate-100 font-serif">The WorldWideWeb Project</h1>
          <p class="text-xs text-slate-400">An experiment in global linked information over raw bitstreams.</p>
        </header>

        <div class="prose prose-invert text-sm text-slate-300 space-y-3 leading-relaxed">
          <p>
            Welcome to the WorldWideWeb. Everything you are reading arrived across copper cables
            encoded in <strong>Manchester voltage pulses (+2.5V / -2.5V)</strong>, switched by Ethernet
            hardware, routed through IP routers running Dijkstra link-state convergence, and preserved by
            <strong>TCP sliding-window retransmission</strong>.
          </p>

          <div class="p-3 bg-slate-900/80 rounded border border-slate-800 text-xs font-mono text-cyan-300">
            <div>STATUS: 200 OK · PROTOCOL: HTTP/1.1</div>
            <div>TRANSPORT: TCP Window Size 65,535 · MSS 512 bytes</div>
            <div>CARRIER: Manchester Bi-Phase L (Clock synchronized)</div>
          </div>

          <h3 class="text-base font-semibold text-slate-100">Try Cutting a Cable Right Now!</h3>
          <p>
            While this page loads or when clicking links below, take the <strong>Cable Scissors</strong> tool
            in the topology map above and sever <em>Router Alpha &harr; Router Beta</em>. Watch OSPF detect carrier drop,
            flood Link-State Packets, and redirect your TCP bitstream through <em>Router Gamma</em> without dropping this connection!
          </p>

          <div class="pt-2 flex flex-wrap gap-2 text-xs">
            <span class="text-slate-400">Jump to:</span>
            <a href="http://the-internals.net" class="text-cyan-400 underline hover:text-cyan-300">the-internals.net</a>
            <span class="text-slate-600">·</span>
            <a href="http://retro.net/history.html" class="text-cyan-400 underline hover:text-cyan-300">retro.net/history.html</a>
            <span class="text-slate-600">·</span>
            <a href="http://cern.ch/info" class="text-cyan-400 underline hover:text-cyan-300">cern.ch/info</a>
          </div>
        </div>
      </div>
    `,
  },

  'the-internals.net': {
    title: 'How This Network Operates (Layer by Layer)',
    html: `
      <div class="space-y-4">
        <header class="border-b border-cyan-500/30 pb-3">
          <div class="text-xs uppercase tracking-widest text-cyan-400 font-mono mb-1">Architecture Specification</div>
          <h1 class="text-2xl font-bold text-slate-100">The 5-Layer Stack Built From Scratch</h1>
          <p class="text-xs text-slate-400">Zero abstractions, zero fake function calls — strictly serialized octets and voltage waveforms.</p>
        </header>

        <div class="space-y-3 text-xs leading-relaxed text-slate-300">
          <div class="p-3 bg-slate-900 border-l-2 border-amber-400 rounded-r">
            <span class="font-bold text-amber-300 font-mono">Layer 1 — Physical Copper & Manchester:</span>
            <p class="mt-1 text-slate-300">
              Each bit is split into two half-periods. Bit 0 transitions High (+2.5V) to Low (-2.5V).
              Bit 1 transitions Low to High. The mid-bit edge supplies clock synchronization to the receiver's phase-locked loop (PLL).
            </p>
          </div>

          <div class="p-3 bg-slate-900 border-l-2 border-emerald-400 rounded-r">
            <span class="font-bold text-emerald-300 font-mono">Layer 2 — Switched Ethernet II:</span>
            <p class="mt-1 text-slate-300">
              Frames feature 6-byte source and destination MAC addresses, 0x0800 EtherType, and an IEEE 802.3 32-bit CRC (polynomial 0xEDB88320).
              Switches learn port mappings automatically via CAM tables.
            </p>
          </div>

          <div class="p-3 bg-slate-900 border-l-2 border-blue-400 rounded-r">
            <span class="font-bold text-blue-300 font-mono">Layer 3 — IPv4 & OSPF Link-State:</span>
            <p class="mt-1 text-slate-300">
              Routers inspect destination IP, calculate RFC 791 16-bit 1's complement checksums, decrement TTL, and look up
              Forwarding Information Bases (FIB) dynamically computed via Dijkstra Shortest Path First.
            </p>
          </div>

          <div class="p-3 bg-slate-900 border-l-2 border-purple-400 rounded-r">
            <span class="font-bold text-purple-300 font-mono">Layer 4 — Full TCP State Machine:</span>
            <p class="mt-1 text-slate-300">
              SYN &rarr; SYN-ACK &rarr; ACK. Byte-level sequence numbers, sliding window acknowledgments, and Retransmission Timeouts (RTO).
              If bits drop due to cut cables or noise, TCP automatically retransmits the lost segment.
            </p>
          </div>
        </div>
      </div>
    `,
  },

  'retro.net': {
    title: 'Retro ARPANET & Internet Pioneers',
    html: `
      <div class="space-y-4">
        <header class="border-b border-emerald-500/30 pb-3">
          <div class="text-xs uppercase tracking-widest text-emerald-400 font-mono mb-1">Telecommunications Archive</div>
          <h1 class="text-2xl font-bold text-slate-100 font-serif">October 29, 1969: "LO"</h1>
          <p class="text-xs text-slate-400">UCLA to Stanford SRI — the first packet switch exchange.</p>
        </header>

        <div class="text-xs text-slate-300 space-y-3 leading-relaxed">
          <p>
            When Charley Kline at UCLA tried typing "LOGIN" to the SDS Sigma 7 at Stanford, the system crashed after
            typing "L" and "O". That simple two-letter transmission laid the groundwork for everything running here today.
          </p>
          <p>
            On January 1, 1983 ("Flag Day"), the ARPANET decommissioned the primitive NCP protocol and transitioned
            permanently to the Cerf-Kahn TCP/IP protocol suite.
          </p>
          <div class="p-3 bg-emerald-950/30 border border-emerald-800/40 rounded text-emerald-200">
            <strong>Key Fact:</strong> The protocol state machines executing in this browser sandbox adhere strictly to RFC 791 (IPv4), RFC 793 (TCP), and RFC 1035 (DNS).
          </div>
        </div>
      </div>
    `,
  },

  'cern.ch': {
    title: 'CERN NeXT Computer Server 1990',
    html: `
      <div class="space-y-4">
        <header class="border-b border-indigo-500/30 pb-3">
          <div class="text-xs uppercase tracking-widest text-indigo-400 font-mono mb-1">Building 31 // Geneva</div>
          <h1 class="text-2xl font-bold text-slate-100">Tim Berners-Lee's NeXTcube</h1>
          <p class="text-xs text-slate-400">The world's first web server at http://info.cern.ch</p>
        </header>

        <div class="text-xs text-slate-300 space-y-3 leading-relaxed">
          <p>
            Label affixed in red ink on the original casing:
            <em class="text-amber-300">"This machine is a server. DO NOT POWER IT DOWN!!"</em>
          </p>
          <p>
            The original server ran NeXTSTEP 0.9 on a 25 MHz Motorola 68030 processor with 8 MB of RAM.
            Today, you are running an entire simulated internet in TypeScript with live Manchester bitstreams!
          </p>
        </div>
      </div>
    `,
  },
};
