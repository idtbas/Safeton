/**
 * Setup steps 6–9: infrastructure profile, hardware, network and site & plant. All values feed
 * `designInfrastructure`; the facility plant is sized from the IT design and validated live.
 */
import { Building2, Network, Server, Snowflake, Wind } from 'lucide-react';
import type { ReactNode } from 'react';
import { CATALOG, part, tryPart } from '../../../catalog';
import {
  CLIMATE_PRESETS,
  TEMPLATES,
  validateInfra,
  type DerivedMetrics,
  type DesignInput,
  type FabricTopology,
  type NodeOverrides,
  type RackCooling,
  type RackSystemRef,
} from '../../../engine';
import type { MessageKey } from '../../../os/i18n';
import { Badge, Button, ButtonGroup, CardSelect, KeyValue, NumberInput, Select, fmt } from '../../../ui';
import type { StepProps } from '../types';

type Design = DesignInput;
const setDesign = (props: StepProps, fn: (d: Design) => Design) =>
  props.update((data) => ({ ...data, infra: { ...data.infra, design: fn(data.infra.design) } }));

const pw = (w: number) => fmt.q(fmt.power(w));

// ---- 6 Profile -------------------------------------------------------------------------------

let profileMetrics: Map<string, DerivedMetrics | null> | null = null;
function templateMetrics(id: string): DerivedMetrics | null {
  profileMetrics ??= new Map();
  if (!profileMetrics.has(id)) {
    const tpl = TEMPLATES.find((x) => x.id === id);
    profileMetrics.set(id, tpl ? validateInfra(tpl.build()).metrics : null);
  }
  return profileMetrics.get(id) ?? null;
}

export function ProfileStep({ data, dispatch, t }: StepProps) {
  return (
    <div className="sh-form">
      <p className="sf-secondary">{t('setup.profile.lead')}</p>
      <CardSelect
        label={t('setup.step.profile.title')}
        value={data.infra.templateId}
        columns={250}
        onChange={(templateId) => dispatch({ type: 'selectTemplate', templateId })}
        options={TEMPLATES.map((tpl) => {
          const m = templateMetrics(tpl.id);
          return {
            value: tpl.id,
            title: tpl.name,
            icon: (
              <Badge tone="accent" outline>
                {tpl.tier}
              </Badge>
            ),
            description: tpl.summary,
            meta: m && (
              <dl className="sh-card-metrics">
                <div>
                  <dt>{t('setup.profile.gpus')}</dt>
                  <dd>{fmt.formatNumber(m.counts.gpus)}</dd>
                </div>
                <div>
                  <dt>{t('setup.profile.nodes')}</dt>
                  <dd>{fmt.formatNumber(m.counts.nodes)}</dd>
                </div>
                <div>
                  <dt>{t('setup.profile.itPeak')}</dt>
                  <dd>{pw(m.power.itPeakKW * 1000)}</dd>
                </div>
                <div>
                  <dt>{t('setup.profile.bf16')}</dt>
                  <dd>{fmt.q(fmt.flops(m.compute.peakDense.bf16 * 1e15))}</dd>
                </div>
                <div>
                  <dt>{t('setup.profile.pue')}</dt>
                  <dd>{fmt.formatNumber(m.power.pueAnnual, 2, 2)}</dd>
                </div>
                <div>
                  <dt>{t('setup.profile.capex')}</dt>
                  <dd>{fmt.currency(m.cost.totalUsd, 'USD')}</dd>
                </div>
              </dl>
            ),
          };
        })}
      />
    </div>
  );
}

// ---- 7 Hardware ------------------------------------------------------------------------------

const systemKey = (s: RackSystemRef) =>
  s.kind === 'platform' ? `platform:${s.platformId}` : `rack-system:${s.rackSystemId}`;

function coolingOptionsFor(system: RackSystemRef): RackCooling[] {
  if (system.kind === 'rack-system') return ['dlc'];
  const p = tryPart('platform', system.platformId);
  if (!p) return ['air', 'rdhx', 'dlc'];
  const opts: RackCooling[] = [];
  if (p.cooling.includes('air')) opts.push('air', 'rdhx');
  if (p.cooling.includes('liquid')) opts.push('dlc');
  return opts;
}

