/**
 * Stochastic failure model and automated remediation.
 *
 * Component failures arrive as Poisson processes with rates from catalog annualised failure
 * rates (AFR), scaled by the global failure-rate multiplier. GPU failures are additionally
 * accelerated by temperature (Arrhenius) and load. Each failure produces the observable
 * symptoms a real fleet shows — XID / RAS messages, degraded nodes, crashed jobs — and, when
 * automated remediation is enabled, a repair ticket with an exponentially distributed
 * time-to-repair.
 */
import { CRASH_NODE_AFR, FAN_AFR, LINK_FLAP_AFR } from './constants';
import { crashTrainingJob } from './jobs';
import type { Simulation } from './simulation';
import { GpuHealth, NodeFault, NodeState, type CommandResult, type FaultTarget } from './types';

const SECONDS_PER_YEAR = 31_536_000;

export interface RepairTicket {
  id: number;
  kind: 'node' | 'psu' | 'fan' | 'nic' | 'nvme' | 'switch' | 'air-unit' | 'liquid-unit' | 'chiller';
  target: number;
  /** Due time (sim epoch ms). */
  due: number;
  action: string;
}

/** Mean time to repair by ticket kind (hours, assumption: staffed site with on-site spares). */
export const MTTR_HOURS = {
  reset: 0.25,
  hardware: 4,
  hotSwap: 2,
  switch: 2,
  airUnit: 8,
  liquidUnit: 8,
  chiller: 24,
} as const;

const NV_BUS = ['18', '2a', '3a', '5d', '9a', 'ab', 'ba', 'db'];

export function gpuLabel(sim: Simulation, gi: number): string {
  const k = sim.topo.gpuLocal[gi]!;
  return `GPU${k} (0000:${NV_BUS[k % 8]}:00.0)`;
}

// ---- GPU faults ---------------------------------------------------------------------------

const XID_TABLE: { xid: number; weight: number }[] = [
  { xid: 79, weight: 25 },
  { xid: 48, weight: 20 },
  { xid: 74, weight: 15 },
  { xid: 94, weight: 15 },
  { xid: 119, weight: 10 },
  { xid: 63, weight: 8 },
  { xid: 95, weight: 5 },
  { xid: 64, weight: 2 },
];

function pickXid(sim: Simulation): number {
  const total = XID_TABLE.reduce((s, x) => s + x.weight, 0);
  let u = sim.rng.next() * total;
  for (const x of XID_TABLE) {
    u -= x.weight;
    if (u < 0) return x.xid;
  }
  return 79;
}

function gpuFaultMessage(vendor: 'NVIDIA' | 'AMD', xid: number, label: string): string {
  if (vendor === 'AMD') {
    switch (xid) {
      case 79:
        return `amdgpu ${label}: PCIe link lost — device fell off the bus, GPU reset required`;
      case 48:
      case 95:
        return `amdgpu ${label}: RAS: uncorrectable ECC error in UMC (HBM), bad page retirement pending`;
      case 63:
        return `amdgpu ${label}: RAS: correctable error threshold exceeded, bad page recorded`;
      case 64:
        return `amdgpu ${label}: RAS: bad page threshold exceeded — device retired`;
      case 74:
        return `amdgpu ${label}: XGMI link error, link down`;
      case 94:
        return `amdgpu ${label}: RAS: poison consumption, application terminated`;
      default:
        return `amdgpu ${label}: GPU hang detected, ring gfx_0.0.0 timeout`;
    }
  }
  switch (xid) {
    case 79:
      return `NVRM: Xid (${label}): 79, GPU has fallen off the bus`;
    case 48:
      return `NVRM: Xid (${label}): 48, An uncorrectable double bit error (DBE) has been detected on GPU in the framebuffer`;
    case 63:
      return `NVRM: Xid (${label}): 63, Row remapping event: ECC error recorded, remap pending on next GPU reset`;
    case 64:
      return `NVRM: Xid (${label}): 64, Row remapping failure — spare rows exhausted, GPU requires replacement`;
    case 74:
      return `NVRM: Xid (${label}): 74, NVLink: fatal error detected on link 7 (0x0, 0x0, 0x10000, 0x0)`;
    case 94:
      return `NVRM: Xid (${label}): 94, Contained ECC error: application terminated, GPU recovery not required`;
    case 95:
      return `NVRM: Xid (${label}): 95, Uncontained ECC error: GPU reset required`;
    case 119:
      return `NVRM: Xid (${label}): 119, Timeout after 6s of waiting for RPC response from GSP! Expected function 76 (GSP_RM_CONTROL)`;
    default:
      return `NVRM: Xid (${label}): ${xid}, GPU error`;
  }
}

