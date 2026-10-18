import { ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SEVERITY_RANK, type Severity, type SimEvent } from '../engine';
import { useEngineStore } from '../os/engine/store';
import { Badge, Panel, Select, Table, fmt, type Column } from '../ui';
import { SEVERITY_TONE } from './shared';

export function EventLog() {
  const events = useEngineStore((s) => s.events);
  const [min, setMin] = useState<Severity>('info');
  const rows = useMemo(() => events.filter((e) => SEVERITY_RANK[e.severity] >= SEVERITY_RANK[min]).slice().reverse(), [events, min]);
  const columns: Column<SimEvent>[] = [
    { id: 'time', header: 'Time', width: '82px', cell: (e) => <span className="mono sf-muted">{fmt.clockTime(e.time)}</span> },
    { id: 'sev', header: 'Severity', width: '84px', cell: (e) => <Badge tone={SEVERITY_TONE[e.severity]} dot>{e.severity}</Badge> },
    { id: 'src', header: 'Source', width: '150px', cell: (e) => <span className="mono">{e.source.id}</span> },
    { id: 'code', header: 'Code', width: '190px', cell: (e) => <span className="mono sf-muted">{e.code}</span> },
    { id: 'msg', header: 'Message', width: 'minmax(320px, 1fr)', cell: (e) => <span title={e.message}>{e.message}</span> },
  ];
  return (
    <Panel
      title="Event log"
      subtitle={`${rows.length.toLocaleString()} events`}
      icon={<ScrollText size={14} />}
      actions={
        <div style={{ width: 120 }}>
          <Select<Severity>
            aria-label="Minimum severity"
            value={min}
            options={(['info', 'notice', 'warning', 'error', 'critical'] as Severity[]).map((s) => ({ value: s, label: `≥ ${s}` }))}
            onChange={setMin}
          />
        </div>
      }
      flush
    >
      <div style={{ height: 300 }}>
        <Table rows={rows} columns={columns} rowKey={(e) => e.seq} empty="No events yet" label="Events" />
      </div>
    </Panel>
  );
}