function selectSystem(d: Design, key: string): Design {
  const [kind, id] = key.split(':') as ['platform' | 'rack-system', string];
  if (kind === 'rack-system') {
    const rs = part('rack-system', id);
    return {
      ...d,
      compute: {
        ...d.compute,
        system: { kind: 'rack-system', rackSystemId: id },
        cooling: 'dlc',
        rackId: rs.rackId,
      },
    };
  }
  const p = part('platform', id);
  const prev = d.compute.system;
  const nodesPerRack = prev.kind === 'platform' ? prev.nodesPerRack : 4;
  const allowed = coolingOptionsFor({ kind: 'platform', platformId: id, nodesPerRack });
  const cooling = allowed.includes(d.compute.cooling)
    ? d.compute.cooling
    : p.defaultCooling === 'liquid'
      ? 'dlc'
      : 'air';
  const rackId = d.compute.rackId === 'rack-48u-mgx-liquid' ? 'rack-48u-800' : d.compute.rackId;
  return {
    ...d,
    compute: {
      ...d.compute,
      system: { kind: 'platform', platformId: id, nodesPerRack },
      cooling,
      rackId: tryPart('rack', rackId) ? rackId : 'rack-48u-800',
    },
  };
}

function setOverride(d: Design, patch: Partial<NodeOverrides>): Design {
  const sys = d.compute.system;
  return { ...d, compute: { ...d.compute, system: { ...sys, overrides: { ...sys.overrides, ...patch } } } };
}

const COOLING_ICON: Record<RackCooling, ReactNode> = {
  air: <Wind size={14} />,
  rdhx: <Server size={14} />,
  dlc: <Snowflake size={14} />,
};

