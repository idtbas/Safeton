/**
 * Scale-out fabric model: link and switch utilisation from workload traffic, and a smoothed
 * congestion factor per training job.
 *
 * Traffic of a job crossing its leaf group is estimated from the job's placement: for
 * ring/tree collectives each rank exchanges with peers spread over the job, so the share of a
 * node's traffic that must leave its leaf is ≈ 1 − (job nodes under this leaf / job nodes).
 * Demand above uplink capacity (oversubscription, failed spines/trunks) throttles the job's
 * collective bandwidth; the factor feeds back into the step time on the next tick.
 */
import type { Simulation } from './simulation';

const CONGESTION_TAU_S = 20;

export function updateNetwork(sim: Simulation): void {
  const topo = sim.topo;
  const fabric = topo.fabric;
  const n = sim.rt.nodes;
  const sw = sim.rt.switches;
  const links = sim.rt.links;
  const mr = Math.max(1, topo.maxRails);
  const swCount = topo.switches.length;
  const rail = n.railGbps;

  let injected = 0;
  for (let k = 0; k < rail.length; k++) injected += rail[k]!;
  sim.cluster.fabricTrafficGbps = injected;
  if (fabric.tiers === 0) return;

  const failed = sw.failed;
  const adminUp = sw.adminUp;
  const L = topo.links;
  const lTier = L.tier;
  const lA = L.a;
  const lB = L.b;
  const lPlane = L.plane;
  const lBw = L.bandwidthGbps;
  const railOpt = fabric.topology === 'rail-optimized';

  // Link state
  for (let l = 0; l < L.count; l++) {
    if (lTier[l] === 0) {
      const node = lA[l]!;
      const leaf = lB[l]!;
      const nicUp = !railOpt || (n.nicDownMask[node]! & (1 << lPlane[l]!)) === 0;
      links.up[l] = n.powered[node] === 1 && nicUp && failed[leaf] === 0 && adminUp[leaf] === 1 ? 1 : 0;
    } else {
      const a = lA[l]!;
      const b = lB[l]!;
      links.up[l] = failed[a] === 0 && adminUp[a] === 1 && failed[b] === 0 && adminUp[b] === 1 ? 1 : 0;
    }
    links.util[l] = 0;
  }

  const downActual = new Float64Array(swCount);
  const upActual = new Float64Array(swCount);
  const upDemand = new Float64Array(swCount);
  const leavesPerPod = Math.max(1, fabric.leavesPerPod);
  const groups = Math.max(1, topo.leafGroups);
  const pods = Math.ceil(groups / leavesPerPod);
  const podKey = (plane: number, pod: number) => plane * pods + pod;
  const podUpActual = fabric.tiers === 3 ? new Float64Array(fabric.planes * pods) : null;
  const podUpDemand = fabric.tiers === 3 ? new Float64Array(fabric.planes * pods) : null;
  const groupCount = new Int32Array(groups);
  const podCount = new Int32Array(pods);

  for (const job of sim.jobs.values()) {
    if (job.nodes.length === 0) continue;
    const jobNodes = job.nodes.length;
    groupCount.fill(0);
    podCount.fill(0);
    for (const i of job.nodes) {
      const g = topo.nodes[i]!.leafGroup;
      if (g < 0) continue;
      groupCount[g]!++;
      podCount[Math.floor(g / leavesPerPod)]!++;
    }
    const demandPerGpu = sim.netDemand.get(job.id) ?? 0;
    for (const i of job.nodes) {
      const node = topo.nodes[i]!;
      const rails = node.cfg.rails;
      const gpusOnRail = Math.ceil(node.cfg.gpuCount / Math.max(1, rails));
      const demand = demandPerGpu * gpusOnRail;
      for (let r = 0; r < rails; r++) {
        const leaf = topo.nodeLeaf[i * mr + r]!;
        if (leaf < 0) continue;
        const actual = rail[i * mr + r]!;
        const link = topo.nodeLink[i * mr + r]!;
        if (link >= 0) links.util[link] = actual / lBw[link]!;
        downActual[leaf] = downActual[leaf]! + actual;
        const info = topo.switches[leaf]!;
        const cross = 1 - groupCount[info.group]! / jobNodes;
        upActual[leaf] = upActual[leaf]! + actual * cross;
        upDemand[leaf] = upDemand[leaf]! + demand * cross;
        if (podUpActual && podUpDemand) {
          const pod = Math.floor(info.group / leavesPerPod);
          const crossPod = 1 - podCount[pod]! / jobNodes;
          const key = podKey(info.plane, pod);
          podUpActual[key] = podUpActual[key]! + actual * crossPod;
          podUpDemand[key] = podUpDemand[key]! + demand * crossPod;
        }
      }
    }
  }

  // Uplink capacity of each switch given failed trunks, and trunk utilisation.
  const upCap = new Float64Array(swCount);
  const spineTraffic = new Float64Array(swCount);
  const podCap = podUpActual ? new Float64Array(podUpActual.length) : null;
  for (let s = 0; s < swCount; s++) {
    const ups = topo.switchUplinks[s]!;
    if (ups.length === 0) continue;
    const info = topo.switches[s]!;
    const switchUp = failed[s] === 0 && adminUp[s] === 1;
    let healthyBw = 0;
    let healthyCount = 0;
    for (const l of ups) {
      if (links.up[l]) {
        healthyBw += lBw[l]!;
        healthyCount++;
      }
    }
    upCap[s] = switchUp ? healthyBw : 0;
    if (info.tier === 0) {
      const share = upActual[s]! / Math.max(1, healthyCount);
      for (const l of ups) {
        if (!links.up[l]) continue;
        links.util[l] = share / lBw[l]!;
        const spine = lB[l]!;
        spineTraffic[spine] = spineTraffic[spine]! + share;
      }
    } else if (info.tier === 1 && podUpActual && podCap) {
      const key = podKey(info.plane, info.group);
      podCap[key] = podCap[key]! + upCap[s]!;
      const share = podUpActual[key]! / Math.max(1, fabric.spinesPerGroup) / Math.max(1, healthyCount);
      for (const l of ups) if (links.up[l]) links.util[l] = share / lBw[l]!;
    }
  }

  // Switch utilisation and power
  for (let s = 0; s < swCount; s++) {
    const info = topo.switches[s]!;
    const switchUp = failed[s] === 0 && adminUp[s] === 1;
    let traffic: number;
    let util: number;
    if (info.tier === 0) {
      traffic = downActual[s]! + upActual[s]!;
      const dUtil = downActual[s]! / Math.max(1, info.downCapacityGbps);
      const uUtil = upCap[s]! > 0 ? upActual[s]! / upCap[s]! : 0;
      util = Math.max(dUtil, uUtil);
    } else {
      traffic = spineTraffic[s]!;
      util = traffic / Math.max(1, info.downCapacityGbps);
    }
    sw.trafficGbps[s] = switchUp ? traffic : 0;
    sw.util[s] = switchUp ? Math.min(1.5, util) : 0;
    const typical = info.spec.powerTypicalW.v;
    sw.powerW[s] = failed[s]
      ? typical * 0.3
      : adminUp[s]
        ? typical * (0.85 + 0.15 * Math.min(1, util))
        : typical * 0.5;
  }

  // Congestion factor per training job: worst demand/capacity ratio over its leaves and pods.
  const alpha = 1 - Math.exp(-sim.dt / CONGESTION_TAU_S);
  for (const job of [...sim.jobs.values()].sort((a, b) => a.id - b.id)) {
    if (job.spec.kind !== 'training' || job.state !== 'running') continue;
    let worst = 1;
    for (const i of job.nodes) {
      const node = topo.nodes[i]!;
      for (let r = 0; r < node.cfg.rails; r++) {
        const leaf = topo.nodeLeaf[i * mr + r]!;
        if (leaf < 0 || topo.switchUplinks[leaf]!.length === 0) continue;
        const cap = upCap[leaf]!;
        const u = cap > 0 ? upDemand[leaf]! / cap : upDemand[leaf]! > 0 ? 8 : 0;
        if (u > worst) worst = u;
        if (podUpDemand && podCap) {
          const info = topo.switches[leaf]!;
          const key = podKey(info.plane, Math.floor(info.group / leavesPerPod));
          const pc = podCap[key]!;
          const pu = pc > 0 ? podUpDemand[key]! / pc : podUpDemand[key]! > 0 ? 8 : 0;
          if (pu > worst) worst = pu;
        }
      }
    }
    const prev = sim.congestion.get(job.id) ?? 1;
    sim.congestion.set(job.id, prev + (Math.min(8, worst) - prev) * alpha);
  }
}