export function applyGpuFault(sim: Simulation, gi: number, xidIn?: number): void {
  const g = sim.rt.gpus;
  const ni = sim.topo.gpuNode[gi]!;
  const node = sim.topo.nodes[ni]!;
  const xid = xidIn ?? pickXid(sim);
  let health: number = g.health[gi]!;
  let hardware = false;
  switch (xid) {
    case 79:
      hardware = sim.rng.chance(0.4);
      health = hardware ? GpuHealth.Failed : GpuHealth.ResetRequired;
      break;
    case 48:
      g.eccDbe[gi] = g.eccDbe[gi]! + 1;
      health = GpuHealth.ResetRequired;
      break;
    case 63:
      health = Math.max(health, GpuHealth.Degraded);
      break;
    case 64:
      hardware = true;
      health = GpuHealth.Failed;
      break;
    case 94:
      g.eccDbe[gi] = g.eccDbe[gi]! + 1;
      break;
    default:
      health = GpuHealth.ResetRequired;
  }
  g.health[gi] = Math.max(g.health[gi]!, health);
  g.lastXid[gi] = xid;
  const fatalToJob = xid !== 63;
  sim.emit(
    xid === 63 ? 'warning' : hardware ? 'critical' : 'error',
    'gpu',
    `${node.hostname}/gpu${sim.topo.gpuLocal[gi]}`,
    `GPU_XID_${xid}`,
    gpuFaultMessage(node.cfg.gpu.vendor, xid, gpuLabel(sim, gi)),
  );
  sim.refreshNodeFaults(ni);
  const jobId = sim.rt.nodes.job[ni]!;
  if (fatalToJob && jobId >= 0) {
    const job = sim.jobs.get(jobId);
    if (job && job.spec.kind === 'training') {
      if (g.health[gi]! >= GpuHealth.ResetRequired) sim.onNodeLostByJob(jobId, ni, `${gpuLabel(sim, gi)} Xid ${xid}`);
      else crashTrainingJob(sim, job, `${node.hostname} ${gpuLabel(sim, gi)} Xid ${xid}`);
    } else if (job && g.health[gi]! >= GpuHealth.ResetRequired) {
      sim.onNodeLostByJob(jobId, ni, `${gpuLabel(sim, gi)} Xid ${xid}`);
    }
  }
  if (sim.autoRemediation && g.health[gi]! >= GpuHealth.ResetRequired) {
    sim.openTicket('node', ni, hardware ? MTTR_HOURS.hardware : MTTR_HOURS.reset, hardware ? `Replace ${gpuLabel(sim, gi)} (RMA)` : 'Drain and reboot (GPU reset)');
  }
}

// ---- Node component faults ----------------------------------------------------------------

export function applyPsuFault(sim: Simulation, i: number): void {
  const n = sim.rt.nodes;
  const node = sim.topo.nodes[i]!;
  const cfg = node.cfg;
  if (n.psuFailed[i]! >= cfg.psuCount) return;
  n.psuFailed[i] = n.psuFailed[i]! + 1;
  const active = cfg.psuCount - n.psuFailed[i]!;
  const slot = n.psuFailed[i]!;
  if (active <= 0) {
    sim.failNode(i, `PSU${slot} failed — no power supplies remaining, node lost power`, true, 'power');
  } else if (active < cfg.psuRequired) {
    sim.emit('critical', 'node', node.hostname, 'PSU_POWER_BRAKE', `PSU${slot} failure: ${active}/${cfg.psuCount} PSUs cannot carry peak load — GPU power brake asserted (HW slowdown)`);
  } else {
    sim.emit('warning', 'node', node.hostname, 'PSU_FAILED', `PSU${slot} failure detected (output fault) — redundancy reduced to N+${active - cfg.psuRequired}`);
  }
  sim.refreshNodeFaults(i);
  if (sim.autoRemediation) sim.openTicket('psu', i, MTTR_HOURS.hotSwap, 'Hot-swap power supply');
}

