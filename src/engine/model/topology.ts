/**
 * Expansion of an {@link InfraSpec} into the concrete topology: every hall, rack, node, GPU,
 * switch, storage system and fabric link. Deterministic: the same spec always yields the same
 * topology (indices, names and offsets), which is what makes simulation state restorable.
 */
import {
  part,
  type CoolingUnitSpec,
  type PduSpec,
  type RackSpec,
  type RackSystemSpec,
  type StorageSystemSpec,
  type SwitchSpec,
} from '../../catalog';
import { Rng, hashString } from '../core/rng';
import { CABLE_LENGTH_M, CABLE_NS_PER_M, planFabric, type FabricPlan } from './fabric';
import { resolveNodeConfig, type ResolvedNodeConfig } from './resolve';
import { usableUnits, type HallSpec, type InfraSpec, type RackCooling, type RackTemplate } from './spec';

export type RackKind = 'compute' | 'network' | 'storage';

export interface HallInfo {
  readonly idx: number;
  readonly id: string;
  readonly name: string;
  readonly spec: HallSpec;
  readonly rackIdx: number[];
  readonly airUnit: CoolingUnitSpec;
  /** Air-side capacity usable while keeping the redundancy target (W). */
  readonly airUsableW: number;
  readonly airInstalledW: number;
  readonly liquidUnit: CoolingUnitSpec | null;
  readonly liquidUsableW: number;
  readonly liquidInstalledW: number;
}

export interface RackInfo {
  readonly idx: number;
  readonly name: string;
  readonly hallIdx: number;
  readonly rowId: string;
  readonly position: number;
  readonly kind: RackKind;
  readonly spec: RackSpec;
  readonly cooling: RackCooling;
  readonly pdu: { readonly spec: PduSpec; readonly perFeed: number; readonly feeds: 1 | 2 };
  readonly template: RackTemplate | null;
  readonly rackSystem: RackSystemSpec | null;
  readonly nodeStart: number;
  readonly nodeCount: number;
  readonly switchIdx: number[];
  readonly storageIdx: number[];
  readonly usedU: number;
  readonly weightKg: number;
  /** In-rack power not attributable to nodes (NVLink switch trays, network/storage gear): idle/peak W. */
  readonly auxIdleW: number;
  readonly auxPeakW: number;
  /** Design peak wall power of the whole rack (W). */
  readonly designPeakW: number;
  /** Static inlet temperature offset from airflow recirculation (°C). */
  readonly inletOffsetC: number;
}

export interface NodeInfo {
  readonly idx: number;
  readonly hostname: string;
  readonly rackIdx: number;
  readonly hallIdx: number;
  readonly slotU: number;
  readonly cfg: ResolvedNodeConfig;
  readonly gpuStart: number;
  /** Scale-up (NVLink / Infinity Fabric) domain id. */
  readonly nvlDomain: number;
  /** Leaf group (scheduling locality unit; -1 without fabric). */
  readonly leafGroup: number;
}

export type SwitchTier = 0 | 1 | 2;
export const SWITCH_TIER_NAMES = ['leaf', 'spine', 'core'] as const;

export interface SwitchInfo {
  readonly idx: number;
  readonly name: string;
  readonly tier: SwitchTier;
  readonly plane: number;
  readonly group: number;
  readonly spec: SwitchSpec;
  rackIdx: number;
  /** Down-facing and up-facing capacity (Gb/s, one direction). */
  readonly downCapacityGbps: number;
  readonly upCapacityGbps: number;
}

export interface StorageInfo {
  readonly idx: number;
  readonly name: string;
  readonly spec: StorageSystemSpec;
  rackIdx: number;
}

/** Struct-of-arrays link table. Endpoint A is a node (tier 0) or a switch (tiers 1, 2). */
export interface LinkTable {
  readonly count: number;
  readonly a: Int32Array;
  readonly b: Int32Array;
  /** 0 = node↔leaf, 1 = leaf↔spine, 2 = spine↔core */
  readonly tier: Uint8Array;
  readonly plane: Int16Array;
  readonly bandwidthGbps: Float32Array;
  readonly latencyNs: Float32Array;
}

