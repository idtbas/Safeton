import { Building2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { TEMPLATES, validateInfra } from '../engine';
import { loadInfrastructure } from '../os/kernel';
import { useEngineStore } from '../os/engine/store';
import { useNotificationStore } from '../os/notifications/store';
import { Badge, Button, Dialog, KeyValue, Panel, Select, StatusBadge, fmt } from '../ui';

export function InfraPanel() {
  const topo = useEngineStore((s) => s.topology);
  const [templateId, setTemplateId] = useState(topo?.spec.templateId ?? 'cluster-256');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const report = useMemo(() => (topo ? validateInfra(topo.spec) : null), [topo]);
  const m = report?.metrics;
  const template = TEMPLATES.find((t) => t.id === templateId);

  const load = async () => {
    setBusy(true);
    try {
      const res = await loadInfrastructure(TEMPLATES.find((t) => t.id === templateId)!.build());
      if (!res.ok)
        useNotificationStore
          .getState()
          .push({ severity: 'error', title: 'Infrastructure rejected', body: res.message });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <Panel title="Infrastructure" icon={<Building2 size={14} />}>
      <div className="pv-stack">
        <Select
          label="Template"
          value={templateId}
          options={TEMPLATES.map((t) => ({ value: t.id, label: `${t.tier} — ${t.name}` }))}
          onChange={setTemplateId}
          hint={template?.summary}
        />
        <Button variant="primary" onClick={() => setConfirm(true)} loading={busy}>
          Load template
        </Button>
        {topo && m && report && (
          <>
            <div className="pv-infra-head">
              <div>
                <div style={{ fontWeight: 600 }}>{topo.spec.name}</div>
                <div className="sf-muted" style={{ fontSize: 'var(--fs-xs)' }}>
                  {topo.spec.site.name} · {topo.spec.site.city}, {topo.spec.site.country}
                </div>
              </div>
              <button type="button" className="pv-link" onClick={() => setShowIssues(true)}>
                {report.errors > 0 ? (
                  <StatusBadge tone="critical" label={`${report.errors} errors`} />
                ) : report.warnings > 0 ? (
                  <StatusBadge tone="warning" label={`${report.warnings} warnings`} />
                ) : (
                  <StatusBadge tone="good" label="Validated" />
                )}
              </button>
            </div>
            <div className="sf-label">Compute</div>
            <KeyValue
              items={[
                ['GPUs', `${fmt.formatNumber(m.counts.gpus)} × ${topo.nodes[0]?.gpuModel ?? ''}`],
                [
                  'Nodes / racks',
                  `${fmt.formatNumber(m.counts.nodes)} / ${fmt.formatNumber(m.counts.racks)}`,
                ],
                ['Peak BF16 (dense)', `${fmt.formatNumber(m.compute.peakDense.bf16, 1, 1)} PFLOP/s`],
                ['Peak FP8 (dense)', `${fmt.formatNumber(m.compute.peakDense.fp8, 1, 1)} PFLOP/s`],
                [
                  'HBM',
                  `${fmt.q(fmt.bytesGB(m.compute.hbmTB * 1000))} · ${fmt.formatNumber(m.compute.hbmBandwidthPBs, 1, 1)} PB/s`,
                ],
                ['Scale-up domains', fmt.formatNumber(m.counts.scaleUpDomains)],
              ]}
            />
            <div className="sf-label">Fabric & storage</div>
            <KeyValue
              items={[
                [
                  'Topology',
                  `${m.network.topology}, ${m.network.tiers}-tier, ${m.network.planes} plane${m.network.planes === 1 ? '' : 's'}`,
                ],
                ['Switches', `${fmt.formatNumber(m.counts.switches)} × ${m.network.switchModel ?? '—'}`],
                ['Bisection', `${fmt.q(fmt.bandwidthGbps(m.network.bisectionTbps * 1000))}`],
                [
                  'Latency',
                  `${fmt.formatNumber(m.network.latencyUs.sameLeaf, 2, 2)} µs leaf${m.network.latencyUs.viaSpine ? ` · ${fmt.formatNumber(m.network.latencyUs.viaSpine, 2, 2)} µs spine` : ''}`,
                ],
                [
                  'Shared storage',
                  `${fmt.formatNumber(m.storage.usablePB, 1, 1)} PB · ${fmt.formatNumber(m.storage.writeGBs, 0)} GB/s write`,
                ],
              ]}
            />
            <div className="sf-label">Facility (design)</div>
            <KeyValue
              items={[
                [
                  'IT peak / idle',
                  `${fmt.q(fmt.power(m.power.itPeakKW * 1000))} / ${fmt.q(fmt.power(m.power.itIdleKW * 1000))}`,
                ],
                [
                  'Facility peak',
                  `${fmt.q(fmt.power(m.power.facilityPeakKW * 1000))} @ ${fmt.formatNumber(m.power.designAmbientC, 1, 1)} °C`,
                ],
                [
                  'PUE annual / peak',
                  `${fmt.formatNumber(m.power.pueAnnual, 3, 3)} / ${fmt.formatNumber(m.power.pueAtPeak, 3, 3)}`,
                ],
                ['Max rack', fmt.q(fmt.power(m.power.maxRackKW * 1000))],
                ['CapEx (est.)', fmt.currency(m.cost.totalUsd, 'USD')],
                ['Energy / year', fmt.currency(m.cost.energyEurPerYear)],
              ]}
            />
          </>
        )}
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Replace running infrastructure?"
        description={`Loading “${template?.name}” discards the current simulation state (jobs, events, telemetry).`}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void load()}>
              Load {template?.name}
            </Button>
          </>
        }
      />
      <Dialog
        open={showIssues}
        onClose={() => setShowIssues(false)}
        title="Engineering validation"
        description={topo?.spec.name}
        width={720}
      >
        <div className="pv-issues">
          {report?.issues.length === 0 && <p className="sf-muted">No findings.</p>}
          {report?.issues.map((i, k) => (
            <div key={k} className="pv-issue">
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
    </Panel>
  );
}