export function HardwareStep(props: StepProps) {
  const { data, t, err, design } = props;
  const d = data.infra.design;
  const sys = d.compute.system;
  const platform =
    sys.kind === 'platform'
      ? tryPart('platform', sys.platformId)
      : tryPart('platform', tryPart('rack-system', sys.rackSystemId)?.trayPlatformId ?? '');
  const gpu = platform ? part('gpu', platform.gpu.id) : null;
  const cpu = platform ? part('cpu', platform.cpu.id) : null;
  const cfg = design.report.topology?.configs[0];
  const m = design.report.metrics;
  const o = sys.overrides ?? {};
  const allowed = coolingOptionsFor(sys);
  const set = (fn: (d: Design) => Design) => setDesign(props, fn);

  const systemOptions = [
    ...CATALOG.platforms
      .filter((p) => p.class === 'server')
      .map((p) => ({
        value: `platform:${p.id}`,
        label: `${p.name} — ${p.gpu.count} × ${part('gpu', p.gpu.id).name}`,
      })),
    ...CATALOG.rackSystems.map((r) => ({
      value: `rack-system:${r.id}`,
      label: `${r.name} — ${r.reference}`,
    })),
  ];

  return (
    <div className="sh-form">
      <fieldset className="sh-fieldset">
        <legend>{t('setup.hardware.system')}</legend>
        <Select
          label={t('setup.hardware.platform')}
          value={systemKey(sys)}
          options={systemOptions}
          onChange={(key) => set((x) => selectSystem(x, key))}
        />
        {platform && gpu && cpu && (
          <div className="sh-facts">
            <span>
              <span className="sf-muted">{t('setup.hardware.gpu')}</span> {platform.gpu.count} × {gpu.name} ·{' '}
              {gpu.memory.capacityGB.v} GB {gpu.memory.type} · {gpu.power.tdpW.v} W
            </span>
            <span>
              <span className="sf-muted">{t('setup.hardware.cpu')}</span> {platform.cpu.count} × {cpu.name} (
              {cpu.cores}C)
            </span>
          </div>
        )}
        <div className="sh-grid3">
          {sys.kind === 'platform' && (
            <NumberInput
              label={t('setup.hardware.nodesPerRack')}
              value={sys.nodesPerRack}
              min={1}
              max={16}
              error={err('hardware.nodesPerRack')}
              increaseLabel={t('ui.number.increase')}
              decreaseLabel={t('ui.number.decrease')}
              onChange={(n) =>
                set((x) => ({ ...x, compute: { ...x.compute, system: { ...sys, nodesPerRack: n } } }))
              }
            />
          )}
          <NumberInput
            label={t('setup.hardware.racks')}
            value={d.compute.racks}
            min={1}
            max={4096}
            error={err('hardware.racks')}
            increaseLabel={t('ui.number.increase')}
            decreaseLabel={t('ui.number.decrease')}
            onChange={(racks) => set((x) => ({ ...x, compute: { ...x.compute, racks } }))}
          />
          <NumberInput
            label={t('setup.hardware.halls')}
            value={d.halls}
            min={1}
            max={16}
            error={err('hardware.halls')}
            increaseLabel={t('ui.number.increase')}
            decreaseLabel={t('ui.number.decrease')}
            onChange={(halls) => set((x) => ({ ...x, halls }))}
          />
          <NumberInput
            label={t('setup.hardware.racksPerRow')}
            value={d.racksPerRow}
            min={1}
            max={64}
            error={err('hardware.racksPerRow')}
            increaseLabel={t('ui.number.increase')}
            decreaseLabel={t('ui.number.decrease')}
            onChange={(racksPerRow) => set((x) => ({ ...x, racksPerRow }))}
          />
        </div>
      </fieldset>

      <fieldset className="sh-fieldset">
        <legend>{t('setup.hardware.cooling')}</legend>
        <CardSelect
          label={t('setup.hardware.cooling')}
          value={d.compute.cooling}
          size="sm"
          columns={200}
          onChange={(cooling) => set((x) => ({ ...x, compute: { ...x.compute, cooling } }))}
          options={(['air', 'rdhx', 'dlc'] as RackCooling[]).map((c) => ({
            value: c,
            icon: COOLING_ICON[c],
            title: t(`setup.hardware.cooling.${c}` as MessageKey),
            description: t(`setup.hardware.cooling.${c}.desc` as MessageKey),
            disabled: !allowed.includes(c),
            disabledReason: t('setup.hardware.unsupported'),
          }))}
        />
      </fieldset>

      <fieldset className="sh-fieldset">
        <legend>{t('setup.hardware.power')}</legend>
        <div className="sh-grid2">
          <Select
            label={t('setup.hardware.rack')}
            value={d.compute.rackId}
            options={CATALOG.racks.map((r) => ({ value: r.id, label: r.name }))}
            disabled={sys.kind === 'rack-system'}
            onChange={(rackId) => set((x) => ({ ...x, compute: { ...x.compute, rackId } }))}
          />
          <Select
            label={t('setup.hardware.pdu')}
            value={d.compute.pdu.pduId}
            options={CATALOG.pdus.map((p) => ({
              value: p.id,
              label: `${p.name} (${fmt.formatNumber(p.capacityKW.v, 1, 1)} kW)`,
            }))}
            onChange={(pduId) =>
              set((x) => ({ ...x, compute: { ...x.compute, pdu: { ...x.compute.pdu, pduId } } }))
            }
          />
        </div>
        <div className="sh-grid2">
          <NumberInput
            label={t('setup.hardware.pduPerFeed')}
            value={d.compute.pdu.perFeed}
            min={1}
            max={8}
            error={err('hardware.pduPerFeed')}
            increaseLabel={t('ui.number.increase')}
            decreaseLabel={t('ui.number.decrease')}
            onChange={(perFeed) =>
              set((x) => ({ ...x, compute: { ...x.compute, pdu: { ...x.compute.pdu, perFeed } } }))
            }
          />
          <div className="sf-field">
            <span className="sf-label">{t('setup.hardware.feeds')}</span>
            <ButtonGroup label={t('setup.hardware.feeds')}>
              {([1, 2] as const).map((feeds) => (
                <Button
                  key={feeds}
                  pressed={d.compute.pdu.feeds === feeds}
                  onClick={() =>
                    set((x) => ({ ...x, compute: { ...x.compute, pdu: { ...x.compute.pdu, feeds } } }))
                  }
                >
                  {t(feeds === 1 ? 'setup.hardware.feeds1' : 'setup.hardware.feeds2')}
                </Button>
              ))}
            </ButtonGroup>
          </div>
        </div>
      </fieldset>

      {platform && gpu && sys.kind === 'platform' && (
        <fieldset className="sh-fieldset">
          <legend>{t('setup.hardware.node')}</legend>
          <div className="sh-grid2">
            <NumberInput
              label={t('setup.hardware.gpuPowerLimit')}
              value={o.gpuPowerLimitW ?? gpu.power.tdpW.v}
              min={gpu.power.minPowerLimitW.v}
              max={gpu.power.tdpW.v}
              step={25}
              unit="W"
              error={err('hardware.gpuPowerLimitW')}
              increaseLabel={t('ui.number.increase')}
              decreaseLabel={t('ui.number.decrease')}
              onChange={(w) => set((x) => setOverride(x, { gpuPowerLimitW: w }))}
            />
            <NumberInput
              label={t('setup.hardware.psuCount')}
              value={o.psuCount ?? platform.psu.count}
              min={1}
              max={12}
              error={err('hardware.psuCount')}
              hint={cfg ? `${t('setup.hardware.psuRequired')}: ${cfg.psuRequired}` : undefined}
              increaseLabel={t('ui.number.increase')}
              decreaseLabel={t('ui.number.decrease')}
              onChange={(psuCount) => set((x) => setOverride(x, { psuCount }))}
            />
            {platform.dimm && (
              <NumberInput
                label={t('setup.hardware.dimmCount')}
                value={o.dimmCount ?? platform.dimm.count}
                min={0}
                max={platform.dimmSlots}
                error={err('hardware.dimmCount')}
                hint={part('dimm', o.dimmId ?? platform.dimm.id).name}
                increaseLabel={t('ui.number.increase')}
                decreaseLabel={t('ui.number.decrease')}
                onChange={(dimmCount) => set((x) => setOverride(x, { dimmCount }))}
              />
            )}
            <NumberInput
              label={t('setup.hardware.drives')}
              value={o.dataDriveCount ?? platform.dataDrive.count}
              min={0}
              max={platform.dataDriveBays}
              error={err('hardware.dataDriveCount')}
              hint={part('nvme', o.dataDriveId ?? platform.dataDrive.id).name}
              increaseLabel={t('ui.number.increase')}
              decreaseLabel={t('ui.number.decrease')}
              onChange={(dataDriveCount) => set((x) => setOverride(x, { dataDriveCount }))}
            />
          </div>
        </fieldset>
      )}

      {m && cfg && (
        <section className="sh-derived" aria-label={t('setup.hardware.derived')}>
          <span className="sf-label">{t('setup.hardware.derived')}</span>
          <KeyValue
            items={[
              [t('setup.hardware.totalGpus'), fmt.formatNumber(m.counts.gpus)],
              [t('setup.hardware.nodePeak'), pw(cfg.peakWallW)],
              [t('setup.hardware.rackPeak'), pw(m.power.maxRackKW * 1000)],
              [t('setup.hardware.psuRequired'), `${cfg.psuRequired} / ${cfg.psuCount}`],
              [t('setup.hardware.hostMemory'), `${fmt.formatNumber(cfg.hostMemoryGB)} GB`],
            ]}
          />
        </section>
      )}
    </div>
  );
}

