/**
 * Events & logs: the engine's event stream with severity, source and text filters, a detail
 * pane and export. Event texts stay English, like real infrastructure logs.
 */
import { Download, ScrollText, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SEVERITY_RANK, type EventSourceKind, type Severity, type SimEvent } from '../../engine';
import type { AppWindowProps } from '../../os/apps/registry';
import { useEngineStore } from '../../os/engine/store';
import { useT, type MessageKey } from '../../os/i18n';
import { Badge, Button, Input, KeyValue, Select, Table, fmt, type Column } from '../../ui';
import { AppFrame, AppStatusBar, AppToolbar, ToolbarSpacer } from '../common/AppLayout';
import { SEVERITY_TONE, severityKey } from '../common/shared';
import { openApp } from '../launch';

const SOURCES: EventSourceKind[] = [
  'system',
  'node',
  'gpu',
  'rack',
  'switch',
  'link',
  'job',
  'scheduler',
  'facility',
  'hall',
  'storage',
];
const SEVERITIES: Severity[] = ['info', 'notice', 'warning', 'error', 'critical'];

export function EventsApp({ args }: AppWindowProps) {
  const t = useT();
  const events = useEngineStore((s) => s.events);
  const topo = useEngineStore((s) => s.topology);
  const [min, setMin] = useState<Severity>((args?.minSeverity as Severity) ?? 'info');
  const [source, setSource] = useState<EventSourceKind | 'all'>('all');
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<number | null>(null);

  const rows = useMemo(() => {
    const q = text.trim().toLowerCase();
    return events
      .filter(
        (e) =>
          SEVERITY_RANK[e.severity] >= SEVERITY_RANK[min] &&
          (source === 'all' || e.source.kind === source) &&
          (!q ||
            e.message.toLowerCase().includes(q) ||
            e.code.toLowerCase().includes(q) ||
            e.source.id.toLowerCase().includes(q)),
      )
      .slice()
      .reverse();
  }, [events, min, source, text]);
  const sel = selected !== null ? (events.find((e) => e.seq === selected) ?? null) : null;

  const columns: Column<SimEvent>[] = [
    {
      id: 'time',
      header: t('events.col.time'),
      width: '84px',
      cell: (e) => <span className="mono sf-muted">{fmt.clockTime(e.time)}</span>,
    },
    {
      id: 'sev',
      header: t('events.col.severity'),
      width: '96px',
      cell: (e) => (
        <Badge tone={SEVERITY_TONE[e.severity]} dot>
          {t(severityKey(e.severity))}
        </Badge>
      ),
    },
    {
      id: 'src',
      header: t('events.col.source'),
      width: '150px',
      cell: (e) => <span className="mono">{e.source.id}</span>,
    },
    {
      id: 'code',
      header: t('events.col.code'),
      width: '200px',
      cell: (e) => <span className="mono sf-muted">{e.code}</span>,
    },
    {
      id: 'msg',
      header: t('events.col.message'),
      width: 'minmax(300px, 1fr)',
      cell: (e) => <span title={e.message}>{e.message}</span>,
    },
  ];

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `safeton-events-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const nodeIndex =
    sel && sel.source.kind === 'node' && topo
      ? topo.nodes.findIndex((n) => n.hostname === sel.source.id)
      : -1;

  return (
    <AppFrame>
      <AppToolbar>
        <div style={{ width: 220 }}>
          <Input
            aria-label={t('events.search')}
            placeholder={t('events.search')}
            prefix={<Search size={13} />}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div style={{ width: 150 }}>
          <Select<Severity>
            aria-label={t('events.minSeverity')}
            value={min}
            options={SEVERITIES.map((s) => ({ value: s, label: `≥ ${t(severityKey(s))}` }))}
            onChange={setMin}
          />
        </div>
        <div style={{ width: 150 }}>
          <Select<EventSourceKind | 'all'>
            aria-label={t('events.source')}
            value={source}
            options={[
              { value: 'all', label: t('events.source.all') },
              ...SOURCES.map((s) => ({ value: s, label: t(`events.source.${s}` as MessageKey) })),
            ]}
            onChange={setSource}
          />
        </div>
        <ToolbarSpacer />
        <Button size="sm" icon={<Download size={13} />} onClick={exportJson} disabled={rows.length === 0}>
          {t('events.export')}
        </Button>
      </AppToolbar>
      <div className="ap-events">
        <div className="ap-events__table">
          <Table
            rows={rows}
            columns={columns}
            rowKey={(e) => e.seq}
            selectedKey={selected}
            onRowClick={(e) => setSelected(e.seq)}
            empty={t('events.empty')}
            label={t('app.events.title')}
          />
        </div>
        {sel && (
          <div className="ap-events__detail">
            <div className="ap-events__detail-head">
              <Badge tone={SEVERITY_TONE[sel.severity]} dot>
                {t(severityKey(sel.severity))}
              </Badge>
              <span className="mono">{sel.code}</span>
              {nodeIndex >= 0 && (
                <Button size="sm" variant="ghost" onClick={() => openApp('node', { node: nodeIndex })}>
                  {t('events.openNode')}
                </Button>
              )}
            </div>
            <p className="ap-events__message">{sel.message}</p>
            <KeyValue
              items={[
                [t('events.col.time'), fmt.dateTime(sel.time)],
                [
                  t('events.col.source'),
                  `${t(`events.source.${sel.source.kind}` as MessageKey)} · ${sel.source.id}`,
                ],
                ['Tick', fmt.formatNumber(sel.tick)],
                ['Seq', String(sel.seq)],
              ]}
            />
          </div>
        )}
      </div>
      <AppStatusBar>
        <ScrollText size={12} />
        <span>
          {t('events.status.shown', {
            n: fmt.formatNumber(rows.length),
            total: fmt.formatNumber(events.length),
          })}
        </span>
        <span className="ap-statusbar__right">{t('events.status.buffer')}</span>
      </AppStatusBar>
    </AppFrame>
  );
}
