/**
 * Data center: design overview of the commissioned infrastructure, the live cooling and power
 * plant per hall, and the configuration (load a validated infrastructure template).
 */
import { Building2, Factory, LayoutTemplate, ShieldCheck, Snowflake, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { TEMPLATES, validateInfra, type HallSnapshot } from '../../engine';
import type { AppWindowProps } from '../../os/apps/registry';
import { useEngineStore } from '../../os/engine/store';
import { useT } from '../../os/i18n';
import { loadInfrastructure } from '../../os/kernel';
import { useNotificationStore } from '../../os/notifications/store';
import {
  Badge,
  Button,
  CardSelect,
  Dialog,
  KeyValue,
  Meter,
  StatusBadge,
  Table,
  fmt,
  type Column,
} from '../../ui';
import { AppBody, AppFrame, AppSidebar, AppSplit, EmptyState, Section } from '../common/AppLayout';
import { run } from '../common/shared';

type View = 'overview' | 'plant' | 'config';

function Overview() {
  const t = useT();
  const topo = useEngineStore((s) => s.topology);
  const [showIssues, setShowIssues] = useState(false);
  const report = useMemo(() => (topo ? validateInfra(topo.spec) : null), [topo]);
  const m = report?.metrics;
  if (!topo || !m || !report) return null;
  return (
    <>
      <div className="ap-hero">
        <div>
          <h2>{topo.spec.name}</h2>
          <p className="sf-muted">
            {topo.spec.site.name} · {topo.spec.site.city}, {topo.spec.site.country} · {topo.spec.site.code}
          </p>
        </div>
        <button type="button" className="ap-link" onClick={() => setShowIssues(true)}>
          {report.errors > 0 ? (
            <StatusBadge tone="critical" label={t('facility.errors', { n: report.errors })} />
          ) : report.warnings > 0 ? (
            <StatusBadge tone="warning" label={t('facility.warnings', { n: report.warnings })} />
          ) : (
            <StatusBadge tone="good" label={t('facility.validated')} />
          )}
        </button>
      </div>
      <div className="ap-grid-3">
        <Section title={t('facility.compute')}>
          <KeyValue
            items={[
              ['GPUs', `${fmt.formatNumber(m.counts.gpus)} × ${topo.nodes[0]?.gpuModel ?? ''}`],
              [
                t('facility.nodesRacks'),
                `${fmt.formatNumber(m.counts.nodes)} / ${fmt.formatNumber(m.counts.racks)}`,
              ],
              [t('facility.peakBf16'), `${fmt.formatNumber(m.compute.peakDense.bf16, 1, 1)} PFLOP/s`],
              [t('facility.peakFp8'), `${fmt.formatNumber(m.compute.peakDense.fp8, 1, 1)} PFLOP/s`],
              [
                'HBM',
                `${fmt.q(fmt.bytesGB(m.compute.hbmTB * 1000))} · ${fmt.formatNumber(m.compute.hbmBandwidthPBs, 1, 1)} PB/s`,
              ],
              [t('facility.scaleUp'), fmt.formatNumber(m.counts.scaleUpDomains)],
            ]}
          />
        </Section>
        <Section title={t('facility.fabricStorage')}>
          <KeyValue
            items={[
              [
                t('facility.topology'),
                t('facility.topologyValue', {
                  topology: m.network.topology,
                  tiers: m.network.tiers,
                  planes: m.network.planes,
                }),
              ],
              [
                t('facility.switches'),
                `${fmt.formatNumber(m.counts.switches)} × ${m.network.switchModel ?? '—'}`,
              ],
              [t('facility.bisection'), fmt.q(fmt.bandwidthGbps(m.network.bisectionTbps * 1000))],
              [
                t('facility.latency'),
                `${fmt.formatNumber(m.network.latencyUs.sameLeaf, 2, 2)} µs${m.network.latencyUs.viaSpine ? ` · ${fmt.formatNumber(m.network.latencyUs.viaSpine, 2, 2)} µs` : ''}`,
              ],
              [
                t('facility.storage'),
                `${fmt.formatNumber(m.storage.usablePB, 1, 1)} PB · ${fmt.formatNumber(m.storage.writeGBs, 0)} GB/s`,
              ],
            ]}
          />
        </Section>
        <Section title={t('facility.design')}>
          <KeyValue
            items={[
              [
                t('facility.itPeakIdle'),
                `${fmt.q(fmt.power(m.power.itPeakKW * 1000))} / ${fmt.q(fmt.power(m.power.itIdleKW * 1000))}`,
              ],
              [
                t('facility.facilityPeak'),
                `${fmt.q(fmt.power(m.power.facilityPeakKW * 1000))} @ ${fmt.temperature(m.power.designAmbientC)}`,
              ],
              [
                t('facility.pue'),
                `${fmt.formatNumber(m.power.pueAnnual, 3, 3)} / ${fmt.formatNumber(m.power.pueAtPeak, 3, 3)}`,
              ],
              [t('facility.maxRack'), fmt.q(fmt.power(m.power.maxRackKW * 1000))],
              [t('facility.capex'), fmt.currency(m.cost.totalUsd, 'USD')],
              [t('facility.energyYear'), fmt.currency(m.cost.energyEurPerYear)],
            ]}
          />
        </Section>
      </div>
      <Dialog
        open={showIssues}
        onClose={() => setShowIssues(false)}
        title={t('facility.validation')}
        description={topo.spec.name}
        width={720}
      >
        <div className="ap-issues">
          {report.issues.length === 0 && <p className="sf-muted">{t('facility.noFindings')}</p>}
          {report.issues.map((i, k) => (
            <div key={k} className="ap-issue">
              <Badge
                tone={i.severity === 'error' ? 'critical' : i.severity === 'warning' ? 'warning' : 'info'}
              >
                {i.severity}
              </Badge>
              <div>
                <div className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
                  {i.code} <span className="sf-muted">{i.path}</span>
                </div>
                <div>{i.message}</div>
              </div>
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}

function Plant() {
  const t = useT();
  const snap = useEngineStore((s) => s.snapshot);
  if (!snap) return null;
  const f = snap.facility;
  const halls = snap.halls.map((h, i) => ({ ...h, idx: i }));
  const columns: Column<HallSnapshot & { idx: number }>[] = [
    { id: 'name', header: t('facility.hall'), width: 'minmax(110px, 1fr)', cell: (h) => h.name },
    { id: 'it', header: 'IT', width: '80px', align: 'right', cell: (h) => fmt.q(fmt.power(h.itPowerW)) },
    {
      id: 'air',
      header: t('facility.airLoad'),
      width: '170px',
      cell: (h) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <div style={{ flex: 1 }}>
            <Meter value={h.airCapacityW > 0 ? h.roomAirHeatW / h.airCapacityW : 1} label={`${h.name}`} />
          </div>
          <span className="mono sf-muted" style={{ fontSize: 'var(--fs-2xs)' }}>
            {h.airUnitsHealthy}/{h.airUnitsInstalled}
          </span>
        </div>
      ),
    },
    {
      id: 'supply',
      header: t('facility.supplyAir'),
      width: '96px',
      align: 'right',
      cell: (h) => (
        <span
          style={{ color: h.supplyAirC > h.supplyAirSetpointC + 2 ? 'var(--status-warning)' : undefined }}
        >
          {fmt.temperature(h.supplyAirC)}
        </span>
      ),
    },
    {
      id: 'liquid',
      header: t('facility.coolant'),
      width: '120px',
      align: 'right',
      cell: (h) =>
        h.liquidSupplyC === null ? (
          <span className="sf-muted">—</span>
        ) : (
          <span>
            {fmt.temperature(h.liquidSupplyC)}{' '}
            <span className="sf-muted">
              {h.liquidUnitsHealthy}/{h.liquidUnitsInstalled}
            </span>
          </span>
        ),
    },
    {
      id: 'inject',
      header: '',
      width: '170px',
      cell: (h) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              void run({ type: 'fault.inject', target: { kind: 'cooling-unit', hall: h.idx, unit: 'air' } })
            }
          >
            {t('facility.failCrah')}
          </Button>
          {h.liquidSupplyC !== null && (
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                void run({
                  type: 'fault.inject',
                  target: { kind: 'cooling-unit', hall: h.idx, unit: 'liquid' },
                })
              }
            >
              {t('facility.failCdu')}
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      <div className="ap-kpis ap-kpis--compact">
        <div className="ap-figure">
          <span className="sf-label">{t('facility.ambient')}</span>
          <strong>{fmt.temperature(f.ambientC)}</strong>
        </div>
        <div className="ap-figure">
          <span className="sf-label">{t('facility.chw')}</span>
          <strong>{fmt.temperature(f.chilledWaterSupplyC)}</strong>
        </div>
        <div className="ap-figure">
          <span className="sf-label">{t('facility.cop')}</span>
          <strong>{fmt.formatNumber(f.chillerCop, 2, 2)}</strong>
        </div>
        <div className="ap-figure">
          <span className="sf-label">{t('facility.freeCooling')}</span>
          <strong>{fmt.percent(Math.max(f.freeCoolingChilled, f.freeCoolingWarm), 0)}</strong>
        </div>
        <div className="ap-figure">
          <span className="sf-label">PUE</span>
          <strong>{fmt.formatNumber(f.pue, 3, 3)}</strong>
        </div>
      </div>
      <Section
        title={t('facility.halls')}
        flush
        actions={
          <>
            <StatusBadge
              tone={f.chillersHealthy < f.chillersInstalled ? 'warning' : 'good'}
              label={t('facility.chillers', { healthy: f.chillersHealthy, installed: f.chillersInstalled })}
            />
            <Button
              size="sm"
              variant="danger"
              onClick={() => void run({ type: 'fault.inject', target: { kind: 'chiller' } })}
            >
              {t('facility.failChiller')}
            </Button>
            <Button
              size="sm"
              icon={<Wrench size={12} />}
              onClick={() => void run({ type: 'facility.repairAll' }, true)}
            >
              {t('facility.repairAll')}
            </Button>
          </>
        }
      >
        <div style={{ height: Math.min(8, halls.length) * 30 + 36 }}>
          <Table rows={halls} columns={columns} rowKey={(h) => h.id} label={t('facility.halls')} />
        </div>
      </Section>
    </>
  );
}

function Configuration() {
  const t = useT();
  const topo = useEngineStore((s) => s.topology);
  const [templateId, setTemplateId] = useState(topo?.spec.templateId ?? 'cluster-256');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const template = TEMPLATES.find((x) => x.id === templateId);

  const load = async () => {
    setBusy(true);
    try {
      const res = await loadInfrastructure(TEMPLATES.find((x) => x.id === templateId)!.build());
      if (!res.ok)
        useNotificationStore
          .getState()
          .push({ severity: 'error', title: t('facility.rejected'), body: res.message, source: 'kernel' });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <>
      <Section title={t('facility.templates')} description={t('facility.templates.desc')}>
        <CardSelect
          label={t('facility.templates')}
          value={templateId}
          columns={240}
          size="sm"
          onChange={setTemplateId}
          options={TEMPLATES.map((x) => ({
            value: x.id,
            title: x.name,
            icon: (
              <Badge tone="accent" outline>
                {x.tier}
              </Badge>
            ),
            description: x.summary,
          }))}
        />
        <div className="ap-row">
          <Button
            variant="primary"
            icon={<LayoutTemplate size={14} />}
            onClick={() => setConfirm(true)}
            loading={busy}
          >
            {t('facility.load')}
          </Button>
          <span className="sf-muted">{t('facility.loadHint')}</span>
        </div>
      </Section>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('facility.replaceTitle')}
        description={t('facility.replaceBody', { name: template?.name ?? '' })}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={busy} onClick={() => void load()}>
              {t('facility.load')}
            </Button>
          </>
        }
      />
    </>
  );
}

export function FacilityApp({ args }: AppWindowProps) {
  const t = useT();
  const topo = useEngineStore((s) => s.topology);
  const [view, setView] = useState<View>((args?.view as View) ?? 'overview');
  if (!topo) return <EmptyState icon={<Building2 size={28} />} title={t('app.waiting')} />;
  return (
    <AppFrame>
      <AppSplit>
        <AppSidebar<View>
          label={t('app.facility.title')}
          value={view}
          onChange={setView}
          items={[
            { id: 'overview', label: t('facility.view.overview'), icon: <ShieldCheck size={15} /> },
            { id: 'plant', label: t('facility.view.plant'), icon: <Snowflake size={15} /> },
            { id: 'config', label: t('facility.view.config'), icon: <Factory size={15} /> },
          ]}
        />
        <AppBody>
          {view === 'overview' ? <Overview /> : view === 'plant' ? <Plant /> : <Configuration />}
        </AppBody>
      </AppSplit>
    </AppFrame>
  );
}