// ---- 8 Network -------------------------------------------------------------------------------

export function NetworkStep(props: StepProps) {
  const { data, t, err, design } = props;
  const d = data.infra.design;
  const sys = d.compute.system;
  const net = design.report.metrics?.network;
  const counts = design.report.metrics?.counts;
  const platform =
    sys.kind === 'platform'
      ? tryPart('platform', sys.platformId)
      : tryPart('platform', tryPart('rack-system', sys.rackSystemId)?.trayPlatformId ?? '');
  const set = (fn: (d: Design) => Design) => setDesign(props, fn);
  const nicId = sys.overrides?.computeNicId ?? platform?.computeNic.id ?? '';
  return (
    <div className="sh-form">
      <div className="sf-field">
        <span className="sf-label">{t('setup.network.topology')}</span>
        <CardSelect
          label={t('setup.network.topology')}
          value={d.fabric.topology}
          size="sm"
          columns={200}
          onChange={(topology: FabricTopology) => set((x) => ({ ...x, fabric: { ...x.fabric, topology } }))}
          options={(['rail-optimized', 'fat-tree', 'none'] as FabricTopology[]).map((f) => ({
            value: f,
            icon: <Network size={14} />,
            title: t(`setup.network.topology.${f}` as MessageKey),
            description: t(`setup.network.topology.${f}.desc` as MessageKey),
          }))}
        />
      </div>
      {d.fabric.topology !== 'none' && (
        <>
          <div className="sh-grid2">
            <Select
              label={t('setup.network.switch')}
              value={d.fabric.switchId}
              options={CATALOG.switches.map((s) => ({
                value: s.id,
                label: `${s.name} — ${s.ports} × ${s.portSpeedGbps} Gb/s ${s.fabric}`,
              }))}
              onChange={(switchId) => set((x) => ({ ...x, fabric: { ...x.fabric, switchId } }))}
            />
            <Select
              label={t('setup.network.nic')}
              value={nicId}
              options={CATALOG.nics
                .filter((n) => n.class !== 'DPU')
                .map((n) => ({ value: n.id, label: `${n.name} — ${n.portSpeedGbps} Gb/s` }))}
              onChange={(computeNicId) => set((x) => setOverride(x, { computeNicId }))}
            />
          </div>
          <NumberInput
            label={t('setup.network.oversubscription')}
            value={d.fabric.oversubscription}
            min={1}
            max={8}
            step={0.5}
            unit=": 1"
            width={200}
            hint={t('setup.network.oversubscriptionHint')}
            error={err('network.oversubscription')}
            increaseLabel={t('ui.number.increase')}
            decreaseLabel={t('ui.number.decrease')}
            onChange={(oversubscription) => set((x) => ({ ...x, fabric: { ...x.fabric, oversubscription } }))}
          />
        </>
      )}
      {net && counts && (
        <section className="sh-derived" aria-label={t('setup.network.result')}>
          <span className="sf-label">{t('setup.network.result')}</span>
          <KeyValue
            items={[
              [t('setup.network.tiers'), `${net.tiers} / ${net.planes}`],
              [t('setup.network.switches'), fmt.formatNumber(counts.switches)],
              [t('setup.network.links'), fmt.formatNumber(counts.links)],
              [t('setup.network.bisection'), `${fmt.formatNumber(net.bisectionTbps, 1, 1)} Tb/s`],
              [t('setup.network.injection'), `${fmt.formatNumber(net.injectionTbps, 1, 1)} Tb/s`],
              [
                t('setup.network.latency'),
                `${fmt.formatNumber(net.latencyUs.sameLeaf, 2, 2)} / ${fmt.formatNumber(net.latencyUs.viaSpine, 2, 2)} µs`,
              ],
            ]}
          />
        </section>
      )}
    </div>
  );
}

