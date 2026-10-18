/**
 * Facility plant parameters and rack heat partitioning, derived from a topology.
 * Used identically by the design calculations (derive.ts) and the live simulation.
 */
import { part } from '../../catalog';
import type { FacilityPlantParams } from '../physics/facility';
import type { RackCooling } from './spec';
import type { Topology } from './topology';

/** One active rear door per RDHx rack. */
export const RDHX_UNIT_ID = 'rdhx-75';

export interface HeatSplit {
  roomAirW: number;
  rdhxW: number;
  liquidW: number;
}

/**
 * Splits rack heat into the share leaving through room air, captured by a rear-door heat
 * exchanger, and removed by direct liquid cooling. RDHx capture saturates at door capacity;
 * the excess spills into the room.
 */
export function splitRackHeat(
  cooling: RackCooling,
  totalW: number,
  liquidW: number,
  rdhxCapacityW: number,
): HeatSplit {
  const airSide = Math.max(0, totalW - liquidW);
  if (cooling === 'rdhx') {
    const captured = Math.min(airSide, rdhxCapacityW);
    return { roomAirW: airSide - captured, rdhxW: captured, liquidW };
  }
  return { roomAirW: airSide, rdhxW: 0, liquidW };
}

export function rdhxCapacityW(): number {
  return part('cooling', RDHX_UNIT_ID).capacityKW.v * 1000;
}

export function buildPlantParams(topo: Topology): FacilityPlantParams {
  const plant = topo.spec.site.plant;
  const chiller = part('cooling', plant.chillerId);
  const dryCooler = plant.dryCoolerId ? part('cooling', plant.dryCoolerId) : null;
  const rdhx = part('cooling', RDHX_UNIT_ID);

  let airCap = 0;
  let airPar = 0;
  let liqCap = 0;
  let liqPar = 0;
  for (const hall of topo.halls) {
    airCap += hall.airUnit.capacityKW.v;
    airPar += hall.airUnit.parasiticW.v;
    if (hall.liquidUnit) {
      liqCap += hall.liquidUnit.capacityKW.v;
      liqPar += hall.liquidUnit.parasiticW.v;
    }
  }
  const designItW = topo.racks.reduce((s, r) => s + r.designPeakW, 0);

  return {
    chiller,
    chilledWaterSupplyC: plant.chilledWaterSupplyC,
    warmWaterSupplyC: plant.warmWaterSupplyC,
    freeCooling: plant.freeCooling,
    dryCooler,
    airUnitParasitic: airCap > 0 ? airPar / (airCap * 1000) : 0.035,
    rdhxParasitic: rdhx.parasiticW.v / (rdhx.capacityKW.v * 1000),
    cduParasitic: liqCap > 0 ? liqPar / (liqCap * 1000) : 0.01,
    ups: part('ups', topo.spec.site.ups.upsId),
    upsModulesInstalled: topo.spec.site.ups.modules,
    // Lighting, security, BMS, offices (assumption: 0.4 % of design IT load, at least 2 kW).
    miscW: Math.max(2_000, designItW * 0.004),
  };
}
