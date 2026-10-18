import { Snowflake, Wrench } from 'lucide-react';
import { useEngineStore } from '../os/engine/store';
import { Button, Meter, Panel, StatusBadge, Table, fmt, type Column } from '../ui';
import type { HallSnapshot } from '../engine';
import { run } from './shared';

export function FacilityPanel() {
  const snap = useEngineStore((s) => s.snapshot);
  if (!snap) return null;
  const f = snap.facility;
  const halls = snap.halls.map((h, i) => ({ ...h, idx: i }));
  const columns: Column<HallSnapshot & { idx: number }>[] = [
    { id: 'name', header: 'Hall', width: 'minmax(96px, 1fr)', cell: (h) => h.name },
    { id: 'it', header: 'IT', width: '76px', align: 'right', cell: (h) => fmt.q(fmt.power(h.itPowerW)) },
    {
      id: 'air',
      header: 'Room air / capacity',
      width: '170px',
      cell: (h) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <div style={{ flex: 1 }}>
            <Meter
              value={h.airCapacityW > 0 ? h.roomAirHeatW / h.airCapacityW : 1}
              label={`${h.name} air load`}
            />
          </div>
          <span className="mono sf-muted" style={{ fontSize: 'var(--fs-2xs)' }}>
            {h.airUnitsHealthy}/{h.airUnitsInstalled}
          </span>
        </div>
      ),
    },
    {
      id: 'supply',
      header: 'Supply air',
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
      header: 'Coolant / CDUs',
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
      width: '150px',
      cell: (h) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              void run({ type: 'fault.inject', target: { kind: 'cooling-unit', hall: h.idx, unit: 'air' } })
            }
          >
            Fail CRAH
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
              Fail CDU
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <Panel
      title="Facility"
      subtitle={`ambient ${fmt.temperature(f.ambientC)} · CHW ${fmt.temperature(f.chilledWaterSupplyC)} · COP ${fmt.formatNumber(f.chillerCop, 2, 2)}`}
      icon={<Snowflake size={14} />}
      actions={
        <>
          <StatusBadge
            tone={f.chillersHealthy < f.chillersInstalled ? 'warning' : 'good'}
            label={`Chillers ${f.chillersHealthy}/${f.chillersInstalled}`}
          />
          <Button
            size="sm"
            variant="danger"
            onClick={() => void run({ type: 'fault.inject', target: { kind: 'chiller' } })}
          >
            Fail chiller
          </Button>
          <Button
            size="sm"
            icon={<Wrench size={12} />}
            onClick={() => void run({ type: 'facility.repairAll' }, true)}
          >
            Repair plant
          </Button>
        </>
      }
      flush
    >
      <div style={{ height: Math.min(6, halls.length) * 30 + 34 }}>
        <Table rows={halls} columns={columns} rowKey={(h) => h.id} label="Data halls" />
      </div>
    </Panel>
  );
}
