import { useEffect, useState } from 'react';
import type { GpuDetail, NodeDetail } from '../engine';
import { query } from '../os/kernel';
import { Badge, Dialog, KeyValue, Sparkline, StatusBadge, Table, fmt, type Column } from '../ui';
import { NODE_STATE_LABEL, NODE_STATE_TONE } from './shared';

export function NodeDetailDialog({
  node,
  open,
  onClose,
}: {
  node: number;
  open: boolean;
  onClose: () => void;
}) {
  const [d, setD] = useState<NodeDetail | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () =>
      query({ type: 'node.detail', node }).then(
        (r) => alive && setD(r),
        () => undefined,
      );
    void load();
    const t = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [node, open]);

  const gpuCols: Column<GpuDetail>[] = [
    { id: 'idx', header: 'GPU', width: '44px', cell: (g) => <span className="mono">{g.index}</span> },
    {
      id: 'health',
      header: 'Health',
      width: '120px',
      cell: (g) => (
        <StatusBadge
          tone={g.health === 'ok' ? 'good' : g.health === 'degraded' ? 'warning' : 'critical'}
          label={g.health}
        />
      ),
    },
    { id: 'util', header: 'Util', width: '56px', align: 'right', cell: (g) => fmt.percent(g.util, 0) },
    {
      id: 'mem',
      header: 'Memory',
      width: '108px',
      align: 'right',
      cell: (g) => `${fmt.formatNumber(g.memUsedGB, 1, 1)} / ${g.memTotalGB} GB`,
    },
    {
      id: 'power',
      header: 'Power',
      width: '110px',
      align: 'right',
      cell: (g) => `${fmt.formatNumber(g.powerW, 0, 0)} / ${fmt.formatNumber(g.powerLimitW, 0, 0)} W`,
    },
    { id: 'temp', header: 'Temp', width: '72px', align: 'right', cell: (g) => fmt.temperature(g.tempC) },
    { id: 'hbm', header: 'HBM', width: '72px', align: 'right', cell: (g) => fmt.temperature(g.hbmTempC) },
    { id: 'clock', header: 'SM clock', width: '96px', align: 'right', cell: (g) => `${g.clockMHz} MHz` },
    {
      id: 'thr',
      header: 'Throttle',
      width: 'minmax(120px, 1fr)',
      cell: (g) =>
        g.throttle.length ? (
          <span style={{ color: 'var(--status-warning)' }}>{g.throttle.join(', ')}</span>
        ) : (
          <span className="sf-muted">none</span>
        ),
    },
    {
      id: 'ecc',
      header: 'ECC c/u',
      width: '72px',
      align: 'right',
      cell: (g) => `${g.eccCorrected}/${g.eccUncorrected}`,
    },
    {
      id: 'xid',
      header: 'Last Xid',
      width: '64px',
      align: 'right',
      cell: (g) => (g.lastXid ? <Badge tone="serious">{g.lastXid}</Badge> : '—'),
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={d ? d.hostname : 'Node'}
      description={d ? `${d.reference} · ${d.rack} · ${d.hall} · U${d.slotU}` : undefined}
      width={1040}
    >
      {d && (
        <div className="pv-detail">
          <div className="pv-detail__summary">
            <StatusBadge tone={NODE_STATE_TONE[d.state]} label={NODE_STATE_LABEL[d.state]} />
            {d.faults.map((f) => (
              <Badge key={f} tone="warning">
                {f}
              </Badge>
            ))}
            {d.job !== null && <Badge tone="accent">job {d.job}</Badge>}
            <span className="sf-muted mono" style={{ marginLeft: 'auto' }}>
              uptime {fmt.duration(d.uptimeS)}
            </span>
          </div>
          <div className="pv-detail__grid">
            <KeyValue
              items={[
                ['Wall power', fmt.q(fmt.power(d.powerW))],
                [
                  'GPU / other / PSU loss',
                  `${fmt.q(fmt.power(d.powerBreakdown.gpu ?? 0))} / ${fmt.q(fmt.power(d.powerBreakdown.rest ?? 0))} / ${fmt.q(fmt.power(d.powerBreakdown.conversionLoss ?? 0))}`,
                ],
                [
                  'PSUs',
                  `${d.psu.healthy}/${d.psu.installed} healthy (${d.psu.required} required) · ${d.psu.model}`,
                ],
                ['Fans', `${d.fans.healthy}/${d.fans.installed} · ${fmt.percent(d.fans.duty, 0)} duty`],
                ['Inlet', fmt.temperature(d.inletC)],
                ['Cooling', d.cooling],
              ]}
            />
            <KeyValue
              items={[
                [
                  'CPU',
                  `${d.cpu.sockets} × ${d.cpu.model} (${d.cpu.cores} cores) · ${fmt.percent(d.cpu.util, 0)}`,
                ],
                [
                  'Memory',
                  `${fmt.formatNumber(d.memory.totalGB)} GB ${d.memory.type} @ ${d.memory.speedMTs} MT/s`,
                ],
                [
                  'Local NVMe',
                  `${d.storage.count} × ${d.storage.model} (${fmt.formatNumber(d.storage.capacityTB, 1, 1)} TB)`,
                ],
                [
                  'Fabric',
                  `${d.nics.length} × ${d.nics[0]?.model ?? '—'} · ${d.nics.filter((n) => n.up).length} up`,
                ],
                ['Leaf (rail 0)', d.nics[0]?.leaf ?? '—'],
              ]}
            />
            <div className="pv-detail__trends">
              <div className="sf-label">History ({d.history.intervalS}s samples)</div>
              <div className="pv-detail__trend">
                <span className="sf-muted">GPU util</span>
                <Sparkline
                  values={d.history.util}
                  width={220}
                  height={26}
                  min={0}
                  max={1}
                  format={(v) => fmt.percent(v, 0)}
                />
              </div>
              <div className="pv-detail__trend">
                <span className="sf-muted">Max temp</span>
                <Sparkline
                  values={d.history.tempC}
                  width={220}
                  height={26}
                  color="var(--series-2)"
                  format={(v) => fmt.temperature(v)}
                />
              </div>
              <div className="pv-detail__trend">
                <span className="sf-muted">Power</span>
                <Sparkline
                  values={d.history.powerW}
                  width={220}
                  height={26}
                  color="var(--series-3)"
                  format={(v) => fmt.q(fmt.power(v))}
                />
              </div>
            </div>
          </div>
          <div style={{ height: Math.min(9, d.gpus.length + 1) * 30 + 8 }}>
            <Table rows={d.gpus} columns={gpuCols} rowKey={(g) => g.index} label="GPUs" />
          </div>
        </div>
      )}
    </Dialog>
  );
}