export function applyFanFault(sim: Simulation, i: number): void {
  const n = sim.rt.nodes;
  const node = sim.topo.nodes[i]!;
  if (n.fanFailed[i]! >= node.cfg.fanCount) return;
  n.fanFailed[i] = n.fanFailed[i]! + 1;
  sim.emit('warning', 'node', node.hostname, 'FAN_FAILED', `Fan ${n.fanFailed[i]} failure: tachometer reads 0 RPM, remaining fans compensating`);
  sim.refreshNodeFaults(i);
  if (sim.autoRemediation) sim.openTicket('fan', i, MTTR_HOURS.hotSwap, 'Hot-swap fan module');
}

export function applyNicFault(sim: Simulation, i: number, rail: number, permanent: boolean): void {
  const n = sim.rt.nodes;
  const node = sim.topo.nodes[i]!;
  const r = Math.max(0, Math.min(node.cfg.rails - 1, rail));
  n.nicDownMask[i] = n.nicDownMask[i]! | (1 << r);
  if (permanent) {
    sim.emit('error', 'node', node.hostname, 'NIC_FAILED', `mlx5_core: rail ${r} adapter fatal error (health compromised, firmware assert) — port down`);
    if (sim.autoRemediation) sim.openTicket('nic', i, MTTR_HOURS.hardware, `Replace rail ${r} adapter`);
  } else {
    n.nicFlapTimer[i] = sim.rng.range(20, 180);
    sim.emit('warning', 'node', node.hostname, 'NIC_LINK_FLAP', `ib${r}: link state DOWN (symbol errors on optical transceiver) — link flap`);
  }
  sim.refreshNodeFaults(i);
  const jobId = n.job[i]!;
  if (jobId >= 0) {
    const job = sim.jobs.get(jobId);
    if (job && job.spec.kind === 'training') crashTrainingJob(sim, job, `${node.hostname} rail ${r}: NCCL network error (ibv_poll_cq: transport retry counter exceeded)`);
  }
}

function applyDimmFault(sim: Simulation, i: number): void {
  const node = sim.topo.nodes[i]!;
  sim.rt.nodes.dimmFault[i] = 1;
  sim.emit('error', 'node', node.hostname, 'MCE_UNCORRECTABLE', 'mce: [Hardware Error]: Machine check: uncorrectable memory error on DIMM — kernel panic');
  sim.failNode(i, 'Kernel panic after uncorrectable machine check (DIMM)', false, 'hardware');
}

function applyNvmeFault(sim: Simulation, i: number): void {
  const node = sim.topo.nodes[i]!;
  sim.rt.nodes.nvmeFault[i] = 1;
  sim.emit('warning', 'node', node.hostname, 'NVME_FAILED', 'nvme3: controller is down; will reset: CSTS=0x3 — device removed from RAID-0 scratch volume');
  sim.refreshNodeFaults(i);
  if (sim.autoRemediation) sim.openTicket('nvme', i, MTTR_HOURS.hotSwap, 'Hot-swap NVMe drive');
}

function applyNvSwitchFault(sim: Simulation, i: number): void {
  const node = sim.topo.nodes[i]!;
  sim.rt.nodes.nvswitchFault[i] = 1;
  sim.emit('critical', 'node', node.hostname, 'NVSWITCH_FATAL', 'nvidia-fabricmanager: NVSwitch fatal error (SXid 12028) — NVLink fabric degraded, GPUs isolated');
  sim.refreshNodeFaults(i);
  const job = sim.rt.nodes.job[i]!;
  if (job >= 0) sim.onNodeLostByJob(job, i, 'NVSwitch fatal error');
  if (sim.autoRemediation) sim.openTicket('node', i, MTTR_HOURS.hardware, 'Replace NVSwitch baseboard');
}

