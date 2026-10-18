/**
 * Facility (mechanical + electrical overhead) power model. Produces the non-IT power that,
 * together with IT power, defines PUE. Shared between design-time estimates and the
 * running simulation so both always agree.
 */
import { interpolateCurve, type CoolingUnitSpec, type UpsSpec } from '../../catalog';

export interface FacilityPlantParams {
  chiller: CoolingUnitSpec;
  chilledWaterSupplyC: number;
  warmWaterSupplyC: number;
  freeCooling: boolean;
  dryCooler: CoolingUnitSpec | null;
  /** Parasitic fraction of the air-side units (CRAH / in-row) — W per W of heat. */
  airUnitParasitic: number;
  /** Parasitic fraction of rear-door heat exchangers. */
  rdhxParasitic: number;
  /** Parasitic fraction of CDUs (pump power). */
  cduParasitic: number;
  ups: UpsSpec;
  upsModulesInstalled: number;
  /** Constant site load: lighting, security, controls, offices (W). */
  miscW: number;
}

export interface FacilityLoads {
  itW: number;
  /** Heat removed by room air units (CRAH / in-row). */
  roomAirHeatW: number;
  /** Heat captured by rear-door heat exchangers (chilled water). */
  rdhxHeatW: number;
  /** Heat captured by direct liquid cooling (warm-water loop). */
  liquidHeatW: number;
  ambientC: number;
}

export interface FacilityPower {
  chillerW: number;
  airUnitFanW: number;
  rdhxFanW: number;
  cduPumpW: number;
  dryCoolerW: number;
  coolingW: number;
  upsLossW: number;
  distributionLossW: number;
  miscW: number;
  facilityW: number;
  pue: number;
  chillerCop: number;
  /** 0..1 share of chilled-water load handled by free cooling (economiser). */
  freeCoolingChilled: number;
  /** 0..1 share of warm-water load handled by dry coolers without chiller assist. */
  freeCoolingWarm: number;
}

/** Waterside economiser approach temperatures (assumptions). */
const CHW_FULL_FREE_APPROACH_K = 8;
const CHW_PARTIAL_FREE_APPROACH_K = 2;
const WW_FULL_FREE_APPROACH_K = 6;
const WW_PARTIAL_FREE_APPROACH_K = 1;
/** Electrical distribution losses (transformers, switchgear, cabling). */
const DIST_LOSS_IT = 0.012;
const DIST_LOSS_MECH = 0.01;

export function chillerCop(chiller: CoolingUnitSpec, ambientC: number): number {
  const c35 = chiller.copAt35C?.v ?? 3;
  const c15 = chiller.copAt15C?.v ?? 5;
  const cop = c15 + ((c35 - c15) * (ambientC - 15)) / 20;
  return Math.min(c15 * 1.25, Math.max(c35 * 0.75, cop));
}

function economiserFraction(ambientC: number, supplyC: number, fullK: number, partialK: number): number {
  const full = supplyC - fullK;
  const none = supplyC - partialK;
  if (ambientC <= full) return 1;
  if (ambientC >= none) return 0;
  return (none - ambientC) / (none - full);
}

export function facilityPower(plant: FacilityPlantParams, loads: FacilityLoads): FacilityPower {
  const { itW, roomAirHeatW, rdhxHeatW, liquidHeatW, ambientC } = loads;
  const cop = chillerCop(plant.chiller, ambientC);

  const freeChw = plant.freeCooling
    ? economiserFraction(ambientC, plant.chilledWaterSupplyC, CHW_FULL_FREE_APPROACH_K, CHW_PARTIAL_FREE_APPROACH_K)
    : 0;
  const freeWw = plant.dryCooler
    ? economiserFraction(ambientC, plant.warmWaterSupplyC, WW_FULL_FREE_APPROACH_K, WW_PARTIAL_FREE_APPROACH_K)
    : 0;

  const chilledLoad = roomAirHeatW + rdhxHeatW;
  // Warm-water loops without a dry cooler are rejected through the chiller plant via a
  // heat exchanger; the warmer return improves chiller COP (assumption: +30 %).
  const liquidOnChiller = liquidHeatW * (1 - freeWw);
  const chillerW = (chilledLoad * (1 - freeChw)) / cop + liquidOnChiller / (cop * 1.3);
  // Economiser pumps / fans still run when chillers are bypassed (assumption: 2 % of the load).
  const economiserW = chilledLoad * freeChw * 0.02;

  const airUnitFanW = roomAirHeatW * plant.airUnitParasitic;
  const rdhxFanW = rdhxHeatW * plant.rdhxParasitic;
  const cduPumpW = liquidHeatW * plant.cduParasitic;
  const dryCoolerW = plant.dryCooler
    ? liquidHeatW *
      (plant.dryCooler.parasiticW.v / (plant.dryCooler.capacityKW.v * 1000)) *
      (0.5 + 0.5 * Math.min(1, Math.max(0, (ambientC - 5) / 25)))
    : 0;

  const coolingW = chillerW + economiserW + airUnitFanW + rdhxFanW + cduPumpW + dryCoolerW;

  const upsCapacityW = plant.upsModulesInstalled * plant.ups.moduleKW.v * 1000;
  const upsLoad = upsCapacityW > 0 ? Math.min(1, itW / upsCapacityW) : 1;
  const upsEff = interpolateCurve(plant.ups.efficiencyCurve, upsLoad);
  const upsLossW = itW > 0 ? itW / upsEff - itW : 0;

  const distributionLossW = (itW + upsLossW) * DIST_LOSS_IT + coolingW * DIST_LOSS_MECH;
  const facilityW = itW + coolingW + upsLossW + distributionLossW + plant.miscW;

  return {
    chillerW: chillerW + economiserW,
    airUnitFanW,
    rdhxFanW,
    cduPumpW,
    dryCoolerW,
    coolingW,
    upsLossW,
    distributionLossW,
    miscW: plant.miscW,
    facilityW,
    pue: itW > 0 ? facilityW / itW : 0,
    chillerCop: cop,
    freeCoolingChilled: freeChw,
    freeCoolingWarm: freeWw,
  };
}

/** Outdoor dry-bulb temperature from a simple seasonal + diurnal climate model. */
export function ambientTemperatureC(
  climate: { annualMeanC: number; seasonalAmplitudeC: number; diurnalAmplitudeC: number },
  epochMs: number,
): number {
  const date = new Date(epochMs);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (epochMs - start) / 86_400_000;
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // Seasonal maximum around day 200 (mid-July), diurnal maximum around 15:00 local solar time.
  const seasonal = climate.seasonalAmplitudeC * Math.cos((2 * Math.PI * (dayOfYear - 200)) / 365);
  const diurnal = climate.diurnalAmplitudeC * Math.cos((2 * Math.PI * (hour - 15)) / 24);
  return climate.annualMeanC + seasonal + diurnal;
}
