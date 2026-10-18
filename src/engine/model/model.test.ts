import { describe, expect, it } from 'vitest';
import { part } from '../../catalog';
import { planFabric } from './fabric';
import { resolveNodeConfig } from './resolve';
import type { InfraSpec } from './spec';
import { TEMPLATES, buildTemplate } from './templates';
import { expandTopology } from './topology';
import { validateInfra } from './validate';

const codes = (spec: InfraSpec) => validateInfra(spec).issues.map((i) => `${i.severity}:${i.code}`);

function mutate(id: string, fn: (s: InfraSpec) => void): InfraSpec {
  const spec = structuredClone(buildTemplate(id));
  fn(spec);
  return spec;
}

describe('templates', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s validates without errors', (id) => {
    const report = validateInfra(buildTemplate(id));
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('produces the advertised GPU counts', () => {
    const gpus = (id: string) => expandTopology(buildTemplate(id)).gpuCount;
    expect(gpus('single-server')).toBe(8);
    expect(gpus('gpu-rack')).toBe(32);
    expect(gpus('cluster-256')).toBe(256);
    expect(gpus('enterprise-4096')).toBe(4096);
    expect(gpus('supercomputer-nvl72')).toBe(4608);
    expect(gpus('hyperscale-32k')).toBe(32768);
  });

  it('expands deterministically', () => {
    const a = expandTopology(buildTemplate('enterprise-4096'));
    const b = expandTopology(buildTemplate('enterprise-4096'));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.racks.map((r) => r.inletOffsetC)).toEqual(b.racks.map((r) => r.inletOffsetC));
  });
});

describe('bottom-up power model', () => {
  it.each(['hgx-a100-8gpu', 'hgx-h100-8gpu', 'hgx-h200-8gpu', 'hgx-b200-8gpu', 'mi300x-8gpu', 'mi325x-8gpu'])(
    '%s peak is within 10 % of the published maximum system power',
    (platformId) => {
      const p = part('platform', platformId);
      const cfg = resolveNodeConfig({
        rackId: 'rack-48u-800',
        cooling: 'air',
        system: { kind: 'platform', platformId, nodesPerRack: 1 },
        pdu: { pduId: 'pdu-3ph-415v-60a', perFeed: 1, feeds: 2 },
      });
      expect(cfg.peakWallW / p.maxPowerW.v).toBeGreaterThan(0.9);
      expect(cfg.peakWallW / p.maxPowerW.v).toBeLessThan(1.05);
      expect(cfg.idleWallW).toBeLessThan(cfg.peakWallW * 0.35);
    },
  );

  it('derives PSU requirements from the load, not from a constant', () => {
    const h100 = resolveNodeConfig({
      rackId: 'rack-48u-800',
      cooling: 'air',
      system: { kind: 'platform', platformId: 'hgx-h100-8gpu', nodesPerRack: 1 },
      pdu: { pduId: 'pdu-3ph-415v-60a', perFeed: 1, feeds: 2 },
    });
    const capped = resolveNodeConfig({
      rackId: 'rack-48u-800',
      cooling: 'air',
      system: {
        kind: 'platform',
        platformId: 'hgx-h100-8gpu',
        nodesPerRack: 1,
        overrides: { gpuPowerLimitW: 400 },
      },
      pdu: { pduId: 'pdu-3ph-415v-60a', perFeed: 1, feeds: 2 },
    });
    expect(capped.peakDcW).toBeLessThan(h100.peakDcW - 2000);
    expect(capped.psuRequired).toBeLessThanOrEqual(h100.psuRequired);
  });

  it('moves GPU and CPU heat into the liquid loop for DLC nodes', () => {
    const dlc = resolveNodeConfig({
      rackId: 'rack-48u-800',
      cooling: 'dlc',
      system: { kind: 'platform', platformId: 'hgx-b200-8gpu', nodesPerRack: 4 },
      pdu: { pduId: 'pdu-3ph-415v-60a', perFeed: 2, feeds: 2 },
    });
    expect(dlc.liquidHeatFractionAtPeak).toBeGreaterThan(0.7);
    expect(dlc.liquidHeatFractionAtPeak).toBeLessThan(0.9);
  });
});

