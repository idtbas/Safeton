import type { CommandResult, JobState, NodeStateName, Severity } from '../engine';
import { confirmCommand } from '../os/confirm';
import { command } from '../os/kernel';
import { useNotificationStore } from '../os/notifications/store';
import type { Tone } from '../ui';

export const NODE_STATE_TONE: Record<NodeStateName, Exclude<Tone, 'accent'>> = {
  offline: 'neutral',
  post: 'info',
  booting: 'info',
  online: 'good',
  degraded: 'warning',
  draining: 'info',
  maintenance: 'neutral',
  failed: 'critical',
  'shutting-down': 'info',
};

export const NODE_STATE_LABEL: Record<NodeStateName, string> = {
  offline: 'Offline',
  post: 'POST',
  booting: 'Booting',
  online: 'Online',
  degraded: 'Degraded',
  draining: 'Draining',
  maintenance: 'Maintenance',
  failed: 'Failed',
  'shutting-down': 'Shutting down',
};

export const JOB_STATE_TONE: Record<JobState, Exclude<Tone, 'accent'>> = {
  pending: 'neutral',
  initializing: 'info',
  running: 'good',
  checkpointing: 'info',
  restarting: 'serious',
  completed: 'good',
  failed: 'critical',
  cancelled: 'neutral',
};

export const SEVERITY_TONE: Record<Severity, Exclude<Tone, 'accent'>> = {
  debug: 'neutral',
  info: 'info',
  notice: 'info',
  warning: 'warning',
  error: 'serious',
  critical: 'critical',
};

/**
 * Executes a command (after confirmation, for critical commands when enabled in the security
 * settings) and reports failures (and optionally success) as notifications.
 */
export async function run(
  cmd: Parameters<typeof command>[0],
  announce = false,
): Promise<CommandResult | null> {
  if (!(await confirmCommand(cmd))) return null;
  const result = await command(cmd);
  const push = useNotificationStore.getState().push;
  if (!result.ok)
    push({
      severity: 'warning',
      title: `Command rejected: ${cmd.type}`,
      body: `${result.error.code} — ${result.error.message}`,
      source: 'operator',
    });
  else if (announce) push({ severity: 'notice', title: cmd.type, body: result.message, source: 'operator' });
  return result;
}