function crashNode(sim: Simulation, i: number): void {
  const msgs = [
    'Kernel panic - not syncing: Fatal exception in interrupt',
    'watchdog: BUG: soft lockup - CPU#87 stuck for 23s — node unresponsive',
    'BMC: Host heartbeat lost (IPMI watchdog expired)',
  ];
  sim.failNode(i, sim.rng.pick(msgs), false, 'crash');
}

// ---- Fabric and facility faults -----------------------------------------------------------

export function applySwitchFault(sim: Simulation, s: number, adminDown = false): void {
  const sw = sim.topo.switches[s]!;
  if (adminDown) sim.rt.switches.adminUp[s] = 0;
  else sim.rt.switches.failed[s] = 1;
  const tier = ['leaf', 'spine', 'core'][sw.tier]!;
  sim.emit(
    adminDown ? 'warning' : 'critical',
    'switch',
    sw.name,
    adminDown ? 'SWITCH_ADMIN_DOWN' : 'SWITCH_FAILED',
    adminDown
      ? `${sw.name}: administratively disabled (all ports down)`
      : `${sw.name}: ${tier} switch failure — ASIC fatal error, all ${sw.spec.ports} ports down; subnet manager rerouting`,
  );
  // Leaf: every attached node loses that rail. Spine / core: collectives crossing it may abort.
  const mr = sim.topo.maxRails;
  const affectedJobs = new Set<number>();
  if (sw.tier === 0) {
    for (let i = 0; i < sim.topo.nodes.length; i++) {
      for (let r = 0; r < mr; r++) {
        if (sim.topo.nodeLeaf[i * mr + r] === s) {
          sim.refreshNodeFaults(i);
          const job = sim.rt.nodes.job[i]!;
          if (job >= 0) affectedJobs.add(job);
        }
      }
    }
  } else {
    for (const job of sim.jobs.values()) {
      if (job.spec.kind !== 'training' || job.state !== 'running') continue;
      const groups = new Set(job.nodes.map((i) => sim.topo.nodes[i]!.leafGroup));
      if (groups.size > 1 && sim.rng.chance(0.5)) affectedJobs.add(job.id);
    }
  }
  for (const id of [...affectedJobs].sort((a, b) => a - b)) {
    const job = sim.jobs.get(id);
    if (job && job.spec.kind === 'training') crashTrainingJob(sim, job, `${sw.name} down: NCCL network error (remote access error)`);
  }
  if (!adminDown && sim.autoRemediation) sim.openTicket('switch', s, MTTR_HOURS.switch, `Replace ${tier} switch ${sw.name}`);
}

export function restoreSwitch(sim: Simulation, s: number, admin: boolean): void {
  const sw = sim.topo.switches[s]!;
  if (admin) sim.rt.switches.adminUp[s] = 1;
  else sim.rt.switches.failed[s] = 0;
  if (!sim.rt.switches.failed[s] && sim.rt.switches.adminUp[s]) {
    sim.emit('notice', 'switch', sw.name, 'SWITCH_UP', `${sw.name}: ports up, subnet manager sweep complete`);
  }
  if (sw.tier === 0) {
    const mr = sim.topo.maxRails;
    for (let i = 0; i < sim.topo.nodes.length; i++) {
      for (let r = 0; r < mr; r++) if (sim.topo.nodeLeaf[i * mr + r] === s) sim.refreshNodeFaults(i);
    }
  }
}

function applyCoolingUnitFault(sim: Simulation, hallIdx: number, unit: 'air' | 'liquid'): boolean {
  const hall = sim.topo.halls[hallIdx];
  const rt = sim.halls[hallIdx];
  if (!hall || !rt) return false;
  if (unit === 'air') {
    if (rt.airUnitsFailed >= hall.spec.air.count) return false;
    rt.airUnitsFailed++;
    sim.emit('error', 'hall', hall.id, 'CRAH_FAILED', `${hall.name}: ${hall.airUnit.name} #${rt.airUnitsFailed} tripped (fan motor overload) — ${hall.spec.air.count - rt.airUnitsFailed}/${hall.spec.air.count} units running`);
    if (sim.autoRemediation) sim.openTicket('air-unit', hallIdx, MTTR_HOURS.airUnit, `Repair air handler in ${hall.name}`);
  } else {
    if (!hall.liquidUnit || !hall.spec.liquid || rt.liquidUnitsFailed >= hall.spec.liquid.count) return false;
    rt.liquidUnitsFailed++;
    sim.emit('error', 'hall', hall.id, 'CDU_FAILED', `${hall.name}: ${hall.liquidUnit.name} #${rt.liquidUnitsFailed} pump failure — ${hall.spec.liquid.count - rt.liquidUnitsFailed}/${hall.spec.liquid.count} CDUs running`);
    if (sim.autoRemediation) sim.openTicket('liquid-unit', hallIdx, MTTR_HOURS.liquidUnit, `Repair CDU in ${hall.name}`);
  }
  return true;
}

