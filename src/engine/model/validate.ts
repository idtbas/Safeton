/**
 * Engineering validation of an infrastructure specification.
 *
 * Phase 1 checks catalog references and value ranges on the raw spec. Only if that passes is
 * the topology expanded and phase 2 runs the physical checks (space, weight, power, cooling,
 * redundancy, fabric, electrical plant). Every issue carries a stable code, a spec path and
 * its parameters so UIs can localise or link to the offending field.
 */
import { tryPart, type CatalogKind } from '../../catalog';
import { deriveMetrics, type DerivedMetrics } from './derive';
import { buildPlantParams, rdhxCapacityW, splitRackHeat } from './plant';
import type { ResolvedNodeConfig } from './resolve';
import { usableUnits, type InfraSpec, type RackTemplate } from './spec';
import { expandTopology, type Topology } from './topology';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  path: string;
  params?: Record<string, string | number>;
}

export interface ValidationReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
  topology: Topology | null;
  metrics: DerivedMetrics | null;
}

/** Air-cooled rack density limits (ASHRAE TC 9.9 practice; assumption). */
export const AIR_RACK_CONTAINMENT_KW = 25;
export const AIR_RACK_MAX_KW = 40;
export const DLC_RESIDUAL_AIR_MAX_KW = 40;

const kw = (w: number) => Math.round(w / 100) / 10;
const pct = (x: number) => Math.round(x * 100);

class IssueList {
  readonly items: ValidationIssue[] = [];
  add(severity: IssueSeverity, code: string, path: string, message: string, params?: ValidationIssue['params']) {
    this.items.push(params ? { severity, code, path, message, params } : { severity, code, path, message });
  }
}

function checkRef(issues: IssueList, kind: CatalogKind, id: string | null | undefined, path: string, cls?: string[]) {
  if (id === null || id === undefined) return;
  const item = tryPart(kind, id);
  if (!item) {
    issues.add('error', 'CATALOG_REF_UNKNOWN', path, `Unknown ${kind} "${id}"`, { id, kind });
    return;
  }
  if (cls && 'class' in item && !cls.includes(item.class as string)) {
    issues.add('error', 'CATALOG_REF_WRONG_CLASS', path, `"${id}" is a ${String(item.class)} unit, expected ${cls.join(' or ')}`, {
      id,
    });
  }
}

function checkRange(
  issues: IssueList,
  value: number,
  path: string,
  label: string,
  hard: [number, number],
  soft?: [number, number],
  unit = '',
) {
  if (!Number.isFinite(value) || value < hard[0] || value > hard[1]) {
    issues.add('error', 'VALUE_OUT_OF_RANGE', path, `${label} ${value}${unit} is outside the permitted range ${hard[0]}–${hard[1]}${unit}`, {
      value,
    });
  } else if (soft && (value < soft[0] || value > soft[1])) {
    issues.add('warning', 'VALUE_OUTSIDE_RECOMMENDED', path, `${label} ${value}${unit} is outside the recommended range ${soft[0]}–${soft[1]}${unit}`, {
      value,
    });
  }
}

