/**
 * Confirmation service for critical operator actions. Any surface can await `requestConfirm`;
 * the shell (or the Engineering Preview) renders the pending request as a modal dialog.
 * `confirmCommand` applies the security setting "confirm critical actions".
 */
import { create } from 'zustand';
import type { Command } from '../engine';
import { t, type MessageKey } from './i18n';
import { useSettingsStore } from './settings/store';

export interface ConfirmRequest {
  id: number;
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  pending: ConfirmRequest | null;
  nextId: number;
}

export const useConfirmStore = create<ConfirmState>(() => ({ pending: null, nextId: 1 }));

export function requestConfirm(opts: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const { pending, nextId } = useConfirmStore.getState();
    // A newer request supersedes an unanswered one (which counts as cancelled).
    pending?.resolve(false);
    useConfirmStore.setState({
      nextId: nextId + 1,
      pending: {
        id: nextId,
        title: opts.title,
        body: opts.body,
        confirmLabel: opts.confirmLabel ?? t('common.confirm'),
        danger: opts.danger ?? true,
        resolve,
      },
    });
  });
}

export function answerConfirm(ok: boolean): void {
  const { pending } = useConfirmStore.getState();
  if (!pending) return;
  useConfirmStore.setState({ pending: null });
  pending.resolve(ok);
}

const CRITICAL: Partial<Record<Command['type'], MessageKey>> = {
  'node.powerOff': 'cmd.node.powerOff',
  'node.reboot': 'cmd.node.reboot',
  'node.maintenance': 'cmd.node.maintenance',
  'fault.inject': 'cmd.fault.inject',
  'job.cancel': 'cmd.job.cancel',
  'switch.setAdminState': 'cmd.switch.down',
};

/** Commands that disrupt running workloads or hardware. */
export function isCriticalCommand(cmd: Command): boolean {
  if (cmd.type === 'node.maintenance') return cmd.enter;
  if (cmd.type === 'switch.setAdminState') return !cmd.up;
  return cmd.type in CRITICAL;
}

function describeTarget(cmd: Command): string {
  if ('nodes' in cmd) {
    const n = cmd.nodes;
    if (n === 'all') return t('confirm.target.all');
    if ('rack' in n) return t('confirm.target.rack', { id: n.rack });
    if ('hall' in n) return t('confirm.target.hall', { id: n.hall });
    return t('confirm.target.nodes', { n: n.length });
  }
  if (cmd.type === 'switch.setAdminState') return t('confirm.target.switches', { n: cmd.switches.length });
  if (cmd.type === 'job.cancel') return t('confirm.target.job', { id: cmd.jobId });
  if (cmd.type === 'fault.inject') return cmd.target.kind;
  return '';
}

/** Asks for confirmation when the command is critical and the setting is enabled. */
export function confirmCommand(cmd: Command): Promise<boolean> {
  if (!useSettingsStore.getState().settings.security.confirmCritical || !isCriticalCommand(cmd)) {
    return Promise.resolve(true);
  }
  const key = CRITICAL[cmd.type]!;
  return requestConfirm({
    title: t('confirm.title'),
    body: t('confirm.body', { action: t(key), target: describeTarget(cmd) }),
    confirmLabel: t(key),
  });
}
