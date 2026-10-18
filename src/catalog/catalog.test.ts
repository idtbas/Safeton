import { describe, expect, it } from 'vitest';
import { CATALOG, allCatalogItems, interpolateCurve, part, tryPart, type Q } from './index';

function quantities(obj: unknown, path = ''): [string, Q][] {
  if (!obj || typeof obj !== 'object') return [];
  if ('v' in obj && 'src' in obj) return [[path, obj as Q]];
  return Object.entries(obj).flatMap(([k, v]) => quantities(v, path ? `${path}.${k}` : k));
}

describe('hardware catalog', () => {
  it('has unique ids across all kinds', () => {
    const ids = allCatalogItems().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags every quantity with a valid provenance and a finite, non-negative value', () => {
    for (const item of allCatalogItems()) {
      for (const [path, q] of quantities(item)) {
        expect(['vendor', 'estimate', 'assumption'], `${item.id}.${path}`).toContain(q.src);
        expect(Number.isFinite(q.v) && q.v >= 0, `${item.id}.${path} = ${q.v}`).toBe(true);
      }
    }
  });

  it('keeps sparse peaks at exactly 2× dense (2:4 structured sparsity)', () => {
    for (const gpu of CATALOG.gpus) {
      for (const key of ['tf32', 'bf16', 'fp16', 'fp8', 'fp4', 'int8'] as const) {
        const p = gpu.peak[key];
        if (p?.sparse) expect(p.sparse.v / p.dense.v, `${gpu.id} ${key}`).toBeCloseTo(2, 2);
      }
    }
  });

  it('orders GPU generations by BF16 throughput and memory bandwidth', () => {
    const bf16 = (id: string) => part('gpu', id).peak.bf16.dense.v;
    expect(bf16('nvidia-a100-sxm4-80gb')).toBeLessThan(bf16('nvidia-h100-sxm5-80gb'));
    expect(bf16('nvidia-h100-sxm5-80gb')).toBeLessThan(bf16('nvidia-b200-sxm6-180gb'));
    expect(part('gpu', 'nvidia-h200-sxm5-141gb').memory.bandwidthGBs.v).toBeGreaterThan(
      part('gpu', 'nvidia-h100-sxm5-80gb').memory.bandwidthGBs.v,
    );
  });

  it('defines consistent thermal limits and power ranges for GPUs', () => {
    for (const g of CATALOG.gpus) {
      expect(g.thermal.slowdownC.v).toBeLessThan(g.thermal.shutdownC.v);
      expect(g.power.idleW.v).toBeLessThan(g.power.tdpW.v);
      expect(g.power.minPowerLimitW.v).toBeLessThan(g.power.tdpW.v);
      expect(g.thermal.air ?? g.thermal.liquid).not.toBeNull();
      expect(g.kernelEfficiency.v).toBeGreaterThan(0.3);
      expect(g.kernelEfficiency.v).toBeLessThan(0.8);
    }
  });

  it('builds every platform and rack system from existing parts', () => {
    for (const p of CATALOG.platforms) {
      expect(part('gpu', p.gpu.id)).toBeTruthy();
      expect(part('cpu', p.cpu.id)).toBeTruthy();
      if (p.dimm) expect(part('dimm', p.dimm.id)).toBeTruthy();
      expect(part('nvme', p.dataDrive.id)).toBeTruthy();
      expect(part('nic', p.computeNic.id)).toBeTruthy();
      expect(part('psu', p.psu.id)).toBeTruthy();
      if (p.nvswitch) expect(part('nvswitch', p.nvswitch.id)).toBeTruthy();
      if (p.superchip) expect(part('superchip', p.superchip.id)).toBeTruthy();
      expect(p.cooling).toContain(p.defaultCooling);
      expect(p.psuRequired).toBeLessThanOrEqual(p.psu.count);
    }
    for (const r of CATALOG.rackSystems) {
      expect(part('platform', r.trayPlatformId).class).toBe('rack-scale-tray');
      expect(part('rack', r.rackId)).toBeTruthy();
    }
  });

  it('rejects lookups of the wrong kind', () => {
    expect(() => part('cpu', 'nvidia-h100-sxm5-80gb')).toThrow(/expected cpu/);
    expect(() => part('gpu', 'does-not-exist')).toThrow(/Unknown/);
    expect(tryPart('gpu', 'intel-xeon-8480c')).toBeUndefined();
  });

  it('interpolates efficiency curves and clamps outside the range', () => {
    const curve = part('psu', 'psu-crps-3300-titanium').efficiencyCurve;
    expect(interpolateCurve(curve, 0.5)).toBeCloseTo(0.962, 3);
    expect(interpolateCurve(curve, 0.35)).toBeGreaterThan(0.94);
    expect(interpolateCurve(curve, 0.35)).toBeLessThan(0.962);
    expect(interpolateCurve(curve, 2)).toBe(curve[curve.length - 1]![1]);
  });

  it('meets 80 PLUS Titanium minimum efficiencies (10/20/50/100 %)', () => {
    const c = part('psu', 'psu-crps-3300-titanium').efficiencyCurve;
    expect(interpolateCurve(c, 0.1)).toBeGreaterThanOrEqual(0.9);
    expect(interpolateCurve(c, 0.2)).toBeGreaterThanOrEqual(0.94);
    expect(interpolateCurve(c, 0.5)).toBeGreaterThanOrEqual(0.96);
    expect(interpolateCurve(c, 1)).toBeGreaterThanOrEqual(0.91);
  });
});