function validateReferences(spec: InfraSpec, issues: IssueList) {
  if (spec.halls.length === 0) issues.add('error', 'NO_HALLS', 'halls', 'The site has no data halls');
  const site = spec.site;
  checkRef(issues, 'ups', site.ups.upsId, 'site.ups.upsId');
  checkRef(issues, 'cooling', site.plant.chillerId, 'site.plant.chillerId', ['chiller']);
  checkRef(issues, 'cooling', site.plant.dryCoolerId, 'site.plant.dryCoolerId', ['drycooler']);
  checkRange(issues, site.plant.chilledWaterSupplyC, 'site.plant.chilledWaterSupplyC', 'Chilled-water supply', [5, 24], [7, 20], ' °C');
  checkRange(issues, site.plant.warmWaterSupplyC, 'site.plant.warmWaterSupplyC', 'Warm-water supply (ASHRAE W-class)', [17, 45], [25, 40], ' °C');
  checkRange(issues, site.energyPriceEurPerKWh, 'site.energyPriceEurPerKWh', 'Energy price', [0, 2], undefined, ' €/kWh');
  checkRange(issues, site.utility.feedMW, 'site.utility.feedMW', 'Utility feed', [0.01, 2000], undefined, ' MW');
  if (spec.fabric.topology !== 'none') checkRef(issues, 'switch', spec.fabric.switchId, 'fabric.switchId');
  checkRange(issues, spec.fabric.oversubscription, 'fabric.oversubscription', 'Leaf oversubscription', [1, 8], [1, 3]);
  if (spec.storage.count > 0) checkRef(issues, 'storage', spec.storage.systemId, 'storage.systemId');
  checkRange(issues, spec.storage.count, 'storage.count', 'Storage system count', [0, 1000]);

  spec.halls.forEach((hall, h) => {
    const hp = `halls[${h}]`;
    checkRef(issues, 'cooling', hall.air.unitId, `${hp}.air.unitId`, ['crah', 'inrow']);
    checkRange(issues, hall.air.supplyC, `${hp}.air.supplyC`, 'Supply air (ASHRAE A1)', [15, 32], [18, 27], ' °C');
    checkRange(issues, hall.air.count, `${hp}.air.count`, 'Air handler count', [0, 10_000]);
    if (hall.liquid) {
      checkRef(issues, 'cooling', hall.liquid.cduId, `${hp}.liquid.cduId`, ['cdu']);
      checkRange(issues, hall.liquid.supplyC, `${hp}.liquid.supplyC`, 'TCS coolant supply', [17, 45], [25, 40], ' °C');
    }
    hall.rows.forEach((row, r) => {
      row.rackGroups.forEach((group, g) => {
        const gp = `${hp}.rows[${r}].rackGroups[${g}]`;
        if (!Number.isInteger(group.count) || group.count < 1) {
          issues.add('error', 'RACK_GROUP_COUNT', `${gp}.count`, `Rack count must be a positive integer (got ${group.count})`);
        }
        const t = group.template;
        checkRef(issues, 'rack', t.rackId, `${gp}.template.rackId`);
        checkRef(issues, 'pdu', t.pdu.pduId, `${gp}.template.pdu.pduId`);
        if (t.pdu.perFeed < 1) issues.add('error', 'PDU_COUNT', `${gp}.template.pdu.perFeed`, 'At least one PDU per feed is required');
        if (t.system.kind === 'platform') {
          checkRef(issues, 'platform', t.system.platformId, `${gp}.template.system.platformId`);
          if (!Number.isInteger(t.system.nodesPerRack) || t.system.nodesPerRack < 1) {
            issues.add('error', 'NODES_PER_RACK', `${gp}.template.system.nodesPerRack`, 'Nodes per rack must be a positive integer');
          }
          const platform = tryPart('platform', t.system.platformId);
          if (platform?.class === 'rack-scale-tray') {
            issues.add(
              'error',
              'PLATFORM_REQUIRES_RACK_SYSTEM',
              `${gp}.template.system`,
              `${platform.name} is only available as part of a rack-scale system`,
            );
          }
        } else {
          checkRef(issues, 'rack-system', t.system.rackSystemId, `${gp}.template.system.rackSystemId`);
        }
        const o = t.system.overrides;
        if (o) {
          checkRef(issues, 'dimm', o.dimmId, `${gp}.template.system.overrides.dimmId`);
          checkRef(issues, 'nvme', o.dataDriveId, `${gp}.template.system.overrides.dataDriveId`);
          checkRef(issues, 'nic', o.computeNicId, `${gp}.template.system.overrides.computeNicId`);
          checkRef(issues, 'psu', o.psuId, `${gp}.template.system.overrides.psuId`);
        }
      });
    });
  });
}

interface TemplateUse {
  path: string;
  template: RackTemplate;
  hallIdx: number;
  rackIdx: number;
}

