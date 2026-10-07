/**
 * Physical Layer (L1): Cable, Signal Propagation & Cable Cutting Physics
 */

import { Cable, CableStatus, WireBit, Bit, VoltageLevel } from '../types/network';
import { encodeManchesterBit } from './manchester';

let nextBitId = 1;
let nextFrameId = 1;

export function createCable(
  id: string,
  name: string,
  nodeAId: string,
  ifaceA: string,
  nodeBId: string,
  ifaceB: string,
  lengthMeters = 50,
  bandwidthMbps = 100
): Cable {
  return {
    id,
    name,
    nodeA: { nodeId: nodeAId, interfaceName: ifaceA },
    nodeB: { nodeId: nodeBId, interfaceName: ifaceB },
    status: 'connected',
    propagationDelayMs: Math.max(1, Math.round(lengthMeters * 0.05)), // simulated speed of light in copper ~ 200,000 km/s
    lengthMeters,
    bitsInFlight: [],
    totalBitsTransmitted: 0,
    droppedFramesCount: 0,
    bandwidthMbps,
  };
}

/**
 * Injects a bitstream onto a physical cable from one end.
 */
export function transmitBitsOnCable(
  cable: Cable,
  bits: Bit[],
  direction: 'a_to_b' | 'b_to_a',
  sourceNodeId: string,
  targetNodeId: string
): number {
  if (cable.status === 'severed') {
    cable.droppedFramesCount++;
    return 0; // Cable severed at source; signal fails to launch
  }

  const frameId = nextFrameId++;
  const wireBits: WireBit[] = [];
  // Spacing between consecutive bits on the wire. Longer frames still occupy
  // more of the cable, but the spread is compressed so a frame clears a hop in
  // well under a second of simulated time.
  const frameSpan = Math.min(bits.length * 0.008, 0.4 + bits.length * 0.0002);
  const bitSpacing = bits.length > 1 ? frameSpan / bits.length : 0;

  for (let i = 0; i < bits.length; i++) {
    const bit = bits[i];
    // In noisy mode, each bit flips with probability 1e-4 (about 7% of small frames and a third of full data frames arrive corrupted)
    let actualBit = bit;
    if (cable.status === 'noisy' && Math.random() < 0.0001) {
      actualBit = (bit === 1 ? 0 : 1) as Bit;
    }

    const symbol = encodeManchesterBit(actualBit);
    wireBits.push({
      id: nextBitId++,
      bit: actualBit,
      symbol,
      progress: 0.0 - i * bitSpacing, // stagger bits in flight along the cable
      direction,
      sourceNodeId,
      targetNodeId,
      frameId,
      frameBitCount: bits.length,
      isPreamble: i < 64, // First 64 bits are preamble + SFD
    });
  }

  cable.bitsInFlight.push(...wireBits);
  cable.totalBitsTransmitted += bits.length;
  return frameId;
}

/**
 * Advances cable physics by deltaMs.
 * Moves bits along the wire.
 * Returns bits that reached the destination end during this tick.
 */
export function tickCablePhysics(
  cable: Cable,
  deltaMs: number
): {
  deliveredToA: WireBit[];
  deliveredToB: WireBit[];
  droppedCount: number;
} {
  const deliveredToA: WireBit[] = [];
  const deliveredToB: WireBit[] = [];
  let droppedCount = 0;

  if (cable.status === 'severed') {
    // Cut cable destroys all bits currently in flight!
    if (cable.bitsInFlight.length > 0) {
      droppedCount = cable.bitsInFlight.length;
      cable.droppedFramesCount += Math.ceil(droppedCount / 64);
      cable.bitsInFlight = [];
    }
    return { deliveredToA, deliveredToB, droppedCount };
  }

  // Speed: cable traversal speed depends on deltaMs and propagation speed
  // Let progress advance smoothly across ~200-400ms visual duration
  const speed = (deltaMs / 300);

  const remainingBits: WireBit[] = [];

  for (const wb of cable.bitsInFlight) {
    wb.progress += speed;

    if (wb.progress >= 1.0) {
      // Reached other end
      if (wb.direction === 'a_to_b') {
        deliveredToB.push(wb);
      } else {
        deliveredToA.push(wb);
      }
    } else {
      remainingBits.push(wb);
    }
  }

  cable.bitsInFlight = remainingBits;
  return { deliveredToA, deliveredToB, droppedCount };
}

/**
 * Cuts a cable with virtual scissors!
 */
export function cutCable(cable: Cable): void {
  cable.status = 'severed';
  // Dump all bits in flight into the void
  cable.bitsInFlight = [];
}

/**
 * Slices/repairs a cut cable.
 */
export function repairCable(cable: Cable): void {
  cable.status = 'connected';
}

/**
 * Toggles noise injection mode.
 */
export function toggleCableNoise(cable: Cable): void {
  cable.status = cable.status === 'noisy' ? 'connected' : 'noisy';
}
