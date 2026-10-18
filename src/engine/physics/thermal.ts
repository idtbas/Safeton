/**
 * Lumped-capacitance thermal model (first-order RC network per device).
 *
 *   C · dT/dt = P − (T − T_ref) / R
 *
 * Solved exactly over a step of length dt (unconditionally stable for any dt):
 *
 *   T(t+dt) = T_ss + (T(t) − T_ss) · exp(−dt / (R·C)),   T_ss = T_ref + P·R
 */

export function steadyStateC(refC: number, powerW: number, rthKW: number): number {
  return refC + powerW * rthKW;
}

export function thermalStep(
  tempC: number,
  refC: number,
  powerW: number,
  rthKW: number,
  heatCapacityJK: number,
  dt: number,
): number {
  const tss = refC + powerW * rthKW;
  const tau = rthKW * heatCapacityJK;
  return tss + (tempC - tss) * Math.exp(-dt / tau);
}

/** Air-path thermal resistance grows as fan speed drops (convective coefficient ∝ airflow^0.8). */
export const AIR_MIN_DUTY = 0.25;
export function airResistance(rthFullKW: number, duty: number, fanHealthyFraction: number): number {
  const airflow = Math.max(0.05, duty * (0.35 + 0.65 * fanHealthyFraction));
  return rthFullKW * Math.pow(1 / airflow, 0.55);
}

/** Cold-plate resistance vs. coolant flow fraction. */
export function liquidResistance(rthFullKW: number, flowFraction: number): number {
  return rthFullKW * Math.pow(1 / Math.max(0.05, flowFraction), 0.4);
}

/** Firmware fan curve: duty target from the hottest monitored component. */
export const FAN_CURVE_LOW_C = 45;
export const FAN_CURVE_HIGH_C = 78;
export function fanTargetDuty(hottestC: number, minDuty = AIR_MIN_DUTY): number {
  const x = (hottestC - FAN_CURVE_LOW_C) / (FAN_CURVE_HIGH_C - FAN_CURVE_LOW_C);
  return Math.min(1, Math.max(minDuty, minDuty + x * (1 - minDuty)));
}
/** Fan duty slew rate (fraction per second). */
export const FAN_SLEW_PER_S = 0.08;

/**
 * Clock reduction once the slowdown threshold is crossed. Linear from 100 % at the slowdown
 * temperature to 45 % at the shutdown temperature.
 */
export function thermalClock(tempC: number, slowdownC: number, shutdownC: number): number {
  if (tempC <= slowdownC) return 1;
  const x = (tempC - slowdownC) / Math.max(1, shutdownC - slowdownC);
  return Math.max(0.45, 1 - 0.55 * x);
}