export interface Topology {
  readonly spec: InfraSpec;
  readonly fingerprint: string;
  readonly halls: HallInfo[];
  readonly racks: RackInfo[];
  readonly nodes: NodeInfo[];
  readonly switches: SwitchInfo[];
  readonly storage: StorageInfo[];
  readonly gpuCount: number;
  readonly gpuNode: Int32Array;
  readonly gpuLocal: Uint8Array;
  readonly nvlDomainCount: number;
  readonly configs: ResolvedNodeConfig[];
  readonly fabric: FabricPlan;
  readonly maxRails: number;
  readonly links: LinkTable;
  /** Leaf switch per (node, rail): index node * maxRails + rail; -1 if not connected. */
  readonly nodeLeaf: Int32Array;
  /** Access link per (node, rail), same indexing; -1 if not connected. */
  readonly nodeLink: Int32Array;
  /** Uplink link indices per switch (leaf→spine, spine→core). */
  readonly switchUplinks: number[][];
  readonly leafGroups: number;
}

const NETWORK_RACK_U = 40;
const NETWORK_RACK_MAX_W = 30_000;
const STORAGE_RACK_MAX_W = 16_000;
/** Cabling, blanking panels and rails per occupied U (assumption). */
const CABLING_KG_PER_U = 2;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function expandTopology(spec: InfraSpec): Topology {
  const configCache = new Map<string, ResolvedNodeConfig>();
  const configFor = (template: RackTemplate) => {
    const key = JSON.stringify(template);
    let cfg = configCache.get(key);
    if (!cfg) {
      cfg = resolveNodeConfig(template);
      configCache.set(key, cfg);
    }
    return cfg;
  };

  const layoutRng = new Rng(hashString(`layout:${spec.id}`));
  const halls: HallInfo[] = [];
  const racks: RackInfo[] = [];
  const nodes: NodeInfo[] = [];
  let gpuCount = 0;
  let nvlDomain = 0;

  spec.halls.forEach((hallSpec, hallIdx) => {
    const airUnit = part('cooling', hallSpec.air.unitId);
    const liquidUnit = hallSpec.liquid ? part('cooling', hallSpec.liquid.cduId) : null;
    const hall: HallInfo = {
      idx: hallIdx,
      id: hallSpec.id,
      name: hallSpec.name,
      spec: hallSpec,
      rackIdx: [],
      airUnit,
      airUsableW: usableUnits(hallSpec.air.redundancy, hallSpec.air.count) * airUnit.capacityKW.v * 1000,
      airInstalledW: hallSpec.air.count * airUnit.capacityKW.v * 1000,
      liquidUnit,
      liquidUsableW:
        liquidUnit && hallSpec.liquid
          ? usableUnits(hallSpec.liquid.redundancy, hallSpec.liquid.count) * liquidUnit.capacityKW.v * 1000
          : 0,
      liquidInstalledW:
        liquidUnit && hallSpec.liquid ? hallSpec.liquid.count * liquidUnit.capacityKW.v * 1000 : 0,
    };
    halls.push(hall);

    for (const row of hallSpec.rows) {
      let position = 0;
      for (const group of row.rackGroups) {
        const template = group.template;
        const cfg = configFor(template);
        const rackSpec = part('rack', template.rackId);
        const pduSpec = part('pdu', template.pdu.pduId);
        const rackSystem = cfg.rackSystem;
        const nodesPerRack = rackSystem
          ? rackSystem.computeTrays
          : template.system.kind === 'platform'
            ? template.system.nodesPerRack
            : 0;

        for (let r = 0; r < group.count; r++) {
          position++;
          const rackIdx = racks.length;
          const rackName = `${hallSpec.id}-${row.id}${pad(position)}`;
          const nodeStart = nodes.length;
          const sharedDomain = rackSystem ? nvlDomain++ : -1;
          for (let n = 0; n < nodesPerRack; n++) {
            const idx = nodes.length;
            nodes.push({
              idx,
              hostname: `gpu-${hallSpec.id}${row.id}${pad(position)}-${pad(n + 1)}`.toLowerCase(),
              rackIdx,
              hallIdx,
              slotU: 2 + n * cfg.rackUnits,
              cfg,
              gpuStart: gpuCount,
              nvlDomain: sharedDomain >= 0 ? sharedDomain : nvlDomain++,
              leafGroup: -1,
            });
            gpuCount += cfg.gpuCount;
          }

          let auxIdleW = 0;
          let auxPeakW = 0;
          let usedU = nodesPerRack * cfg.rackUnits;
          let weightKg: number;
          if (rackSystem) {
            const nvsw = part('nvswitch', rackSystem.nvswitchPerTray.id);
            const perTrayPeak =
              nvsw.powerW.v * rackSystem.nvswitchPerTray.count + rackSystem.switchTrayOverheadW.v;
            const perTrayIdle =
              nvsw.powerW.v * rackSystem.nvswitchPerTray.count * 0.4 + rackSystem.switchTrayOverheadW.v * 0.6;
            // Switch trays are fed by the same power shelves (≈97.5 % conversion efficiency).
            auxPeakW = (rackSystem.switchTrays * perTrayPeak) / 0.975;
            auxIdleW = (rackSystem.switchTrays * perTrayIdle) / 0.975;
            usedU += rackSystem.switchTrays + rackSystem.powerShelves;
            weightKg = rackSystem.weightKg.v;
          } else {
            weightKg = rackSpec.emptyWeightKg.v + nodesPerRack * cfg.weightKg + usedU * CABLING_KG_PER_U;
          }

          const rack: RackInfo = {
            idx: rackIdx,
            name: rackName,
            hallIdx,
            rowId: row.id,
            position,
            kind: 'compute',
            spec: rackSpec,
            cooling: template.cooling,
            pdu: { spec: pduSpec, perFeed: template.pdu.perFeed, feeds: template.pdu.feeds },
            template,
            rackSystem,
            nodeStart,
            nodeCount: nodesPerRack,
            switchIdx: [],
            storageIdx: [],
            usedU,
            weightKg,
            auxIdleW,
            auxPeakW,
            designPeakW: nodesPerRack * cfg.peakWallW + auxPeakW,
            inletOffsetC: layoutRng.range(0, 1.5),
          };
          racks.push(rack);
          hall.rackIdx.push(rackIdx);
        }
      }
    }
  });

  // ---- Backend fabric -------------------------------------------------------------------
  const maxRails = nodes.reduce((m, n) => Math.max(m, n.cfg.rails), 0);
  const switchSpec = spec.fabric.topology === 'none' ? null : part('switch', spec.fabric.switchId);
  const totalPorts = nodes.reduce((s, n) => s + n.cfg.rails, 0);
  const railOptimized = spec.fabric.topology === 'rail-optimized';
  const plan = planFabric(
    spec.fabric.topology,
    switchSpec,
    spec.fabric.oversubscription,
    spec.fabric.topology === 'none' ? 0 : railOptimized ? maxRails : 1,
    railOptimized ? nodes.length : totalPorts,
  );

  const switches: SwitchInfo[] = [];
  const nodeLeaf = new Int32Array(nodes.length * Math.max(1, maxRails)).fill(-1);
  const nodeLink = new Int32Array(nodes.length * Math.max(1, maxRails)).fill(-1);
  const switchUplinks: number[][] = [];
  const linkA: number[] = [];
  const linkB: number[] = [];
  const linkTier: number[] = [];
  const linkPlane: number[] = [];
  const linkBw: number[] = [];
  const linkLat: number[] = [];
  const addLink = (a: number, b: number, tier: number, plane: number, bw: number, lengthM: number) => {
    linkA.push(a);
    linkB.push(b);
    linkTier.push(tier);
    linkPlane.push(plane);
    linkBw.push(bw);
    linkLat.push(lengthM * CABLE_NS_PER_M);
    return linkA.length - 1;
  };

  let leafGroups = 0;
  if (plan.tiers > 0 && switchSpec) {
    const prefix = switchSpec.fabric === 'InfiniBand' ? 'ib' : 'eth';
    const s = plan.portSpeedGbps;
    const addSwitch = (
      name: string,
      tier: SwitchTier,
      plane: number,
      group: number,
      down: number,
      up: number,
    ) => {
      switches.push({
        idx: switches.length,
        name,
        tier,
        plane,
        group,
        spec: switchSpec,
        rackIdx: -1,
        downCapacityGbps: down,
        upCapacityGbps: up,
      });
      switchUplinks.push([]);
      return switches.length - 1;
    };

    for (let p = 0; p < plan.planes; p++) {
      const planeTag = railOptimized ? `r${p}-` : '';
      const leafIdx: number[] = [];
      for (let l = 0; l < plan.leavesPerPlane; l++) {
        leafIdx.push(
          addSwitch(
            `${prefix}-leaf-${planeTag}${pad(l + 1, 3)}`,
            0,
            p,
            l,
            plan.downPorts * s,
            plan.upPorts * s,
          ),
        );
      }
      if (plan.tiers === 2) {
        const spineIdx: number[] = [];
        for (let j = 0; j < plan.spinesPerPlane; j++) {
          spineIdx.push(addSwitch(`${prefix}-spine-${planeTag}${pad(j + 1, 3)}`, 1, p, 0, plan.radix * s, 0));
        }
        const trunk = (plan.upPorts * s) / plan.spinesPerPlane;
        for (const l of leafIdx) {
          for (const sp of spineIdx) {
            switchUplinks[l]!.push(addLink(l, sp, 1, p, trunk, CABLE_LENGTH_M.leafSpine));
          }
        }
      } else if (plan.tiers === 3) {
        const spineUp = plan.radix - plan.leavesPerPod;
        const coreIdx: number[][] = [];
        for (let g = 0; g < plan.coreGroups; g++) {
          const groupCores: number[] = [];
          for (let c = 0; c < plan.coresPerGroup; c++) {
            groupCores.push(
              addSwitch(`${prefix}-core-${planeTag}g${pad(g + 1)}-${pad(c + 1)}`, 2, p, g, plan.radix * s, 0),
            );
          }
          coreIdx.push(groupCores);
        }
        for (let pod = 0; pod < plan.podsPerPlane; pod++) {
          const podSpines: number[] = [];
          for (let j = 0; j < plan.spinesPerGroup; j++) {
            const sp = addSwitch(
              `${prefix}-spine-${planeTag}p${pad(pod + 1)}-${pad(j + 1)}`,
              1,
              p,
              pod,
              plan.leavesPerPod * s,
              spineUp * s,
            );
            podSpines.push(sp);
            const cores = coreIdx[j]!;
            const trunk = (spineUp * s) / cores.length;
            for (const c of cores)
              switchUplinks[sp]!.push(addLink(sp, c, 2, p, trunk, CABLE_LENGTH_M.spineCore));
          }
          const firstLeaf = pod * plan.leavesPerPod;
          const lastLeaf = Math.min(plan.leavesPerPlane, firstLeaf + plan.leavesPerPod);
          for (let l = firstLeaf; l < lastLeaf; l++) {
            const leaf = leafIdx[l]!;
            const trunk = (plan.upPorts * s) / podSpines.length;
            for (const sp of podSpines)
              switchUplinks[leaf]!.push(addLink(leaf, sp, 1, p, trunk, CABLE_LENGTH_M.leafSpine));
          }
        }
      }

      // Access links
      let endpoint = 0;
      for (const node of nodes) {
        const rails = node.cfg.rails;
        const bw = Math.min(node.cfg.computeNic.portSpeedGbps, s);
        if (railOptimized) {
          if (p >= rails) continue;
          const leafLocal = plan.tiers === 1 ? 0 : Math.floor(node.idx / plan.downPorts);
          const leaf = leafIdx[leafLocal]!;
          nodeLeaf[node.idx * maxRails + p] = leaf;
          nodeLink[node.idx * maxRails + p] = addLink(node.idx, leaf, 0, p, bw, CABLE_LENGTH_M.access);
        } else {
          for (let r = 0; r < rails; r++) {
            const leafLocal = plan.tiers === 1 ? 0 : Math.floor(endpoint / plan.downPorts);
            endpoint++;
            const leaf = leafIdx[leafLocal]!;
            nodeLeaf[node.idx * maxRails + r] = leaf;
            nodeLink[node.idx * maxRails + r] = addLink(node.idx, leaf, 0, p, bw, CABLE_LENGTH_M.access);
          }
        }
      }
    }

    // Leaf group of each node = leaf index of rail 0 within its plane.
    for (const node of nodes) {
      const leaf = nodeLeaf[node.idx * maxRails];
      const group = leaf !== undefined && leaf >= 0 ? switches[leaf]!.group : -1;
      (node as { leafGroup: number }).leafGroup = group;
      leafGroups = Math.max(leafGroups, group + 1);
    }
  }

  // ---- Network racks --------------------------------------------------------------------
  // Leaves are placed in the hall of the first node they serve; spines and cores in hall 0.
  const leafHall = new Int32Array(switches.length).fill(-1);
  for (let i = 0; i < nodeLeaf.length; i++) {
    const leaf = nodeLeaf[i]!;
    if (leaf >= 0 && leafHall[leaf] === -1) leafHall[leaf] = nodes[Math.floor(i / maxRails)]!.hallIdx;
  }
  const switchesByHall = new Map<number, number[]>();
  for (const sw of switches) {
    const hallIdx = sw.tier === 0 ? Math.max(0, leafHall[sw.idx]!) : 0;
    const list = switchesByHall.get(hallIdx) ?? [];
    list.push(sw.idx);
    switchesByHall.set(hallIdx, list);
  }
  const netRackSpec = part('rack', 'rack-42u-600');
  const netPdu = part('pdu', 'pdu-3ph-415v-60a');
  for (const [hallIdx, swList] of [...switchesByHall.entries()].sort((a, b) => a[0] - b[0])) {
    const hall = halls[hallIdx]!;
    let current: { switchIdx: number[]; usedU: number; peakW: number; idleW: number } | null = null;
    const flush = () => {
      if (!current || current.switchIdx.length === 0) return;
      const idx = racks.length;
      const position = racks.filter((r) => r.hallIdx === hallIdx && r.kind === 'network').length + 1;
      racks.push({
        idx,
        name: `${hall.id}-N${pad(position)}`,
        hallIdx,
        rowId: 'N',
        position,
        kind: 'network',
        spec: netRackSpec,
        cooling: 'rdhx',
        pdu: { spec: netPdu, perFeed: 1, feeds: 2 },
        template: null,
        rackSystem: null,
        nodeStart: 0,
        nodeCount: 0,
        switchIdx: current.switchIdx,
        storageIdx: [],
        usedU: current.usedU,
        weightKg: netRackSpec.emptyWeightKg.v + current.usedU * (12 + CABLING_KG_PER_U),
        auxIdleW: current.idleW,
        auxPeakW: current.peakW,
        designPeakW: current.peakW,
        inletOffsetC: layoutRng.range(0, 1.0),
      });
      for (const s of current.switchIdx) switches[s]!.rackIdx = idx;
      hall.rackIdx.push(idx);
    };
    for (const s of swList) {
      const sw = switches[s]!;
      const u = sw.spec.rackUnits;
      const peak = sw.spec.powerMaxW.v;
      if (!current || current.usedU + u > NETWORK_RACK_U || current.peakW + peak > NETWORK_RACK_MAX_W) {
        flush();
        current = { switchIdx: [], usedU: 0, peakW: 0, idleW: 0 };
      }
      current.switchIdx.push(s);
      current.usedU += u;
      current.peakW += peak;
      current.idleW += sw.spec.powerTypicalW.v * 0.7;
    }
    flush();
  }

  // ---- Storage ----------------------------------------------------------------------------
  const storage: StorageInfo[] = [];
  if (spec.storage.count > 0) {
    const sysSpec = part('storage', spec.storage.systemId);
    for (let i = 0; i < spec.storage.count; i++) {
      storage.push({
        idx: i,
        name: `stor-${sysSpec.class === 'parallel-fs' ? 'pfs' : 'nfs'}-${pad(i + 1)}`,
        spec: sysSpec,
        rackIdx: -1,
      });
    }
    const perRack = Math.max(
      1,
      Math.min(
        Math.floor(NETWORK_RACK_U / sysSpec.rackUnits),
        Math.floor(STORAGE_RACK_MAX_W / sysSpec.powerW.v),
      ),
    );
    const storRackSpec = part('rack', 'rack-42u-600');
    const storPdu = part('pdu', 'pdu-3ph-415v-32a');
    for (let i = 0; i < storage.length; i += perRack) {
      const members = storage.slice(i, i + perRack);
      const idx = racks.length;
      const position = i / perRack + 1;
      const peakW = members.length * sysSpec.powerW.v;
      racks.push({
        idx,
        name: `${halls[0]!.id}-S${pad(position)}`,
        hallIdx: 0,
        rowId: 'S',
        position,
        kind: 'storage',
        spec: storRackSpec,
        cooling: 'air',
        pdu: { spec: storPdu, perFeed: 1, feeds: 2 },
        template: null,
        rackSystem: null,
        nodeStart: 0,
        nodeCount: 0,
        switchIdx: [],
        storageIdx: members.map((m) => m.idx),
        usedU: members.length * sysSpec.rackUnits,
        weightKg: storRackSpec.emptyWeightKg.v + members.length * sysSpec.rackUnits * (25 + CABLING_KG_PER_U),
        auxIdleW: peakW * 0.75,
        auxPeakW: peakW,
        designPeakW: peakW,
        inletOffsetC: layoutRng.range(0, 1.0),
      });
      for (const m of members) m.rackIdx = idx;
      halls[0]!.rackIdx.push(idx);
    }
  }

  // ---- GPU index arrays -------------------------------------------------------------------
  const gpuNode = new Int32Array(gpuCount);
  const gpuLocal = new Uint8Array(gpuCount);
  for (const node of nodes) {
    for (let g = 0; g < node.cfg.gpuCount; g++) {
      gpuNode[node.gpuStart + g] = node.idx;
      gpuLocal[node.gpuStart + g] = g;
    }
  }

  const links: LinkTable = {
    count: linkA.length,
    a: Int32Array.from(linkA),
    b: Int32Array.from(linkB),
    tier: Uint8Array.from(linkTier),
    plane: Int16Array.from(linkPlane),
    bandwidthGbps: Float32Array.from(linkBw),
    latencyNs: Float32Array.from(linkLat),
  };

  const fingerprint = [
    spec.id,
    hashString(JSON.stringify(spec)).toString(16),
    racks.length,
    nodes.length,
    gpuCount,
    switches.length,
    links.count,
  ].join(':');

  return {
    spec,
    fingerprint,
    halls,
    racks,
    nodes,
    switches,
    storage,
    gpuCount,
    gpuNode,
    gpuLocal,
    nvlDomainCount: nvlDomain,
    configs: [...configCache.values()],
    fabric: plan,
    maxRails,
    links,
    nodeLeaf,
    nodeLink,
    switchUplinks,
    leafGroups,
  };
}
