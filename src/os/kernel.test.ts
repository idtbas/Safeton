import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { hashPassword } from './auth/credentials';
import {
  authenticate,
  bootCore,
  changePassword,
  completeSetup,
  controlEngine,
  currentAccount,
  infrastructureStartKind,
  loadSetupDraft,
  loginLockoutMs,
  saveSetupDraft,
} from './kernel';
import { useEngineStore } from './engine/store';
import { useSettingsStore } from './settings/store';
import { createDraft, setupReducer } from './setup/model';

describe('kernel: first-run setup and sign-in', () => {
  afterAll(async () => {
    await controlEngine({ running: false });
  });

  it('requires setup on an empty system, commits it and authenticates the administrator', async () => {
    const core = await bootCore();
    expect(core.setupRequired).toBe(true);
    expect(core.account).toBeNull();

    // Draft persisted and resumed through the kernel API.
    const draft = setupReducer({ draft: createDraft(), errors: {} }, { type: 'next' }).draft;
    await saveSetupDraft(draft);
    expect((await loadSetupDraft())?.current).toBe(1);

    const data = {
      ...draft.data,
      admin: {
        displayName: 'Ada Lovelace',
        username: 'ada',
        role: 'infrastructure-admin' as const,
        credential: await hashPassword('Correct-Horse-42!', 1000),
      },
      operations: { ...draft.data.operations, startMode: 'cold' as const },
    };
    const tasks: string[] = [];
    const init = await completeSetup(data, (task, status) => status === 'done' && tasks.push(task));
    expect(tasks).toEqual(['account', 'infra', 'settings', 'engine', 'handover']);
    expect(init.topology.nodes.length).toBe(32);
    expect(infrastructureStartKind()).toBe('cold');
    expect(useSettingsStore.getState().settings.system.setupComplete).toBe(true);
    expect(useEngineStore.getState().status).toBe('ready');
    expect(await loadSetupDraft()).toBeNull();
    expect(currentAccount()?.username).toBe('ada');

    // Wrong passwords: the third consecutive failure imposes a delay.
    for (let i = 0; i < 2; i++)
      expect(await authenticate('ada', 'nope')).toMatchObject({ ok: false, waitMs: 0 });
    expect(await authenticate('ada', 'nope')).toMatchObject({ ok: false, reason: 'invalid', waitMs: 1000 });
    expect(loginLockoutMs()).toBeGreaterThan(0);
    expect(await authenticate('ada', 'Correct-Horse-42!')).toMatchObject({ ok: false, reason: 'lockout' });
    await new Promise((r) => setTimeout(r, 1050));
    const ok = await authenticate(' ADA ', 'Correct-Horse-42!');
    expect(ok.ok).toBe(true);
    expect(loginLockoutMs()).toBe(0);

    // Password change: the current password is verified, the policy enforced.
    expect(await changePassword('Correct-Horse-42!', 'short')).toMatchObject({ ok: false, reason: 'policy' });
    expect(await changePassword('Correct-Horse-42!', 'Another-Secret-77')).toEqual({ ok: true });
    expect((await authenticate('ada', 'Correct-Horse-42!')).ok).toBe(false);
    expect((await authenticate('ada', 'Another-Secret-77')).ok).toBe(true);
  });
});