function applyChillerFault(sim: Simulation): boolean {
  const plant = sim.topo.spec.site.plant;
  if (sim.plant.chillersFailed >= plant.chillers) return false;
  sim.plant.chillersFailed++;
  sim.emit('error', 'facility', 'plant', 'CHILLER_FAILED', `Chiller ${sim.plant.chillersFailed} tripped on high condenser pressure — ${plant.chillers - sim.plant.chillersFailed}/${plant.chillers} chillers available`);
  if (sim.autoRemediation) sim.openTicket('chiller', 0, MTTR_HOURS.chiller, 'Chiller service call');
  return true;
}

// ---- Hazard sampling ----------------------------------------------------------------------

export function processFailures(sim: Simulation): void {
  const m = sim.failureRateMultiplier;
  if (m <= 0) return;
  const dt = sim.dt;
  const scale = (m * dt) / SECONDS_PER_YEAR;
  const cfg = sim.primaryConfig();
  if (!cfg) return;
  const rng = sim.rng;

  // GPUs — temperature and load weighted.
  const gpuLambda = cfg.gpu.afr.v * sim.cluster.gpuHazardWeight * scale;
  let count = rng.poisson(gpuLambda);
  while (count-- > 0) {
    const gi = pickGpuByHazard(sim);
    if (gi >= 0) applyGpuFault(sim, gi);
  }
  // Correctable ECC errors (~2 per GPU-year): counters only, occasional row-remap pending.
  let sbe = rng.poisson(2 * sim.topo.gpuCount * scale);
  while (sbe-- > 0) {
    const gi = rng.int(sim.topo.gpuCount);
    if (!sim.rt.nodes.powered[sim.topo.gpuNode[gi]!]) continue;
    sim.rt.gpus.eccSbe[gi] = sim.rt.gpus.eccSbe[gi]! + 1 + rng.int(40);
  }

  // Node-level components on powered, running nodes.
  const n = sim.rt.nodes;
  let wPsu = 0;
  let wFan = 0;
  let wNic = 0;
  let wDimm = 0;
  let wNvme = 0;
  let wNode = 0;
  let wNvsw = 0;
  const eligible = (i: number) => {
    const s = n.state[i];
    return n.powered[i] === 1 && (s === NodeState.Online || s === NodeState.Degraded || s === NodeState.Draining);
  };
  for (let i = 0; i < sim.topo.nodes.length; i++) {
    if (!eligible(i)) continue;
    const c = sim.topo.nodes[i]!.cfg;
    wPsu += (c.psuCount - n.psuFailed[i]!) * c.psu.afr.v;
    wFan += (c.fanCount - n.fanFailed[i]!) * FAN_AFR;
    wNic += c.rails * (c.computeNic.afr.v + LINK_FLAP_AFR);
    wDimm += (c.dimm ? c.dimmCount * c.dimm.afr.v : c.cpuCount * 0.004);
    wNvme += c.dataDriveCount * c.dataDrive.afr.v;
    wNode += CRASH_NODE_AFR + c.cpuCount * c.cpu.afr.v;
    wNvsw += c.nvswitch ? c.nvswitchCount * c.nvswitch.afr.v : 0;
  }
  const sample = (weight: number, apply: (i: number) => void, weightOf: (i: number) => number) => {
    let k = rng.poisson(weight * scale);
    while (k-- > 0) {
      let u = rng.next() * weight;
      for (let i = 0; i < sim.topo.nodes.length; i++) {
        if (!eligible(i)) continue;
        u -= weightOf(i);
        if (u <= 0) {
          apply(i);
          break;
        }
      }
    }
  };
  const nodeCfg = (i: number) => sim.topo.nodes[i]!.cfg;
  sample(wPsu, (i) => applyPsuFault(sim, i), (i) => (nodeCfg(i).psuCount - n.psuFailed[i]!) * nodeCfg(i).psu.afr.v);
  sample(wFan, (i) => applyFanFault(sim, i), (i) => (nodeCfg(i).fanCount - n.fanFailed[i]!) * FAN_AFR);
  sample(
    wNic,
    (i) => {
      const c = nodeCfg(i);
      const permanent = rng.next() < c.computeNic.afr.v / (c.computeNic.afr.v + LINK_FLAP_AFR);
      applyNicFault(sim, i, rng.int(Math.max(1, c.rails)), permanent);
    },
    (i) => nodeCfg(i).rails * (nodeCfg(i).computeNic.afr.v + LINK_FLAP_AFR),
  );
  sample(wDimm, (i) => applyDimmFault(sim, i), (i) => {
    const c = nodeCfg(i);
    return c.dimm ? c.dimmCount * c.dimm.afr.v : c.cpuCount * 0.004;
  });
  sample(wNvme, (i) => applyNvmeFault(sim, i), (i) => nodeCfg(i).dataDriveCount * nodeCfg(i).dataDrive.afr.v);
  sample(wNode, (i) => crashNode(sim, i), (i) => CRASH_NODE_AFR + nodeCfg(i).cpuCount * nodeCfg(i).cpu.afr.v);
  sample(wNvsw, (i) => applyNvSwitchFault(sim, i), (i) => (nodeCfg(i).nvswitch ? nodeCfg(i).nvswitchCount * nodeCfg(i).nvswitch!.afr.v : 0));

  // Fabric switches.
  const sw = sim.rt.switches;
  let wSw = 0;
  for (let s = 0; s < sim.topo.switches.length; s++) if (!sw.failed[s]) wSw += sim.topo.switches[s]!.spec.afr.v;
  let k = rng.poisson(wSw * scale);
  while (k-- > 0) {
    let u = rng.next() * wSw;
    for (let s = 0; s < sim.topo.switches.length; s++) {
      if (sw.failed[s]) continue;
      u -= sim.topo.switches[s]!.spec.afr.v;
      if (u <= 0) {
        applySwitchFault(sim, s);
        break;
      }
    }
  }

  // Facility equipment.
  sim.topo.halls.forEach((hall, h) => {
    const rt = sim.halls[h]!;
    if (rng.poisson((hall.spec.air.count - rt.airUnitsFailed) * hall.airUnit.afr.v * scale) > 0) applyCoolingUnitFault(sim, h, 'air');
    if (hall.liquidUnit && hall.spec.liquid) {
      if (rng.poisson((hall.spec.liquid.count - rt.liquidUnitsFailed) * hall.liquidUnit.afr.v * scale) > 0) {
        applyCoolingUnitFault(sim, h, 'liquid');
      }
    }
  });
  const plant = sim.topo.spec.site.plant;
  if (rng.poisson((plant.chillers - sim.plant.chillersFailed) * sim.plantParams.chiller.afr.v * scale) > 0) applyChillerFault(sim);
}

