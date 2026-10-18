import { describe, expect, it } from 'vitest';
import { part } from '../../catalog';
import { ambientTemperatureC, chillerCop, facilityPower, type FacilityPlantParams } from './facility';
import { gpuPowerW, powerLimitedClock, psuInputW } from './power';
import { airResistance, fanTargetDuty, steadyStateC, thermalClock, thermalStep } from './thermal';

describe('thermal model', () => {
  it('converges to the analytic steady state T_ref + P·R', () => {
    let T = 30;
    for (let i = 0; i < 2000; i++) T = thermalStep(T, 25, 700, 0.072, 560, 1);
    expect(T).toBeCloseTo(steadyStateC(25, 700, 0.072), 6);
    expect(T).toBeCloseTo(75.4, 1);
  });

  it('reaches 63.2 % of the step response after one time constant (τ = R·C)', () => {
    const R = 0.072;
    const C = 560;
    const tau = R * C;
    const T = thermalStep(25, 25, 700, R, C, tau);
    expect((T - 25) / (700 * R)).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it('is stable for any step length', () => {
    const T = thermalStep(90, 25, 0, 0.05, 100, 1e6);
    expect(T).toBeCloseTo(25, 6);
  });

  it('raises thermal resistance when airflow drops', () => {
    expect(airResistance(0.07, 0.25, 1)).toBeGreaterThan(airResistance(0.07, 1, 1) * 2);
    expect(airResistance(0.07, 1, 0.5)).toBeGreaterThan(airResistance(0.07, 1, 1));
  });

  it('follows the fan curve and throttles above slowdown', () => {
    expect(fanTargetDuty(30)).toBeCloseTo(0.25);
    expect(fanTargetDuty(90)).toBe(1);
    expect(thermalClock(80, 87, 92)).toBe(1);
    expect(thermalClock(90, 87, 92)).toBeLessThan(1);
    expect(thermalClock(120, 87, 92)).toBe(0.45);
  });
});

describe('power model', () => {
  it('draws idle power at zero activity and TDP-scale power at full activity', () => {
    expect(gpuPowerW(70, 700, 0, 1, 40)).toBeCloseTo(70, 6);
    expect(gpuPowerW(70, 700, 1, 1, 40)).toBeCloseTo(700, 6);
  });

  it('reduces clock just enough to respect a power limit', () => {
    const clock = powerLimitedClock(70, 700, 1, 70, 500);
    expect(clock).toBeLessThan(1);
    expect(gpuPowerW(70, 700, 1, clock, 70)).toBeCloseTo(500, 3);
    expect(powerLimitedClock(70, 700, 0.3, 50, 700)).toBe(1);
  });

  it('accounts for leakage growing with temperature', () => {
    expect(gpuPowerW(70, 700, 0, 1, 80)).toBeGreaterThan(gpuPowerW(70, 700, 0, 1, 40));
  });

  it('converts DC load to wall power through the PSU efficiency curve', () => {
    const psu = part('psu', 'psu-crps-3300-titanium');
    const wall = psuInputW(psu, 9000, 6);
    expect(wall).toBeGreaterThan(9000);
    expect(9000 / wall).toBeGreaterThan(0.93);
    // Light load across six PSUs is less efficient than heavier load.
    expect(1000 / psuInputW(psu, 1000, 6)).toBeLessThan(9000 / wall);
  });
});

describe('facility model', () => {
  const plant: FacilityPlantParams = {
    chiller: part('cooling', 'chiller-air-1000'),
    chilledWaterSupplyC: 18,
    warmWaterSupplyC: 32,
    freeCooling: true,
    dryCooler: part('cooling', 'drycooler-1200'),
    airUnitParasitic: 5500 / 150_000,
    rdhxParasitic: 1000 / 75_000,
    cduParasitic: 12_000 / 1_350_000,
    ups: part('ups', 'ups-modular-250'),
    upsModulesInstalled: 24,
    miscW: 20_000,
  };

  it('balances energy: facility power = IT + cooling + UPS + distribution + misc', () => {
    const p = facilityPower(plant, {
      itW: 5e6,
      roomAirHeatW: 1e6,
      rdhxHeatW: 3e6,
      liquidHeatW: 1e6,
      ambientC: 25,
    });
    expect(p.facilityW).toBeCloseTo(5e6 + p.coolingW + p.upsLossW + p.distributionLossW + p.miscW, 3);
    expect(p.pue).toBeCloseTo(p.facilityW / 5e6, 9);
  });

  it('produces realistic PUE: air-cooled worse than liquid-cooled, hot worse than cold', () => {
    const air = facilityPower(plant, {
      itW: 5e6,
      roomAirHeatW: 5e6,
      rdhxHeatW: 0,
      liquidHeatW: 0,
      ambientC: 30,
    });
    const liquid = facilityPower(plant, {
      itW: 5e6,
      roomAirHeatW: 0.9e6,
      rdhxHeatW: 0,
      liquidHeatW: 4.1e6,
      ambientC: 30,
    });
    const cold = facilityPower(plant, {
      itW: 5e6,
      roomAirHeatW: 5e6,
      rdhxHeatW: 0,
      liquidHeatW: 0,
      ambientC: 5,
    });
    expect(air.pue).toBeGreaterThan(1.25);
    expect(air.pue).toBeLessThan(1.6);
    expect(liquid.pue).toBeLessThan(air.pue);
    expect(liquid.pue).toBeGreaterThan(1.05);
    expect(cold.pue).toBeLessThan(air.pue);
    expect(cold.freeCoolingChilled).toBe(1);
  });

  it('degrades chiller COP with ambient temperature', () => {
    const ch = part('cooling', 'chiller-air-1000');
    expect(chillerCop(ch, 35)).toBeLessThan(chillerCop(ch, 15));
    expect(chillerCop(ch, 35)).toBeCloseTo(ch.copAt35C!.v, 6);
  });

  it('models seasonal and diurnal ambient swings', () => {
    const climate = { annualMeanC: 10, seasonalAmplitudeC: 10, diurnalAmplitudeC: 5 };
    const julyAfternoon = ambientTemperatureC(climate, Date.UTC(2026, 6, 19, 15));
    const januaryNight = ambientTemperatureC(climate, Date.UTC(2026, 0, 15, 3));
    expect(julyAfternoon).toBeGreaterThan(22);
    expect(januaryNight).toBeLessThan(-2);
  });
});
