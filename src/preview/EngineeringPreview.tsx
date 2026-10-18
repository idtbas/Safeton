import { ControlBar } from './ControlBar';
import { EventLog } from './EventLog';
import { FacilityPanel } from './FacilityPanel';
import { FleetPanel } from './FleetPanel';
import { InfraPanel } from './InfraPanel';
import { KpiRow } from './KpiRow';
import { PersistencePanel } from './PersistencePanel';
import { WorkloadPanel } from './WorkloadPanel';

/**
 * Internal verification surface for the stage-1 foundation: every control here goes through
 * the same kernel → engine command path the real applications will use.
 */
export function EngineeringPreview() {
  return (
    <main className="pv-main">
      <aside className="pv-side">
        <InfraPanel />
        <PersistencePanel />
      </aside>
      <section className="pv-content">
        <ControlBar />
        <KpiRow />
        <WorkloadPanel />
        <FleetPanel />
        <FacilityPanel />
        <EventLog />
      </section>
    </main>
  );
}
