/**
 * Helpers shared by the applications: command execution with confirmation and notifications,
 * and tone / label mappings for engine states.
 */
import type { CommandResult, JobState, NodeStateName, Severity } from '../../engine';
import { confirmCommand } from '../../os/confirm';
import { t, type MessageKey } from '../../os/i18n';
import { command } from '../../os/kernel';
import { useNotificationStore } from '../../os/notifications/store';
import type { Tone } from '../../ui';

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

export const ACTIVE_JOB_STATES: JobState[] = [
  'pending',
  'initializing',
  'running',
  'checkpointing',
  'restarting',
];

export const nodeStateKey = (s: NodeStateName) => `node.state.${s}` as MessageKey;
export const jobStateKey = (s: JobState) => `job.state.${s}` as MessageKey;
export const severityKey = (s: Severity) => `severity.${s}` as MessageKey;

/**
 * Executes a command (after confirmation for critical commands when enabled in the security
 * settings) and reports failures — and optionally success — as notifications.
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
      title: t('cmd.rejected', { type: cmd.type }),
      body: `${result.error.code} — ${result.error.message}`,
      source: 'operator',
    });
  else if (announce) push({ severity: 'notice', title: cmd.type, body: result.message, source: 'operator' });
  return result;
}
