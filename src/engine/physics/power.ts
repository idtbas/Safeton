/**
 * Electrical power models shared by the static design calculations and the live simulation.
 * See docs/SIMULATION-MODEL.md §2 for the derivation and the provenance of each constant.
 */
import { interpolateCurve, type PsuSpec } from '../../catalog';

/** Dynamic power scales with f·V²; with V ≈ f^0.7 in the DVFS range this gives P_dyn ∝ f^2.4. */
export const DVFS_EXPONENT = 2.4;
/** Static (leakage) power rises ~0.4 %/K relative to a 40 °C reference. */
export const LEAKAGE_PER_K = 0.004;
/** Lowest clock fraction the firmware will drop to before declaring a hardware slowdown floor. */
export const MIN_CLOCK = 0.3;

export function leakageFactor(tempC: number): number {
  return Math.max(0.85, 1 + LEAKAGE_PER_K * (tempC - 40));
}

/**
 * Instantaneous GPU board power.
 * @param activity fraction of full-load switching activity (utilisation × workload intensity)
 * @param clock    fraction of maximum boost clock actually achieved
 */
export function gpuPowerW(idleW: number, tdpW: number, activity: number, clock: number, tempC: number): number {
  const pStatic = idleW * leakageFactor(tempC);
  if (activity === 0) return pStatic;
  const scale = clock === 1 ? 1 : Math.pow(clock, DVFS_EXPONENT);
  return pStatic + (tdpW - idleW) * activity * scale;
}

/** Highest clock fraction that keeps the GPU at or below `limitW` for the given activity. */
export function powerLimitedClock(
  idleW: number,
  tdpW: number,
  activity: number,
  tempC: number,
  limitW: number,
): number {
  const dynFull = (tdpW - idleW) * activity;
  if (dynFull <= 0) return 1;
  const available = limitW - idleW * leakageFactor(tempC);
  if (available >= dynFull) return 1;
  if (available <= 0) return MIN_CLOCK;
  return Math.max(MIN_CLOCK, Math.pow(available / dynFull, 1 / DVFS_EXPONENT));
}

export function linearPower(idleW: number, maxW: number, load: number): number {
  return idleW + (maxW - idleW) * load;
}

/** Fan affinity law: power ∝ speed³. */
export function fanPowerW(maxW: number, duty: number): number {
  return maxW * duty * duty * duty;
}

/** Wall power drawn by a set of load-sharing PSUs delivering `dcW`. */
export function psuInputW(psu: PsuSpec, dcW: number, activePsus: number): number {
  if (dcW <= 0 || activePsus <= 0) return 0;
  const loadFraction = dcW / (activePsus * psu.ratedW.v);
  const eff = interpolateCurve(psu.efficiencyCurve, Math.min(1, loadFraction));
  return dcW / eff;
}