describe('fabric planning', () => {
  const qm9700 = part('switch', 'nvidia-qm9700');
  const q3400 = part('switch', 'nvidia-q3400');

  it('uses a single switch when endpoints fit the radix', () => {
    expect(planFabric('rail-optimized', qm9700, 1, 8, 32).tiers).toBe(1);
  });

  it('builds a non-blocking two-tier fat tree', () => {
    const p = planFabric('rail-optimized', qm9700, 1, 8, 512);
    expect(p.tiers).toBe(2);
    expect(p.downPorts).toBe(32);
    expect(p.leavesPerPlane).toBe(16);
    expect(p.spinesPerPlane).toBe(8);
    expect(p.oversubscription).toBe(1);
  });

  it('switches to three tiers past radix²/2 endpoints', () => {
    const p = planFabric('rail-optimized', qm9700, 1, 8, 4096);
    expect(p.tiers).toBe(3);
    expect(p.error).toBeNull();
    expect(planFabric('rail-optimized', q3400, 1, 8, 4096).tiers).toBe(2);
  });

  it('reports oversubscription and capacity overflow', () => {
    expect(planFabric('rail-optimized', qm9700, 2, 8, 2000).oversubscription).toBeGreaterThan(1.5);
    expect(planFabric('rail-optimized', qm9700, 1, 1, 64 * 64 * 64).error).toMatch(/3-tier/);
  });
});

describe('validation rules', () => {
  it('rejects unknown catalog references', () => {
    expect(codes(mutate('cluster-256', (s) => (s.fabric.switchId = 'nope')))).toContain(
      'error:CATALOG_REF_UNKNOWN',
    );
  });

  it('detects rack power above PDU capacity', () => {
    const c = codes(
      mutate(
        'cluster-256',
        (s) =>
          (s.halls[0]!.rows[0]!.rackGroups[0]!.template.pdu = {
            pduId: 'pdu-3ph-415v-32a',
            perFeed: 1,
            feeds: 2,
          }),
      ),
    );
    expect(c).toContain('error:RACK_POWER_EXCEEDED');
  });

  it('requires liquid cooling for dense racks and liquid-only platforms', () => {
    // 4 × HGX B200 ≈ 53 kW per rack exceeds the 40 kW limit of room air.
    const air = codes(
      mutate('hyperscale-32k', (s) => (s.halls[0]!.rows[0]!.rackGroups[0]!.template.cooling = 'air')),
    );
    expect(air).toContain('error:RACK_AIR_COOLING_LIMIT');
    const contained = codes(
      mutate('cluster-256', (s) => (s.halls[0]!.rows[0]!.rackGroups[0]!.template.cooling = 'air')),
    );
    expect(contained).toContain('warning:RACK_AIR_CONTAINMENT');
    const nvl = codes(
      mutate('supercomputer-nvl72', (s) => (s.halls[0]!.rows[0]!.rackGroups[0]!.template.cooling = 'rdhx')),
    );
    expect(nvl).toContain('error:PLATFORM_COOLING_UNSUPPORTED');
  });

  it('checks rack space and weight', () => {
    const c = codes(
      mutate('cluster-256', (s) => {
        const t = s.halls[0]!.rows[0]!.rackGroups[0]!.template;
        if (t.system.kind === 'platform') t.system.nodesPerRack = 7;
        t.pdu = { pduId: 'pdu-3ph-415v-125a', perFeed: 1, feeds: 2 };
      }),
    );
    expect(c).toContain('error:RACK_SPACE_EXCEEDED');
  });

  it('checks PSU redundancy and DIMM population', () => {
    const c = codes(
      mutate('cluster-256', (s) => {
        const t = s.halls[0]!.rows[0]!.rackGroups[0]!.template;
        if (t.system.kind === 'platform')
          t.system.overrides = { psuCount: 2, dimmCount: 40, dimmId: 'ddr4-3200-64gb' };
      }),
    );
    expect(c).toContain('error:PSU_INSUFFICIENT');
    expect(c).toContain('error:DIMM_SLOTS_EXCEEDED');
    expect(c).toContain('error:DIMM_TYPE_MISMATCH');
  });

  it('flags oversubscribed fabrics and missing liquid loops', () => {
    expect(codes(mutate('enterprise-4096', (s) => (s.fabric.oversubscription = 2)))).toContain(
      'warning:FABRIC_OVERSUBSCRIBED',
    );
    expect(codes(mutate('hyperscale-32k', (s) => (s.halls[0]!.liquid = null)))).toContain(
      'error:LIQUID_LOOP_MISSING',
    );
  });

  it('checks hall cooling, UPS and utility capacity', () => {
    const c = codes(
      mutate('enterprise-4096', (s) => {
        s.site.ups.modules = 2;
        s.site.utility.feedMW = 1;
        s.site.plant.chillers = 1;
      }),
    );
    expect(c).toContain('error:UPS_CAPACITY');
    expect(c).toContain('error:UTILITY_CAPACITY');
    expect(c).toContain('error:CHILLER_CAPACITY');
  });

  it('warns about missing shared storage', () => {
    expect(codes(mutate('cluster-256', (s) => (s.storage.count = 0)))).toContain('warning:STORAGE_NONE');
  });
});