function validateNodeConfig(cfg: ResolvedNodeConfig, path: string, topo: Topology, issues: IssueList) {
  const p = cfg.platform;
  const gpu = cfg.gpu;
  const op = `${path}.template.system.overrides`;
  if (!p.cooling.includes(cfg.cooling)) {
    issues.add(
      'error',
      'PLATFORM_COOLING_UNSUPPORTED',
      `${path}.template.cooling`,
      `${p.name} does not support ${cfg.cooling} cooling (supported: ${p.cooling.join(', ')})`,
    );
  }
  if (cfg.gpuPowerLimitW < gpu.power.minPowerLimitW.v || cfg.gpuPowerLimitW > gpu.power.tdpW.v) {
    issues.add(
      'error',
      'GPU_POWER_LIMIT_RANGE',
      `${op}.gpuPowerLimitW`,
      `GPU power limit ${cfg.gpuPowerLimitW} W outside the ${gpu.name} range ${gpu.power.minPowerLimitW.v}–${gpu.power.tdpW.v} W`,
    );
  }
  if (cfg.dimm) {
    if (p.dimmSlots === 0) {
      issues.add('error', 'DIMM_ON_PACKAGE_PLATFORM', `${op}.dimmId`, `${p.name} uses on-package ${cfg.cpu.memory.type}; DIMMs cannot be installed`);
    }
    if (cfg.dimmCount > p.dimmSlots) {
      issues.add('error', 'DIMM_SLOTS_EXCEEDED', `${op}.dimmCount`, `${cfg.dimmCount} DIMMs exceed the ${p.dimmSlots} slots of ${p.name}`);
    }
    const dimmGen = cfg.dimm.type.startsWith('DDR5') ? 'DDR5' : 'DDR4';
    if (dimmGen !== cfg.cpu.memory.type) {
      issues.add('error', 'DIMM_TYPE_MISMATCH', `${op}.dimmId`, `${cfg.dimm.name} is ${dimmGen}; ${cfg.cpu.name} requires ${cfg.cpu.memory.type}`);
    }
    const channels = cfg.cpu.memory.channels * cfg.cpuCount;
    if (cfg.dimmCount % channels !== 0) {
      issues.add(
        'warning',
        'DIMM_POPULATION_UNBALANCED',
        `${op}.dimmCount`,
        `${cfg.dimmCount} DIMMs across ${channels} channels is unbalanced; populate multiples of ${channels} for full bandwidth`,
      );
    }
    if (cfg.memorySpeedMTs < cfg.dimm.speedMTs) {
      issues.add(
        'info',
        'MEMORY_DOWNCLOCKED',
        `${op}.dimmId`,
        `Memory runs at ${cfg.memorySpeedMTs} MT/s (DIMM rated ${cfg.dimm.speedMTs} MT/s; limited by CPU support or 2 DIMMs per channel)`,
      );
    }
  }
  if (cfg.dataDriveCount > p.dataDriveBays) {
    issues.add('error', 'DRIVE_BAYS_EXCEEDED', `${op}.dataDriveCount`, `${cfg.dataDriveCount} data drives exceed the ${p.dataDriveBays} bays of ${p.name}`);
  }
  if (cfg.psuCount < cfg.psuRequired) {
    issues.add(
      'error',
      'PSU_INSUFFICIENT',
      `${op}.psuCount`,
      `${cfg.psuCount} × ${cfg.psu.name} cannot carry the ${kw(cfg.peakDcW)} kW peak DC load (${cfg.psuRequired} required)`,
      { required: cfg.psuRequired },
    );
  } else if (cfg.psuCount === cfg.psuRequired && cfg.psu.id !== 'busbar-54v-feed') {
    issues.add('warning', 'PSU_NO_REDUNDANCY', `${op}.psuCount`, `PSUs are not redundant (N = ${cfg.psuRequired}); a single PSU failure triggers power brake`);
  }
  if (cfg.peakWallW > p.maxPowerW.v * 1.05) {
    issues.add(
      'warning',
      'PLATFORM_POWER_ABOVE_RATING',
      path,
      `Bottom-up peak ${kw(cfg.peakWallW)} kW exceeds the published ${kw(p.maxPowerW.v)} kW system maximum`,
    );
  }
  const sw = topo.fabric.switchSpec;
  if (sw && cfg.computeNic.portSpeedGbps !== sw.portSpeedGbps) {
    issues.add(
      cfg.computeNic.portSpeedGbps > sw.portSpeedGbps ? 'warning' : 'info',
      'NIC_SWITCH_SPEED_MISMATCH',
      `${op}.computeNicId`,
      `${cfg.computeNic.name} (${cfg.computeNic.portSpeedGbps} Gb/s) on ${sw.name} (${sw.portSpeedGbps} Gb/s): links run at ${Math.min(cfg.computeNic.portSpeedGbps, sw.portSpeedGbps)} Gb/s`,
    );
  }
}

