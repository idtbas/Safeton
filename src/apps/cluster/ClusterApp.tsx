/**
 * Cluster manager: fleet map, searchable node table and node operations (power, scheduling,
 * maintenance, repair, fault injection). Node details open in their own window.
 */
import { Bomb, Info, Power, PowerOff, RotateCcw, Search, Server, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NODE_FAULT_NAMES, NODE_STATE_NAMES, NodeState } from '../../engine';
import type { AppWindowProps } from '../../os/apps/registry';
import { useEngineStore } from '../../os/engine/store';
import { useT } from '../../os/i18n';
import { Button, ButtonGroup, Input, Select, StatusBadge, Table, fmt, type Column } from '../../ui';
import { openApp } from '../launch';
import {
  AppFrame,
  AppStatusBar,
  AppToolbar,
  EmptyState,
  ToolbarSeparator,
  ToolbarSpacer,
} from '../common/AppLayout';
import { NODE_STATE_TONE, nodeStateKey, run } from '../common/shared';
import { NodeGrid, type GridMetric } from './NodeGrid';

interface Row {
  i: number;
}

type Filter = 'all' | 'busy' | 'unhealthy' | 'off';

export function ClusterApp({ args }: AppWindowProps) {
  const t = useT();
  const topo = useEngineStore((s) => s.topology);
  const snap = useEngineStore((s) => s.snapshot);
  const [metric, setMetric] = useState<GridMetric>('util');
  const [selected, setSelected] = useState<number | null>(typeof args?.node === 'number' ? args.node : null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const rows = useMemo<Row[]>(() => {
    if (!topo || !snap) return [];
    const q = query.trim().toLowerCase();
    const out: Row[] = [];
    for (let i = 0; i < topo.nodes.length; i++) {
      const st = snap.nodes.state[i]!;
      if (filter === 'busy' && snap.nodes.job[i]! < 0) continue;
      if (filter === 'unhealthy' && st === NodeState.Online && snap.nodes.faults[i] === 0) continue;
      if (filter === 'off' && st !== NodeState.Offline && st !== NodeState.Maintenance) continue;
      if (q) {
        const n = topo.nodes[i]!;
        if (!n.hostname.includes(q) && !topo.racks[n.rack]!.name.toLowerCase().includes(q)) continue;
      }
      out.push({ i });
    }
    return out;
  }, [topo, snap, filter, query]);

  if (!topo || !snap) return <EmptyState icon={<Server size={28} />} title={t('app.waiting')} />;
  const s = snap.nodes;
  const counts = snap.cluster.nodesByState;
  const columns: Column<Row>[] = [
    {
      id: 'host',
      header: t('cluster.col.host'),
      width: 'minmax(130px, 1fr)',
      cell: ({ i }) => <span className="mono">{topo.nodes[i]!.hostname}</span>,
      sortValue: ({ i }) => i,
    },
    {
      id: 'rack',
      header: t('cluster.col.rack'),
      width: '76px',
      cell: ({ i }) => <span className="mono sf-muted">{topo.racks[topo.nodes[i]!.rack]!.name}</span>,
    },
    {
      id: 'state',
      header: t('cluster.col.state'),
      width: '130px',
      cell: ({ i }) => {
        const name = NODE_STATE_NAMES[s.state[i]!]!;
        return (
          <StatusBadge
            tone={NODE_STATE_TONE[name]}
            label={t(nodeStateKey(name))}
            pulse={name === 'post' || name === 'booting'}
          />
        );
      },
      sortValue: ({ i }) => s.state[i]!,
    },
    {
      id: 'job',
      header: t('cluster.col.job'),
      width: '58px',
      cell: ({ i }) =>
        s.job[i]! >= 0 ? <span className="mono">{s.job[i]}</span> : <span className="sf-muted">—</span>,
      sortValue: ({ i }) => s.job[i]!,
    },
    {
      id: 'util',
      header: t('cluster.col.util'),
      width: '74px',
      align: 'right',
      cell: ({ i }) => fmt.percent(s.gpuUtil[i]!, 0),
      sortValue: ({ i }) => s.gpuUtil[i]!,
    },
    {
      id: 'temp',
      header: t('cluster.col.temp'),
      width: '76px',
      align: 'right',
      cell: ({ i }) => fmt.temperature(s.gpuTempMax[i]!),
      sortValue: ({ i }) => s.gpuTempMax[i]!,
    },
    {
      id: 'power',
      header: t('cluster.col.power'),
      width: '80px',
      align: 'right',
      cell: ({ i }) => fmt.q(fmt.power(s.powerW[i]!)),
      sortValue: ({ i }) => s.powerW[i]!,
    },
    {
      id: 'fan',
      header: t('cluster.col.fans'),
      width: '58px',
      align: 'right',
      cell: ({ i }) => fmt.percent(s.fanDuty[i]!, 0),
      sortValue: ({ i }) => s.fanDuty[i]!,
    },
    {
      id: 'net',
      header: t('cluster.col.fabric'),
      width: '84px',
      align: 'right',
      cell: ({ i }) => fmt.q(fmt.bandwidthGbps(s.netGbps[i]!)),
      sortValue: ({ i }) => s.netGbps[i]!,
    },
    {
      id: 'faults',
      header: t('cluster.col.faults'),
      width: 'minmax(110px, 1fr)',
      cell: ({ i }) => {
        const f = s.faults[i]!;
        if (!f) return <span className="sf-muted">—</span>;
        const names = Object.entries(NODE_FAULT_NAMES)
          .filter(([bit]) => f & Number(bit))
          .map(([, n]) => n);
        return (
          <span className="mono" style={{ color: 'var(--status-warning)' }}>
            {names.join(', ')}
          </span>
        );
      },
      sortValue: ({ i }) => s.faults[i]!,
    },
  ];

  const sel = selected !== null ? topo.nodes[selected] : null;
  const selState = selected !== null ? NODE_STATE_NAMES[s.state[selected]!]! : null;
  const target = selected !== null ? [selected] : [];
  const showDetail = (node: number) => openApp('node', { node });

  return (
    <AppFrame>
      <AppToolbar>
        <div style={{ width: 190 }}>
          <Input
            aria-label={t('cluster.search')}
            placeholder={t('cluster.search')}
            prefix={<Search size={13} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div style={{ width: 150 }}>
          <Select<Filter>
            aria-label={t('cluster.filter')}
            value={filter}
            options={[
              { value: 'all', label: t('cluster.filter.all') },
              { value: 'busy', label: t('cluster.filter.busy') },
              { value: 'unhealthy', label: t('cluster.filter.unhealthy') },
              { value: 'off', label: t('cluster.filter.off') },
            ]}
            onChange={setFilter}
          />
        </div>
        <ToolbarSpacer />
        <span className="ap-toolbar__label">{t('cluster.mapMetric')}</span>
        <div style={{ width: 160 }}>
          <Select<GridMetric>
            aria-label={t('cluster.mapMetric')}
            value={metric}
            options={[
              { value: 'util', label: t('cluster.metric.util') },
              { value: 'temp', label: t('cluster.metric.temp') },
              { value: 'power', label: t('cluster.metric.power') },
            ]}
            onChange={setMetric}
          />
        </div>
      </AppToolbar>
      <div className="ap-cluster">
        <div className="ap-cluster__map">
          <NodeGrid
            topology={topo}
            snapshot={snap}
            metric={metric}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
        <div className="ap-node-actions">
          {sel && selState ? (
            <>
              <span className="mono" style={{ fontWeight: 600 }}>
                {sel.hostname}
              </span>
              <StatusBadge tone={NODE_STATE_TONE[selState]} label={t(nodeStateKey(selState))} />
              <ToolbarSeparator />
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
              <ButtonGroup label={t('cluster.group.scheduling')}>
                <Button
                  size="sm"
                  onClick={() => void run({ type: 'node.drain', nodes: target, reason: 'operator' }, true)}
                >
                  {t('cluster.action.drain')}
                </Button>
                <Button size="sm" onClick={() => void run({ type: 'node.resume', nodes: target }, true)}>
                  {t('cluster.action.resume')}
                </Button>
              </ButtonGroup>
              <ButtonGroup label={t('cluster.group.maintenance')}>
                <Button
                  size="sm"
                  onClick={() => void run({ type: 'node.maintenance', nodes: target, enter: true }, true)}
                >
                  {t('cluster.action.maintIn')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => void run({ type: 'node.maintenance', nodes: target, enter: false }, true)}
                >
                  {t('cluster.action.maintOut')}
                </Button>
                <Button
                  size="sm"
                  icon={<Wrench size={12} />}
                  onClick={() => void run({ type: 'node.repair', nodes: target }, true)}
                >
                  {t('cluster.action.repair')}
                </Button>
              </ButtonGroup>
              <ButtonGroup label={t('cluster.group.faults')}>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Bomb size={12} />}
                  onClick={() =>
                    void run({ type: 'fault.inject', target: { kind: 'node-crash', node: selected! } })
                  }
                >
                  {t('cluster.fault.crash')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    void run({ type: 'fault.inject', target: { kind: 'gpu', node: selected!, xid: 79 } })
                  }
                >
                  GPU Xid 79
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void run({ type: 'fault.inject', target: { kind: 'psu', node: selected! } })}
                >
                  {t('cluster.fault.psu')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    void run({ type: 'fault.inject', target: { kind: 'nic', node: selected!, rail: 0 } })
                  }
                >
                  NIC
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void run({ type: 'fault.inject', target: { kind: 'fan', node: selected! } })}
                >
                  {t('cluster.fault.fan')}
                </Button>
              </ButtonGroup>
              <Button
                size="sm"
                icon={<Info size={12} />}
                onClick={() => showDetail(selected!)}
                style={{ marginLeft: 'auto' }}
              >
                {t('cluster.details')}
              </Button>
            </>
          ) : (
            <span className="sf-muted">{t('cluster.selectHint')}</span>
          )}
        </div>
        <div className="ap-cluster__table">
          <Table
            rows={rows}
            columns={columns}
            rowKey={(r) => r.i}
            selectedKey={selected}
            onRowClick={(r) => setSelected(r.i)}
            label={t('cluster.nodes')}
            empty={t('cluster.noMatch')}
          />
        </div>
      </div>
      <AppStatusBar>
        <span>{t('cluster.status.total', { n: fmt.formatNumber(topo.nodes.length) })}</span>
        <span>{t('cluster.status.online', { n: counts[NodeState.Online] ?? 0 })}</span>
        <span>{t('cluster.status.degraded', { n: counts[NodeState.Degraded] ?? 0 })}</span>
        <span>{t('cluster.status.failed', { n: counts[NodeState.Failed] ?? 0 })}</span>
        <span>
          {t('cluster.status.off', {
            n: (counts[NodeState.Offline] ?? 0) + (counts[NodeState.Maintenance] ?? 0),
          })}
        </span>
        <span className="ap-statusbar__right">
          {t('cluster.status.shown', { n: fmt.formatNumber(rows.length) })}
        </span>
      </AppStatusBar>
    </AppFrame>
  );
}
