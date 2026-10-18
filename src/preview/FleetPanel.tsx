import { Bomb, Info, Power, PowerOff, RotateCcw, Server, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NODE_FAULT_NAMES, NODE_STATE_NAMES, NodeState } from '../engine';
import { useEngineStore } from '../os/engine/store';
import { Button, ButtonGroup, Panel, Select, StatusBadge, Table, fmt, type Column } from '../ui';
import { NodeDetailDialog } from './NodeDetailDialog';
import { NodeGrid, type GridMetric } from './NodeGrid';
import { NODE_STATE_LABEL, NODE_STATE_TONE, run } from './shared';

interface Row {
  i: number;
}

export function FleetPanel() {
  const topo = useEngineStore((s) => s.topology);
  const snap = useEngineStore((s) => s.snapshot);
  const [metric, setMetric] = useState<GridMetric>('util');
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState(false);
  const [filter, setFilter] = useState<'all' | 'busy' | 'unhealthy'>('all');

  const rows = useMemo<Row[]>(() => {
    if (!topo || !snap) return [];
    const out: Row[] = [];
    for (let i = 0; i < topo.nodes.length; i++) {
      const st = snap.nodes.state[i]!;
      if (filter === 'busy' && snap.nodes.job[i]! < 0) continue;
      if (filter === 'unhealthy' && st === NodeState.Online && snap.nodes.faults[i] === 0) continue;
      out.push({ i });
    }
    return out;
  }, [topo, snap, filter]);

  if (!topo || !snap) return null;
  const s = snap.nodes;
  const counts = snap.cluster.nodesByState;
  const columns: Column<Row>[] = [
    {
      id: 'host',
      header: 'Hostname',
      width: 'minmax(130px, 1fr)',
      cell: ({ i }) => <span className="mono">{topo.nodes[i]!.hostname}</span>,
      sortValue: ({ i }) => i,
    },
    {
      id: 'rack',
      header: 'Rack',
      width: '76px',
      cell: ({ i }) => <span className="mono sf-muted">{topo.racks[topo.nodes[i]!.rack]!.name}</span>,
    },
    {
      id: 'state',
      header: 'State',
      width: '130px',
      cell: ({ i }) => {
        const name = NODE_STATE_NAMES[s.state[i]!]!;
        return (
          <StatusBadge
            tone={NODE_STATE_TONE[name]}
            label={NODE_STATE_LABEL[name]}
            pulse={name === 'post' || name === 'booting'}
          />
        );
      },
      sortValue: ({ i }) => s.state[i]!,
    },
    {
      id: 'job',
      header: 'Job',
      width: '58px',
      cell: ({ i }) =>
        s.job[i]! >= 0 ? <span className="mono">{s.job[i]}</span> : <span className="sf-muted">—</span>,
      sortValue: ({ i }) => s.job[i]!,
    },
    {
      id: 'util',
      header: 'GPU util',
      width: '74px',
      align: 'right',
      cell: ({ i }) => fmt.percent(s.gpuUtil[i]!, 0),
      sortValue: ({ i }) => s.gpuUtil[i]!,
    },
    {
      id: 'temp',
      header: 'GPU max',
      width: '76px',
      align: 'right',
      cell: ({ i }) => fmt.temperature(s.gpuTempMax[i]!),
      sortValue: ({ i }) => s.gpuTempMax[i]!,
    },
    {
      id: 'power',
      header: 'Power',
      width: '80px',
      align: 'right',
      cell: ({ i }) => fmt.q(fmt.power(s.powerW[i]!)),
      sortValue: ({ i }) => s.powerW[i]!,
    },
    {
      id: 'fan',
      header: 'Fans',
      width: '56px',
      align: 'right',
      cell: ({ i }) => fmt.percent(s.fanDuty[i]!, 0),
      sortValue: ({ i }) => s.fanDuty[i]!,
    },
    {
      id: 'net',
      header: 'Fabric',
      width: '84px',
      align: 'right',
      cell: ({ i }) => fmt.q(fmt.bandwidthGbps(s.netGbps[i]!)),
      sortValue: ({ i }) => s.netGbps[i]!,
    },
    {
      id: 'faults',
      header: 'Faults',
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

  return (
    <Panel
      title="Node fleet"
      subtitle={`${fmt.formatNumber(topo.nodes.length)} nodes · ${counts[NodeState.Online]} online · ${counts[NodeState.Degraded]} degraded · ${counts[NodeState.Failed]} failed · ${counts[NodeState.Offline] + counts[NodeState.Maintenance]} off/maint.`}
      icon={<Server size={14} />}
      actions={
        <>
          <div style={{ width: 130 }}>
            <Select<GridMetric>
              aria-label="Map metric"
              value={metric}
              options={[
                { value: 'util', label: 'GPU utilisation' },
                { value: 'temp', label: 'GPU temperature' },
                { value: 'power', label: 'Node power' },
              ]}
              onChange={setMetric}
            />
          </div>
          <div style={{ width: 120 }}>
            <Select
              aria-label="Table filter"
              value={filter}
              options={[
                { value: 'all', label: 'All nodes' },
                { value: 'busy', label: 'Allocated' },
                { value: 'unhealthy', label: 'Not healthy' },
              ]}
              onChange={(v) => setFilter(v as typeof filter)}
            />
          </div>
        </>
      }
      flush
    >
      <div className="pv-fleet">
        <NodeGrid
          topology={topo}
          snapshot={snap}
          metric={metric}
          selected={selected}
          onSelect={setSelected}
        />
        <div className="pv-node-actions">
          {sel && selState ? (
            <>
              <span className="mono" style={{ fontWeight: 600 }}>
                {sel.hostname}
              </span>
              <StatusBadge tone={NODE_STATE_TONE[selState]} label={NODE_STATE_LABEL[selState]} />
              <span className="sf-divider" />
              <ButtonGroup label="Power">
                <Button
                  size="sm"
                  icon={<Power size={12} />}
                  onClick={() => void run({ type: 'node.powerOn', nodes: target }, true)}
                >
                  On
                </Button>
                <Button
                  size="sm"
                  icon={<PowerOff size={12} />}
                  onClick={() => void run({ type: 'node.powerOff', nodes: target }, true)}
                >
                  Off
                </Button>
                <Button
                  size="sm"
                  icon={<RotateCcw size={12} />}
                  onClick={() => void run({ type: 'node.reboot', nodes: target }, true)}
                >
                  Reboot
                </Button>
              </ButtonGroup>
              <ButtonGroup label="Scheduling">
                <Button
                  size="sm"
                  onClick={() => void run({ type: 'node.drain', nodes: target, reason: 'operator' }, true)}
                >
                  Drain
                </Button>
                <Button size="sm" onClick={() => void run({ type: 'node.resume', nodes: target }, true)}>
                  Resume
                </Button>
              </ButtonGroup>
              <ButtonGroup label="Maintenance">
                <Button
                  size="sm"
                  onClick={() => void run({ type: 'node.maintenance', nodes: target, enter: true }, true)}
                >
                  Maint. in
                </Button>
                <Button
                  size="sm"
                  onClick={() => void run({ type: 'node.maintenance', nodes: target, enter: false }, true)}
                >
                  Maint. out
                </Button>
                <Button
                  size="sm"
                  icon={<Wrench size={12} />}
                  onClick={() => void run({ type: 'node.repair', nodes: target }, true)}
                >
                  Repair
                </Button>
              </ButtonGroup>
              <ButtonGroup label="Fault injection">
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Bomb size={12} />}
                  onClick={() =>
                    void run({ type: 'fault.inject', target: { kind: 'node-crash', node: selected! } })
                  }
                >
                  Crash
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
                  PSU
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
                  Fan
                </Button>
              </ButtonGroup>
              <Button
                size="sm"
                icon={<Info size={12} />}
                onClick={() => setDetail(true)}
                style={{ marginLeft: 'auto' }}
              >
                Details
              </Button>
            </>
          ) : (
            <span className="sf-muted">Select a node in the map or table to operate on it.</span>
          )}
        </div>
        <div className="pv-fleet__table">
          <Table
            rows={rows}
            columns={columns}
            rowKey={(r) => r.i}
            selectedKey={selected}
            onRowClick={(r) => setSelected(r.i)}
            label="Nodes"
          />
        </div>
      </div>
      {selected !== null && (
        <NodeDetailDialog node={selected} open={detail} onClose={() => setDetail(false)} />
      )}
    </Panel>
  );
}