function validateTopology(spec: InfraSpec, topo: Topology, metrics: DerivedMetrics, issues: IssueList) {
  const uses: TemplateUse[] = [];
  let rackCursor = 0;
  spec.halls.forEach((hall, h) =>
    hall.rows.forEach((row, r) =>
      row.rackGroups.forEach((group, g) => {
        uses.push({ path: `halls[${h}].rows[${r}].rackGroups[${g}]`, template: group.template, hallIdx: h, rackIdx: rackCursor });
        rackCursor += group.count;
      }),
    ),
  );
  if (topo.nodes.length === 0) issues.add('error', 'NO_NODES', 'halls', 'The configuration contains no compute nodes');

  const rdhxCap = rdhxCapacityW();
  const checkedConfigs = new Set<string>();
  for (const use of uses) {
    const rack = topo.racks[use.rackIdx];
    if (!rack) continue;
    const cfg = topo.nodes[rack.nodeStart]?.cfg;
    if (cfg && !checkedConfigs.has(cfg.key)) {
      checkedConfigs.add(cfg.key);
      validateNodeConfig(cfg, use.path, topo, issues);
    }
    const tp = `${use.path}.template`;
    if (rack.usedU > rack.spec.rackUnits) {
      issues.add('error', 'RACK_SPACE_EXCEEDED', tp, `${rack.usedU}U required, ${rack.spec.name} provides ${rack.spec.rackUnits}U`, {
        usedU: rack.usedU,
      });
    }
    if (rack.weightKg > rack.spec.staticLoadKg.v) {
      issues.add(
        'error',
        'RACK_WEIGHT_EXCEEDED',
        tp,
        `Loaded rack weighs ${Math.round(rack.weightKg)} kg, static load rating is ${rack.spec.staticLoadKg.v} kg`,
      );
    }
    const pduUsableW = rack.pdu.perFeed * rack.pdu.spec.capacityKW.v * 1000;
    if (rack.designPeakW > pduUsableW) {
      issues.add(
        'error',
        'RACK_POWER_EXCEEDED',
        `${tp}.pdu`,
        `Rack peak ${kw(rack.designPeakW)} kW exceeds ${rack.pdu.feeds === 2 ? 'one feed (2N) of ' : ''}${rack.pdu.perFeed} × ${rack.pdu.spec.name} = ${kw(pduUsableW)} kW`,
        { peakKW: kw(rack.designPeakW), usableKW: kw(pduUsableW) },
      );
    } else if (rack.designPeakW > pduUsableW * 0.9) {
      issues.add('warning', 'RACK_POWER_HEADROOM_LOW', `${tp}.pdu`, `Rack peak uses ${pct(rack.designPeakW / pduUsableW)} % of usable PDU capacity`);
    }
    if (rack.pdu.feeds === 1) {
      issues.add('warning', 'RACK_SINGLE_FEED', `${tp}.pdu.feeds`, 'Single power feed: a feed or PDU failure takes the whole rack down');
    }
    if (rack.rackSystem) {
      const shelves = rack.rackSystem.powerShelves;
      const shelfW = rack.rackSystem.powerShelfKW.v * 1000;
      if (rack.designPeakW > shelves * shelfW) {
        issues.add('error', 'POWER_SHELF_CAPACITY', tp, `Rack peak ${kw(rack.designPeakW)} kW exceeds ${shelves} power shelves (${kw(shelves * shelfW)} kW)`);
      } else if (rack.designPeakW > (shelves / 2) * shelfW) {
        issues.add('warning', 'POWER_SHELF_REDUNDANCY', tp, `Power shelves are not N+N redundant at peak (${kw(rack.designPeakW)} kW)`);
      }
    }

    let liquidW = 0;
    for (let i = 0; i < rack.nodeCount; i++) {
      const c = topo.nodes[rack.nodeStart + i]!.cfg;
      liquidW += c.peakWallW * c.liquidHeatFractionAtPeak;
    }
    if (rack.rackSystem) liquidW += rack.auxPeakW * 0.85;
    const split = splitRackHeat(rack.cooling, rack.designPeakW, liquidW, rdhxCap);
    const airSideW = rack.designPeakW - liquidW;
    if (rack.cooling === 'air') {
      if (airSideW > AIR_RACK_MAX_KW * 1000) {
        issues.add(
          'error',
          'RACK_AIR_COOLING_LIMIT',
          `${tp}.cooling`,
          `${kw(airSideW)} kW per rack exceeds the ${AIR_RACK_MAX_KW} kW limit of room air cooling; use rear-door heat exchangers or direct liquid cooling`,
        );
      } else if (airSideW > AIR_RACK_CONTAINMENT_KW * 1000) {
        issues.add('warning', 'RACK_AIR_CONTAINMENT', `${tp}.cooling`, `${kw(airSideW)} kW per rack requires hot/cold aisle containment`);
      }
    } else if (rack.cooling === 'rdhx') {
      if (airSideW > rdhxCap) {
        issues.add(
          'error',
          'RDHX_CAPACITY_EXCEEDED',
          `${tp}.cooling`,
          `${kw(airSideW)} kW exceeds rear-door capacity (${kw(rdhxCap)} kW); ${kw(split.roomAirW)} kW spills into the room`,
        );
      }
    } else {
      if (!topo.halls[use.hallIdx]?.liquidUnit) {
        issues.add('error', 'LIQUID_LOOP_MISSING', `halls[${use.hallIdx}].liquid`, 'Direct liquid cooled racks require a CDU-fed technology cooling loop in the hall');
      }
      if (airSideW > DLC_RESIDUAL_AIR_MAX_KW * 1000) {
        issues.add('error', 'DLC_RESIDUAL_AIR_LIMIT', `${tp}.cooling`, `Residual air heat ${kw(airSideW)} kW per rack exceeds ${DLC_RESIDUAL_AIR_MAX_KW} kW`);
      }
    }
  }

  // ---- Fabric ----------------------------------------------------------------------------
  const plan = topo.fabric;
  if (plan.error) issues.add('error', 'FABRIC_TOO_LARGE', 'fabric', plan.error);
  if (spec.fabric.topology === 'none' && topo.nodes.length > 1) {
    issues.add('warning', 'FABRIC_NONE_MULTINODE', 'fabric.topology', 'No backend fabric: jobs are limited to a single node');
  }
  if (plan.tiers >= 2 && plan.oversubscription > 1.01) {
    issues.add(
      'warning',
      'FABRIC_OVERSUBSCRIBED',
      'fabric.oversubscription',
      `Leaf oversubscription ${plan.oversubscription.toFixed(2)}:1 throttles cross-leaf all-reduce traffic during training`,
    );
  }
  const rails = new Set(topo.nodes.map((n) => n.cfg.rails));
  if (rails.size > 1 && spec.fabric.topology === 'rail-optimized') {
    issues.add('info', 'FABRIC_MIXED_RAILS', 'fabric', `Nodes have different rail counts (${[...rails].join(', ')}); higher planes serve fewer nodes`);
  }

  // ---- Halls -----------------------------------------------------------------------------
  for (const hall of topo.halls) {
    let room = 0;
    let liquid = 0;
    for (const ri of hall.rackIdx) {
      const rack = topo.racks[ri]!;
      let rackLiquid = 0;
      for (let i = 0; i < rack.nodeCount; i++) {
        const c = topo.nodes[rack.nodeStart + i]!.cfg;
        rackLiquid += c.peakWallW * c.liquidHeatFractionAtPeak;
      }
      if (rack.rackSystem) rackLiquid += rack.auxPeakW * 0.85;
      const split = splitRackHeat(rack.cooling, rack.designPeakW, rackLiquid, rdhxCap);
      room += split.roomAirW;
      liquid += split.liquidW;
    }
    const hp = `halls[${hall.idx}]`;
    if (room > hall.airInstalledW) {
      issues.add('error', 'HALL_AIR_CAPACITY', `${hp}.air.count`, `${hall.name}: room air load ${kw(room)} kW exceeds installed ${kw(hall.airInstalledW)} kW`);
    } else if (room > hall.airUsableW) {
      issues.add(
        'warning',
        'HALL_AIR_REDUNDANCY',
        `${hp}.air.count`,
        `${hall.name}: room air load ${kw(room)} kW exceeds ${hall.spec.air.redundancy} usable capacity ${kw(hall.airUsableW)} kW`,
      );
    }
    if (liquid > 0) {
      if (liquid > hall.liquidInstalledW) {
        issues.add('error', 'HALL_LIQUID_CAPACITY', `${hp}.liquid.count`, `${hall.name}: liquid load ${kw(liquid)} kW exceeds installed CDU capacity ${kw(hall.liquidInstalledW)} kW`);
      } else if (liquid > hall.liquidUsableW) {
        issues.add('warning', 'HALL_LIQUID_REDUNDANCY', `${hp}.liquid.count`, `${hall.name}: liquid load ${kw(liquid)} kW exceeds redundant CDU capacity ${kw(hall.liquidUsableW)} kW`);
      }
    }
  }

  // ---- Plant -----------------------------------------------------------------------------
  const site = spec.site;
  const cool = metrics.cooling;
  const chilledLoadKW = cool.roomAirKW + cool.rdhxKW + (site.plant.dryCoolerId ? 0 : cool.liquidKW);
  const chiller = buildPlantParams(topo).chiller;
  const chillerInstalledKW = site.plant.chillers * chiller.capacityKW.v;
  if (chilledLoadKW > chillerInstalledKW) {
    issues.add('error', 'CHILLER_CAPACITY', 'site.plant.chillers', `Chilled-water load ${Math.round(chilledLoadKW)} kW exceeds installed chiller capacity ${Math.round(chillerInstalledKW)} kW`);
  } else if (chilledLoadKW > cool.chillerUsableKW) {
    issues.add('warning', 'CHILLER_REDUNDANCY', 'site.plant.chillers', `Chilled-water load ${Math.round(chilledLoadKW)} kW exceeds ${site.plant.chillerRedundancy} usable chiller capacity`);
  }
  if (site.plant.dryCoolerId && cool.liquidKW > 0) {
    const dc = tryPart('cooling', site.plant.dryCoolerId)!;
    const dcUsableKW = usableUnits('N+1', site.plant.dryCoolers) * dc.capacityKW.v;
    if (cool.liquidKW > site.plant.dryCoolers * dc.capacityKW.v) {
      issues.add('error', 'DRY_COOLER_CAPACITY', 'site.plant.dryCoolers', `Warm-water load ${Math.round(cool.liquidKW)} kW exceeds dry cooler capacity`);
    } else if (cool.liquidKW > dcUsableKW) {
      issues.add('warning', 'DRY_COOLER_REDUNDANCY', 'site.plant.dryCoolers', 'Dry coolers are not N+1 redundant at peak load');
    }
    if (metrics.power.designAmbientC > site.plant.warmWaterSupplyC - 1) {
      issues.add(
        'info',
        'WARM_WATER_CHILLER_ASSIST',
        'site.plant.warmWaterSupplyC',
        `At ${metrics.power.designAmbientC.toFixed(1)} °C design ambient the warm-water loop needs chiller assist`,
      );
    }
  } else if (cool.liquidKW > 0 && !site.plant.dryCoolerId) {
    issues.add('info', 'LIQUID_ON_CHILLERS', 'site.plant.dryCoolerId', 'Liquid loop heat is rejected through the chiller plant (no dry coolers)');
  }

  // ---- Electrical ------------------------------------------------------------------------
  const ups = tryPart('ups', site.ups.upsId)!;
  const upsUsableKW = usableUnits(site.ups.redundancy, site.ups.modules) * ups.moduleKW.v;
  const itKW = metrics.power.itPeakKW;
  if (itKW > site.ups.modules * ups.moduleKW.v) {
    issues.add('error', 'UPS_CAPACITY', 'site.ups.modules', `IT peak ${Math.round(itKW)} kW exceeds installed UPS capacity ${Math.round(site.ups.modules * ups.moduleKW.v)} kW`);
  } else if (itKW > upsUsableKW) {
    issues.add('warning', 'UPS_REDUNDANCY', 'site.ups.modules', `IT peak exceeds ${site.ups.redundancy} usable UPS capacity (${Math.round(upsUsableKW)} kW)`);
  }
  const facilityMW = metrics.power.facilityPeakKW / 1000;
  if (facilityMW > site.utility.feedMW) {
    issues.add(
      'error',
      'UTILITY_CAPACITY',
      'site.utility.feedMW',
      `Facility peak ${facilityMW.toFixed(2)} MW at ${metrics.power.designAmbientC.toFixed(1)} °C exceeds the ${site.utility.feedMW} MW utility feed`,
    );
  } else if (facilityMW > site.utility.feedMW * 0.9) {
    issues.add('warning', 'UTILITY_HEADROOM_LOW', 'site.utility.feedMW', `Facility peak uses ${pct(facilityMW / site.utility.feedMW)} % of the utility feed`);
  }
  const genUsableMW = usableUnits(site.generators.redundancy, site.generators.count) * site.generators.unitMW;
  if (facilityMW > genUsableMW) {
    issues.add('warning', 'GENERATOR_CAPACITY', 'site.generators.count', `Standby generation (${genUsableMW.toFixed(1)} MW usable) cannot carry the ${facilityMW.toFixed(2)} MW facility peak`);
  }

  // ---- Storage ---------------------------------------------------------------------------
  if (spec.storage.count === 0) {
    issues.add('warning', 'STORAGE_NONE', 'storage.count', 'No shared storage: checkpoints are written to local NVMe and are lost with the node');
  } else if (topo.gpuCount > 0) {
    const perGpu = metrics.storage.writeGBs / topo.gpuCount;
    if (perGpu < 0.1) {
      const ckptS = (70.6e9 * 14) / 1e9 / metrics.storage.writeGBs;
      issues.add(
        'warning',
        'STORAGE_WRITE_BANDWIDTH_LOW',
        'storage.count',
        `${(perGpu * 1000).toFixed(0)} MB/s write bandwidth per GPU — a full 70B checkpoint (~1 TB) takes ${Math.round(ckptS)} s`,
      );
    }
  }
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

export function validateInfra(spec: InfraSpec): ValidationReport {
  const issues = new IssueList();
  validateReferences(spec, issues);
  let topology: Topology | null = null;
  let metrics: DerivedMetrics | null = null;
  if (!issues.items.some((i) => i.severity === 'error')) {
    try {
      topology = expandTopology(spec);
      metrics = deriveMetrics(topology);
      validateTopology(spec, topology, metrics, issues);
    } catch (err) {
      issues.add('error', 'EXPANSION_FAILED', '', `Topology expansion failed: ${(err as Error).message}`);
      topology = null;
      metrics = null;
    }
  }
  const sorted = [...issues.items].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const errors = sorted.filter((i) => i.severity === 'error').length;
  return {
    ok: errors === 0,
    errors,
    warnings: sorted.filter((i) => i.severity === 'warning').length,
    issues: sorted,
    topology,
    metrics,
  };
}
