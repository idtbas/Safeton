import { afterEach, describe, expect, it } from 'vitest';
import { answerConfirm, confirmCommand, isCriticalCommand, useConfirmStore } from './confirm';
import { defaultSettings, mergeSettings } from './settings/schema';
import { useSettingsStore } from './settings/store';

describe('confirmation of critical commands', () => {
  afterEach(() => useSettingsStore.getState().replace(defaultSettings()));

  it('classifies disruptive commands as critical', () => {
    expect(isCriticalCommand({ type: 'node.powerOff', nodes: 'all' })).toBe(true);
    expect(isCriticalCommand({ type: 'job.cancel', jobId: 1 })).toBe(true);
    expect(isCriticalCommand({ type: 'node.maintenance', nodes: [1], enter: true })).toBe(true);
    expect(isCriticalCommand({ type: 'node.maintenance', nodes: [1], enter: false })).toBe(false);
    expect(isCriticalCommand({ type: 'switch.setAdminState', switches: [0], up: true })).toBe(false);
    expect(isCriticalCommand({ type: 'node.powerOn', nodes: 'all' })).toBe(false);
  });

  it('asks before critical commands and honours the answer', async () => {
    const pending = confirmCommand({ type: 'node.reboot', nodes: { rack: 'H1-A01' } });
    expect(useConfirmStore.getState().pending?.body).toContain('H1-A01');
    answerConfirm(false);
    expect(await pending).toBe(false);
    const again = confirmCommand({ type: 'node.reboot', nodes: [1, 2] });
    answerConfirm(true);
    expect(await again).toBe(true);
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  it('skips the dialog when disabled in the security settings', async () => {
    useSettingsStore
      .getState()
      .replace(mergeSettings(defaultSettings(), { security: { confirmCritical: false } }));
    expect(await confirmCommand({ type: 'node.powerOff', nodes: 'all' })).toBe(true);
    expect(useConfirmStore.getState().pending).toBeNull();
  });
});