function pickGpuByHazard(sim: Simulation): number {
  const total = sim.cluster.gpuHazardWeight;
  if (total <= 0) return -1;
  let u = sim.rng.next() * total;
  let node = -1;
  for (let i = 0; i < sim.topo.nodes.length; i++) {
    const w = sim.nodeHazard[i]!;
    if (w <= 0) continue;
    node = i;
    u -= w;
    if (u <= 0) break;
  }
  if (node < 0) return -1;
  // Within the node, weight by each GPU's own temperature and load.
  const info = sim.topo.nodes[node]!;
  const g = sim.rt.gpus;
  const weights: number[] = [];
  let sum = 0;
  for (let k = 0; k < info.cfg.gpuCount; k++) {
    const gi = info.gpuStart + k;
    const w = g.health[gi]! >= GpuHealth.ResetRequired ? 0 : Math.exp(5802 * (1 / 343.15 - 1 / (g.tempC[gi]! + 273.15))) * (0.4 + 0.6 * g.activity[gi]!);
    weights.push(w);
    sum += w;
  }
  if (sum <= 0) return -1;
  let v = sim.rng.next() * sum;
  for (let k = 0; k < weights.length; k++) {
    v -= weights[k]!;
    if (v <= 0) return info.gpuStart + k;
  }
  return info.gpuStart + weights.length - 1;
}