// ---- 9 Site & plant --------------------------------------------------------------------------

export function SiteStep(props: StepProps) {
  const { data, t, err, design } = props;
  const d = data.infra.design;
  const spec = design.report.topology?.spec;
  const m = design.report.metrics;
  const set = (fn: (d: Design) => Design) => setDesign(props, fn);
  const setClimate = (patch: Partial<Design['site']['climate']>) =>
    props.update((x) => ({
      ...x,
      infra: {
        ...x.infra,
        climateId: 'custom',
        design: {
          ...x.infra.design,
          site: { ...x.infra.design.site, climate: { ...x.infra.design.site.climate, ...patch } },
        },
      },
    }));
  return (
    <div className="sh-form">
      <div className="sf-field">
        <span className="sf-label">{t('setup.site.climate')}</span>
        <CardSelect
          label={t('setup.site.climate')}
          value={data.infra.climateId}
          size="sm"
          columns={150}
          onChange={(climateId) => {
            const p = CLIMATE_PRESETS.find((c) => c.id === climateId);
            if (!p) return;
            props.update((x) => ({
              ...x,
              infra: {
                ...x.infra,
                climateId,
                design: {
                  ...x.infra.design,
                  site: {
                    ...x.infra.design.site,
                    city: p.city,
                    country: p.country,
                    climate: { ...p.climate },
                    energyPriceEurPerKWh: p.energyPriceEurPerKWh,
                  },
                },
              },
            }));
          }}
          options={[
            ...CLIMATE_PRESETS.map((c) => ({
              value: c.id,
              icon: <Building2 size={13} />,
              title: c.city,
              description: `${c.country} · Ø ${fmt.temperature(c.climate.annualMeanC)} · ${fmt.formatNumber(c.energyPriceEurPerKWh, 2, 2)} €/kWh`,
            })),
            { value: 'custom', title: t('common.custom'), disabled: data.infra.climateId !== 'custom' },
          ]}
        />
      </div>
      <div className="sh-grid3">
        <NumberInput
          label={t('setup.site.annualMean')}
          value={d.site.climate.annualMeanC}
          min={-20}
          max={35}
          step={0.5}
          unit="°C"
          increaseLabel={t('ui.number.increase')}
          decreaseLabel={t('ui.number.decrease')}
          onChange={(annualMeanC) => setClimate({ annualMeanC })}
        />
        <NumberInput
          label={t('setup.site.seasonal')}
          value={d.site.climate.seasonalAmplitudeC}
          min={0}
          max={25}
          step={0.5}
          unit="K"
          increaseLabel={t('ui.number.increase')}
          decreaseLabel={t('ui.number.decrease')}
          onChange={(seasonalAmplitudeC) => setClimate({ seasonalAmplitudeC })}
        />
        <NumberInput
          label={t('setup.site.diurnal')}
          value={d.site.climate.diurnalAmplitudeC}
          min={0}
          max={15}
          step={0.5}
          unit="K"
          increaseLabel={t('ui.number.increase')}
          decreaseLabel={t('ui.number.decrease')}
          onChange={(diurnalAmplitudeC) => setClimate({ diurnalAmplitudeC })}
        />
      </div>
      <div className="sh-grid3">
        <NumberInput
          label={t('setup.site.energyPrice')}
          value={d.site.energyPriceEurPerKWh}
          min={0}
          max={2}
          step={0.01}
          unit="€/kWh"
          error={err('site.energyPrice')}
          increaseLabel={t('ui.number.increase')}
          decreaseLabel={t('ui.number.decrease')}
          onChange={(energyPriceEurPerKWh) =>
            set((x) => ({ ...x, site: { ...x.site, energyPriceEurPerKWh } }))
          }
        />
        <NumberInput
          label={t('setup.site.airSupply')}
          value={d.airSupplyC ?? 24}
          min={18}
          max={27}
          step={0.5}
          unit="°C"
          error={err('site.airSupplyC')}
          increaseLabel={t('ui.number.increase')}
          decreaseLabel={t('ui.number.decrease')}
          onChange={(airSupplyC) => set((x) => ({ ...x, airSupplyC }))}
        />
        <NumberInput
          label={t('setup.site.warmWater')}
          value={d.warmWaterSupplyC ?? 32}
          min={25}
          max={40}
          step={0.5}
          unit="°C"
          disabled={d.compute.cooling !== 'dlc'}
          error={err('site.warmWaterSupplyC')}
          increaseLabel={t('ui.number.increase')}
          decreaseLabel={t('ui.number.decrease')}
          onChange={(warmWaterSupplyC) => set((x) => ({ ...x, warmWaterSupplyC }))}
        />
      </div>
      <fieldset className="sh-fieldset">
        <legend>{t('setup.site.storage')}</legend>
        <div className="sh-grid2">
          <Select
            label={t('setup.site.storageSystem')}
            value={d.storage.systemId}
            options={CATALOG.storage.map((s) => ({ value: s.id, label: `${s.name} — ${s.usableTB.v} TB` }))}
            onChange={(systemId) => set((x) => ({ ...x, storage: { ...x.storage, systemId } }))}
          />
          <NumberInput
            label={t('setup.site.storageCount')}
            value={d.storage.count}
            min={0}
            max={512}
            error={err('site.storageCount')}
            increaseLabel={t('ui.number.increase')}
            decreaseLabel={t('ui.number.decrease')}
            onChange={(count) => set((x) => ({ ...x, storage: { ...x.storage, count } }))}
          />
        </div>
      </fieldset>
      {spec && m && (
        <section className="sh-derived" aria-label={t('setup.site.plant')}>
          <span className="sf-label">{t('setup.site.plant')}</span>
          <KeyValue
            items={[
              [
                t('setup.site.chillers'),
                `${spec.site.plant.chillers} × ${part('cooling', spec.site.plant.chillerId).name} (${spec.site.plant.chillerRedundancy})`,
              ],
              [
                t('setup.site.dryCoolers'),
                spec.site.plant.dryCoolerId
                  ? `${spec.site.plant.dryCoolers} × ${part('cooling', spec.site.plant.dryCoolerId).name}`
                  : t('common.none'),
              ],
              [
                t('setup.site.ups'),
                `${spec.site.ups.modules} × ${part('ups', spec.site.ups.upsId).moduleKW.v} kW (${spec.site.ups.redundancy})`,
              ],
              [
                t('setup.site.generators'),
                `${spec.site.generators.count} × ${spec.site.generators.unitMW} MW (${spec.site.generators.redundancy})`,
              ],
              [t('setup.site.utility'), `${spec.site.utility.feeds} × ${spec.site.utility.feedMW} MW`],
              [t('setup.site.designAmbient'), fmt.temperature(m.power.designAmbientC)],
              [
                t('setup.site.pueAnnual'),
                `${fmt.formatNumber(m.power.pueAnnual, 2, 2)} / ${fmt.formatNumber(m.power.pueAtPeak, 2, 2)}`,
              ],
              [t('setup.site.energyYear'), fmt.currency(m.cost.energyEurPerYear)],
            ]}
          />
        </section>
      )}
    </div>
  );
}
