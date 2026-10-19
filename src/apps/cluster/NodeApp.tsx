/**
 * Node detail window: live hardware inventory, power breakdown, thermal and GPU telemetry of
 * one node, refreshed every second, with the node's operations at hand.
 */
import { Power, PowerOff, RotateCcw, Server, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GpuDetail, NodeDetail } from '../../engine';
import type { AppWindowProps } from '../../os/apps/registry';
import { useT } from '../../os/i18n';
import { query } from '../../os/kernel';
import { useWindowStore } from '../../os/windows/store';
import {
  Badge,
  Button,
  ButtonGroup,
  KeyValue,
  Sparkline,
  StatusBadge,
  Table,
  fmt,
  type Column,
} from '../../ui';
import { AppBody, AppFrame, AppToolbar, EmptyState, Section, ToolbarSpacer } from '../common/AppLayout';
import { NODE_STATE_TONE, nodeStateKey, run } from '../common/shared';

export function NodeApp({ windowId, args }: AppWindowProps) {
  const t = useT();
  const node = typeof args?.node === 'number' || typeof args?.node === 'string' ? args.node : null;
  const [d, setD] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (node === null) return;
    let alive = true;
    const load = () =>
      query({ type: 'node.detail', node }).then(
        (r) => {
          if (!alive) return;
          setD(r);
          setError(null);
        },
        (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
      );
    void load();
    const timer = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [node]);

  useEffect(() => {
    if (d) useWindowStore.getState().setTitle(windowId, d.hostname);
  }, [d, windowId]);

  if (node === null || error)
    return (
      <EmptyState icon={<Server size={28} />} title={t('node.notFound')}>
        {error}
      </EmptyState>
    );
  if (!d) return <EmptyState icon={<Server size={28} />} title={t('app.loading')} />;

  const target = [d.index];
  const gpuCols: Column<GpuDetail>[] = [
    { id: 'idx', header: 'GPU', width: '44px', cell: (g) => <span className="mono">{g.index}</span> },
    {
      id: 'health',
      header: t('node.gpu.health'),
      width: '110px',
      cell: (g) => (
        <StatusBadge
          tone={g.health === 'ok' ? 'good' : g.health === 'degraded' ? 'warning' : 'critical'}
          label={g.health === 'ok' ? 'OK' : g.health}
        />
      ),
    },
    {
      id: 'util',
      header: t('node.gpu.util'),
      width: '60px',
      align: 'right',
      cell: (g) => fmt.percent(g.util, 0),
    },
    {
      id: 'mem',
      header: 'HBM',
      width: '108px',
      align: 'right',
      cell: (g) => `${fmt.formatNumber(g.memUsedGB, 1, 1)} / ${g.memTotalGB} GB`,
    },
    {
      id: 'power',
      header: t('node.gpu.power'),
      width: '110px',
      align: 'right',
      cell: (g) => `${fmt.formatNumber(g.powerW, 0, 0)} / ${fmt.formatNumber(g.powerLimitW, 0, 0)} W`,
    },
    {
      id: 'temp',
      header: t('node.gpu.temp'),
      width: '76px',
      align: 'right',
      cell: (g) => fmt.temperature(g.tempC),
    },
    {
      id: 'hbm',
      header: t('node.gpu.hbmTemp'),
      width: '84px',
      align: 'right',
      cell: (g) => fmt.temperature(g.hbmTempC),
    },
    {
      id: 'clock',
      header: t('node.gpu.clock'),
      width: '90px',
      align: 'right',
      cell: (g) => `${g.clockMHz} MHz`,
    },
    {
      id: 'thr',
      header: t('node.gpu.throttle'),
      width: 'minmax(110px, 1fr)',
      cell: (g) =>
        g.throttle.length ? (
          <span style={{ color: 'var(--status-warning)' }}>{g.throttle.join(', ')}</span>
        ) : (
          <span className="sf-muted">—</span>
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
      header: 'Xid',
      width: '56px',
      align: 'right',
      cell: (g) => (g.lastXid ? <Badge tone="serious">{g.lastXid}</Badge> : '—'),
    },
  ];

  return (
    <AppFrame>
      <AppToolbar>
        <StatusBadge tone={NODE_STATE_TONE[d.state]} label={t(nodeStateKey(d.state))} />
        {d.faults.map((f) => (
          <Badge key={f} tone="warning">
            {f}
          </Badge>
        ))}
        {d.job !== null && <Badge tone="accent">{t('cluster.jobN', { id: d.job })}</Badge>}
        <ToolbarSpacer />
        <ButtonGroup label={t('cluster.group.power')}>
          <Button
            size="sm"
            icon={<Power size={12} />}
            onClick={() => void run({ type: 'node.powerOn', nodes: target }, true)}
          >
            {t('cluster.action.on')}
          </Button>
          <Button
            size="sm"
            icon={<PowerOff size={12} />}
            onClick={() => void run({ type: 'node.powerOff', nodes: target }, true)}
          >
            {t('cluster.action.off')}
          </Button>
          <Button
            size="sm"
            icon={<RotateCcw size={12} />}
            onClick={() => void run({ type: 'node.reboot', nodes: target }, true)}
          >
            {t('cluster.action.reboot')}
          </Button>
        </ButtonGroup>
        <Button
          size="sm"
          icon={<Wrench size={12} />}
          onClick={() => void run({ type: 'node.repair', nodes: target }, true)}
        >
          {t('cluster.action.repair')}
        </Button>
      </AppToolbar>
      <AppBody>
        <p className="ap-subtitle">
          {d.reference} · {d.rack} · {d.hall} · U{d.slotU} ·{' '}
          {t('node.uptime', { value: fmt.duration(d.uptimeS) })}
        </p>
        <div className="ap-grid-3">
          <Section title={t('node.section.power')}>
            <KeyValue
              items={[
                [t('node.wallPower'), fmt.q(fmt.power(d.powerW))],
                [
                  t('node.breakdown'),
                  `${fmt.q(fmt.power(d.powerBreakdown.gpu ?? 0))} / ${fmt.q(fmt.power(d.powerBreakdown.rest ?? 0))} / ${fmt.q(fmt.power(d.powerBreakdown.conversionLoss ?? 0))}`,
                ],
                [
                  t('node.psus'),
                  t('node.psus.value', {
                    healthy: d.psu.healthy,
                    installed: d.psu.installed,
                    required: d.psu.required,
                    model: d.psu.model,
                  }),
                ],
                [t('node.fans'), `${d.fans.healthy}/${d.fans.installed} · ${fmt.percent(d.fans.duty, 0)}`],
                [t('node.inlet'), fmt.temperature(d.inletC)],
                [t('node.cooling'), d.cooling],
              ]}
            />
          </Section>
          <Section title={t('node.section.hardware')}>
            <KeyValue
              items={[
                [
                  'CPU',
                  `${d.cpu.sockets} × ${d.cpu.model} (${d.cpu.cores}C) · ${fmt.percent(d.cpu.util, 0)}`,
                ],
                [
                  t('node.memory'),
                  `${fmt.formatNumber(d.memory.totalGB)} GB ${d.memory.type} @ ${d.memory.speedMTs} MT/s`,
                ],
                [
                  t('node.nvme'),
                  `${d.storage.count} × ${d.storage.model} (${fmt.formatNumber(d.storage.capacityTB, 1, 1)} TB)`,
                ],
                [
                  t('node.fabric'),
                  t('node.fabric.value', {
                    n: d.nics.length,
                    model: d.nics[0]?.model ?? '—',
                    up: d.nics.filter((n) => n.up).length,
                  }),
                ],
                [t('node.leaf'), d.nics[0]?.leaf ?? '—'],
              ]}
            />
          </Section>
          <Section title={t('node.section.history', { s: d.history.intervalS })}>
            <div className="ap-trends">
              <div className="ap-trend">
                <span className="sf-muted">{t('node.gpu.util')}</span>
                <Sparkline
                  values={d.history.util}
                  width={200}
                  height={26}
                  min={0}
                  max={1}
                  format={(v) => fmt.percent(v, 0)}
                />
              </div>
              <div className="ap-trend">
                <span className="sf-muted">{t('node.maxTemp')}</span>
                <Sparkline
                  values={d.history.tempC}
                  width={200}
                  height={26}
                  color="var(--series-2)"
                  format={(v) => fmt.temperature(v)}
                />
              </div>
              <div className="ap-trend">
                <span className="sf-muted">{t('node.gpu.power')}</span>
                <Sparkline
                  values={d.history.powerW}
                  width={200}
                  height={26}
                  color="var(--series-3)"
                  format={(v) => fmt.q(fmt.power(v))}
                />
              </div>
            </div>
          </Section>
        </div>
        <Section title={t('node.section.gpus', { n: d.gpus.length })} flush>
          <div style={{ height: Math.min(9, d.gpus.length + 1) * 30 + 8 }}>
            <Table rows={d.gpus} columns={gpuCols} rowKey={(g) => g.index} label="GPUs" />
          </div>
        </Section>
      </AppBody>
    </AppFrame>
  );
}