// ---- Remediation --------------------------------------------------------------------------

export function repairNodeHardware(sim: Simulation, i: number): string[] {
  const n = sim.rt.nodes;
  const node = sim.topo.nodes[i]!;
  const replaced: string[] = [];
  for (let k = 0; k < node.cfg.gpuCount; k++) {
    const gi = node.gpuStart + k;
    const h = sim.rt.gpus.health[gi]!;
    if (h === GpuHealth.Failed) {
      replaced.push(`GPU${k}`);
      sim.rt.gpus.retiredRows[gi] = 0;
      sim.rt.gpus.eccDbe[gi] = 0;
      sim.rt.gpus.eccSbe[gi] = 0;
    }
    if (h !== GpuHealth.Ok) sim.rt.gpus.health[gi] = GpuHealth.Ok;
  }
  if (n.psuFailed[i]) replaced.push(`${n.psuFailed[i]} PSU`);
  if (n.fanFailed[i]) replaced.push(`${n.fanFailed[i]} fan`);
  if (n.nicDownMask[i]) replaced.push('NIC');
  if (n.dimmFault[i]) replaced.push('DIMM');
  if (n.nvmeFault[i]) replaced.push('NVMe');
  if (n.nvswitchFault[i]) replaced.push('NVSwitch baseboard');
  n.psuFailed[i] = 0;
  n.fanFailed[i] = 0;
  n.nicDownMask[i] = 0;
  n.nicFlapTimer[i] = 0;
  n.dimmFault[i] = 0;
  n.nvmeFault[i] = 0;
  n.nvswitchFault[i] = 0;
  n.faults[i] = n.faults[i]! & ~NodeFault.Thermal;
  return replaced;
}

export function processTickets(sim: Simulation): void {
  if (!sim.autoRemediation || sim.tickets.length === 0) return;
  const due = sim.tickets.filter((t) => t.due <= sim.time).sort((a, b) => a.due - b.due || a.id - b.id);
  for (const t of due) {
    const n = sim.rt.nodes;
    switch (t.kind) {
      case 'node':
      case 'nic': {
        const i = t.target;
        // Wait until running work has left the node (drain), re-check in 10 minutes.
        if (n.job[i]! >= 0) {
          n.drain[i] = 1;
          if (n.state[i] === NodeState.Online || n.state[i] === NodeState.Degraded) sim.setNodeState(i, NodeState.Draining);
          t.due = sim.time + 600_000;
          continue;
        }
        const replaced = repairNodeHardware(sim, i);
        n.drain[i] = 0;
        const host = sim.topo.nodes[i]!.hostname;
        sim.emit('notice', 'node', host, 'REMEDIATION_COMPLETE', `Ticket #${t.id} closed: ${t.action}${replaced.length ? ` (replaced ${replaced.join(', ')})` : ''} — power cycling node`);
        if (n.powered[i] && n.state[i] !== NodeState.Failed) {
          sim.setNodeState(i, NodeState.ShuttingDown, sim.topo.nodes[i]!.cfg.platform.boot.shutdownSeconds.v);
          n.afterShutdown[i] = 1;
        } else {
          sim.powerOnNode(i);
        }
        break;
      }
      case 'psu':
      case 'fan':
      case 'nvme': {
        const i = t.target;
        if (t.kind === 'psu') n.psuFailed[i] = 0;
        if (t.kind === 'fan') n.fanFailed[i] = 0;
        if (t.kind === 'nvme') n.nvmeFault[i] = 0;
        sim.refreshNodeFaults(i);
        sim.emit('notice', 'node', sim.topo.nodes[i]!.hostname, 'REMEDIATION_COMPLETE', `Ticket #${t.id} closed: ${t.action} (no downtime)`);
        break;
      }
      case 'switch':
        restoreSwitch(sim, t.target, false);
        break;
      case 'air-unit':
        sim.halls[t.target]!.airUnitsFailed = Math.max(0, sim.halls[t.target]!.airUnitsFailed - 1);
        sim.emit('notice', 'hall', sim.topo.halls[t.target]!.id, 'REMEDIATION_COMPLETE', `Ticket #${t.id} closed: ${t.action}`);
        break;
      case 'liquid-unit':
        sim.halls[t.target]!.liquidUnitsFailed = Math.max(0, sim.halls[t.target]!.liquidUnitsFailed - 1);
        sim.emit('notice', 'hall', sim.topo.halls[t.target]!.id, 'REMEDIATION_COMPLETE', `Ticket #${t.id} closed: ${t.action}`);
        break;
      case 'chiller':
        sim.plant.chillersFailed = Math.max(0, sim.plant.chillersFailed - 1);
        sim.emit('notice', 'facility', 'plant', 'REMEDIATION_COMPLETE', `Ticket #${t.id} closed: ${t.action}`);
        break;
    }
    sim.tickets = sim.tickets.filter((x) => x.id !== t.id);
  }
}

