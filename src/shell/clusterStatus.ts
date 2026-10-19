import { NODE_STATE_NAMES, type Snapshot } from '../engine';
import { useAlertStore } from '../os/alerts';
import { useEngineStore } from '../os/engine/store';

export type ClusterLevel = 'ok' | 'warning' | 'critical';

/** Overall cluster level from active threshold alerts and failed hardware. */
export function clusterLevel(
  snap: Snapshot | null,
  alerts: Record<string, { level: 'warning' | 'critical' }>,
): ClusterLevel {
  const levels = Object.values(alerts).map((a) => a.level);
  if (levels.includes('critical')) return 'critical';
  if (!snap) return 'ok';
  const failed = snap.cluster.nodesByState[NODE_STATE_NAMES.indexOf('failed')] ?? 0;
  const total = Math.max(1, snap.cluster.nodesTotal);
  if (failed / total > 0.1 || snap.facility.chillersHealthy < snap.facility.chillersInstalled - 1)
    return 'critical';
  if (levels.length > 0 || failed > 0 || snap.cluster.switchesDown > 0) return 'warning';
  return 'ok';
}

export function useClusterLevel(): ClusterLevel {
  const snap = useEngineStore((s) => s.snapshot);
  const alerts = useAlertStore((s) => s.alerts);
  return clusterLevel(snap, alerts);
}

export const onlineNodes = (snap: Snapshot) =>
  (snap.cluster.nodesByState[NODE_STATE_NAMES.indexOf('online')] ?? 0) +
  (snap.cluster.nodesByState[NODE_STATE_NAMES.indexOf('degraded')] ?? 0);
