/**
 * Link-State Routing Protocol (OSPF-like) & Dijkstra Shortest Path First (SPF)
 */

import { RouterNode, LinkStateLSA, ForwardingEntry } from '../types/network';

export interface DijkstraNodeResult {
  routerId: string;
  distance: number;
  nextHopRouterId: string | null;
  outgoingInterface: string | null;
}

/**
 * Runs Dijkstra's algorithm over the Link-State Database (LSDB) of a router.
 * Returns shortest path tree to all other routers.
 */
export function runDijkstraSPF(
  sourceRouter: RouterNode
): Map<string, DijkstraNodeResult> {
  const distances = new Map<string, number>();
  const results = new Map<string, DijkstraNodeResult>();
  const visited = new Set<string>();

  // Initialize
  distances.set(sourceRouter.routerId, 0);
  results.set(sourceRouter.routerId, {
    routerId: sourceRouter.routerId,
    distance: 0,
    nextHopRouterId: null,
    outgoingInterface: null,
  });

  // Collect all known router IDs from the LSDB
  const allRouterIds = new Set<string>();
  allRouterIds.add(sourceRouter.routerId);
  for (const routerId of Object.keys(sourceRouter.lsdb)) {
    allRouterIds.add(routerId);
  }

  // Priority queue / simple min-distance selector
  while (visited.size < allRouterIds.size) {
    let u: string | null = null;
    let minD = Infinity;

    for (const rId of allRouterIds) {
      if (!visited.has(rId)) {
        const d = distances.get(rId) ?? Infinity;
        if (d < minD) {
          minD = d;
          u = rId;
        }
      }
    }

    if (u === null || minD === Infinity) break;
    visited.add(u);

    // Get outgoing links of router u
    const lsa = sourceRouter.lsdb[u];
    if (!lsa) continue;

    for (const link of lsa.links) {
      const v = link.neighborRouterId;
      allRouterIds.add(v);
      if (visited.has(v)) continue;

      const alt = minD + link.metric;
      const currentDist = distances.get(v) ?? Infinity;

      if (alt < currentDist) {
        distances.set(v, alt);

        // Determine next hop from source perspective
        let nextHop: string;
        let outIface: string;

        if (u === sourceRouter.routerId) {
          // Direct neighbor of source
          nextHop = v;
          outIface = link.interfaceName;
        } else {
          // Inherit next hop and interface from ancestor u
          const uResult = results.get(u)!;
          nextHop = uResult.nextHopRouterId!;
          outIface = uResult.outgoingInterface!;
        }

        results.set(v, {
          routerId: v,
          distance: alt,
          nextHopRouterId: nextHop,
          outgoingInterface: outIface,
        });
      }
    }
  }

  return results;
}

/**
 * Rebuilds the Forwarding Table (FIB) of a router using Dijkstra's algorithm.
 */
export function rebuildForwardingTableFromLSDB(router: RouterNode): void {
  const spfTree = runDijkstraSPF(router);

  // Preserve directly connected local subnets
  const newTable: ForwardingEntry[] = [];

  for (const [ifaceName, iface] of Object.entries(router.interfaces)) {
    if (iface.ip && iface.netmask && iface.carrierUp) {
      newTable.push({
        destinationSubnet: getSubnetAddress(iface.ip, iface.netmask),
        netmask: iface.netmask,
        nextHop: 'DIRECT',
        interfaceName: ifaceName,
        metric: 0,
        learnedVia: 'CONNECTED',
      });
    }
  }

  // Subnets this router advertises itself that are not an interface's primary
  // subnet (for example a second LAN behind the same port) are also directly
  // reachable through the advertised interface.
  const ownLsa = router.lsdb[router.routerId];
  for (const link of ownLsa?.links ?? []) {
    const iface = router.interfaces[link.interfaceName];
    if (!link.neighborSubnet || !iface?.carrierUp) continue;
    if (newTable.some((e) => e.destinationSubnet === link.neighborSubnet)) continue;
    newTable.push({
      destinationSubnet: link.neighborSubnet,
      netmask: '255.255.255.0',
      nextHop: 'DIRECT',
      interfaceName: link.interfaceName,
      metric: link.metric,
      learnedVia: 'CONNECTED',
    });
  }

  // Iterate over all LSAs to find reachability to other subnets
  for (const [rId, lsa] of Object.entries(router.lsdb)) {
    if (rId === router.routerId) continue;

    const path = spfTree.get(rId);
    if (!path || path.nextHopRouterId === null || path.outgoingInterface === null) continue;

    for (const link of lsa.links) {
      if (link.neighborSubnet) {
        // Find next hop IP on the local link toward path.nextHopRouterId
        const existingEntry = newTable.find(
          (e) => e.destinationSubnet === link.neighborSubnet && e.netmask === '255.255.255.0'
        );

        if (!existingEntry || existingEntry.metric > path.distance + link.metric) {
          newTable.push({
            destinationSubnet: link.neighborSubnet,
            netmask: '255.255.255.0',
            nextHop: path.nextHopRouterId,
            interfaceName: path.outgoingInterface,
            metric: path.distance + link.metric,
            learnedVia: 'OSPF',
          });
        }
      }
    }
  }

  router.forwardingTable = newTable;
}

/**
 * Computes network subnet address from IP and netmask.
 */
function getSubnetAddress(ip: string, mask: string): string {
  const ipParts = ip.split('.').map(Number);
  const maskParts = mask.split('.').map(Number);
  const subParts = ipParts.map((b, i) => b & maskParts[i]);
  return subParts.join('.');
}