// ---- Injection (operator / chaos testing) -------------------------------------------------

export function injectFault(sim: Simulation, target: FaultTarget): CommandResult {
  const nodeRef = (ref: number | string) => {
    const i = sim.resolveNode(ref);
    return i;
  };
  const notPowered = (i: number) =>
    !sim.rt.nodes.powered[i] || sim.rt.nodes.state[i] === NodeState.Failed
      ? { ok: false as const, error: { code: 'NODE_NOT_RUNNING', message: `${sim.topo.nodes[i]!.hostname} is not running` } }
      : null;
  switch (target.kind) {
    case 'node-crash':
    case 'gpu':
    case 'psu':
    case 'fan':
    case 'nic':
    case 'dimm': {
      const i = nodeRef(target.node);
      if (i === null) return { ok: false, error: { code: 'NODE_NOT_FOUND', message: `Unknown node ${String(target.node)}` } };
      const err = notPowered(i);
      if (err) return err;
      const host = sim.topo.nodes[i]!.hostname;
      if (target.kind === 'node-crash') crashNode(sim, i);
      else if (target.kind === 'gpu') {
        const k = target.gpu ?? sim.rng.int(sim.topo.nodes[i]!.cfg.gpuCount);
        if (k < 0 || k >= sim.topo.nodes[i]!.cfg.gpuCount) return { ok: false, error: { code: 'GPU_NOT_FOUND', message: `GPU index ${k} out of range` } };
        applyGpuFault(sim, sim.topo.nodes[i]!.gpuStart + k, target.xid);
      } else if (target.kind === 'psu') applyPsuFault(sim, i);
      else if (target.kind === 'fan') applyFanFault(sim, i);
      else if (target.kind === 'nic') applyNicFault(sim, i, target.rail ?? 0, true);
      else applyDimmFault(sim, i);
      return { ok: true, message: `Injected ${target.kind} fault on ${host}` };
    }
    case 'switch': {
      const s = typeof target.switch === 'number' ? target.switch : sim.switchIndex.get(target.switch);
      if (s === undefined || s < 0 || s >= sim.topo.switches.length) {
        return { ok: false, error: { code: 'SWITCH_NOT_FOUND', message: `Unknown switch ${String(target.switch)}` } };
      }
      if (sim.rt.switches.failed[s]) return { ok: false, error: { code: 'SWITCH_ALREADY_FAILED', message: `${sim.topo.switches[s]!.name} is already failed` } };
      applySwitchFault(sim, s);
      return { ok: true, message: `Injected failure on ${sim.topo.switches[s]!.name}` };
    }
    case 'cooling-unit':
      return applyCoolingUnitFault(sim, target.hall, target.unit)
        ? { ok: true, message: `Injected ${target.unit} cooling unit failure in hall ${target.hall}` }
        : { ok: false, error: { code: 'NO_UNIT_AVAILABLE', message: 'No running unit of that type in this hall' } };
    case 'chiller':
      return applyChillerFault(sim)
        ? { ok: true, message: 'Injected chiller failure' }
        : { ok: false, error: { code: 'NO_UNIT_AVAILABLE', message: 'All chillers have already failed' } };
  }
}
