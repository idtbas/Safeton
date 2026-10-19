import { describe, expect, it } from 'vitest';
import { INITIAL_SHELL, transition, type ShellEvent, type ShellState } from './machine';

const run = (events: ShellEvent[], from: ShellState = INITIAL_SHELL) => events.reduce(transition, from);

describe('shell state machine', () => {
  it('runs the first-start path: firmware → kernel → setup → initialisation → infrastructure → login', () => {
    const s = run([
      { type: 'FIRMWARE_DONE' },
      { type: 'CORE_READY', setupRequired: true },
      { type: 'SETUP_SUBMITTED' },
      { type: 'INITIALIZED' },
      { type: 'INFRA_READY' },
    ]);
    expect(s.phase).toBe('login');
  });

  it('skips the setup when the configuration is committed', () => {
    const s = run([{ type: 'FIRMWARE_DONE' }, { type: 'CORE_READY', setupRequired: false }]);
    expect(s.phase).toBe('infrastructure');
  });

  it('handles sign-in, lock, unlock and sign-out', () => {
    const login = run([
      { type: 'FIRMWARE_DONE' },
      { type: 'CORE_READY', setupRequired: false },
      { type: 'INFRA_READY' },
    ]);
    const ws = transition(login, { type: 'AUTHENTICATED', username: 'ada' });
    expect(ws).toMatchObject({ phase: 'workspace', user: 'ada' });
    const locked = transition(ws, { type: 'LOCK' });
    expect(locked).toMatchObject({ phase: 'locked', user: 'ada' });
    expect(transition(locked, { type: 'UNLOCKED' }).phase).toBe('workspace');
    expect(transition(locked, { type: 'LOGOUT' })).toMatchObject({ phase: 'login', user: null });
  });

  it('shuts down from the session phases only', () => {
    const login = run([
      { type: 'FIRMWARE_DONE' },
      { type: 'CORE_READY', setupRequired: false },
      { type: 'INFRA_READY' },
    ]);
    const ws = transition(login, { type: 'AUTHENTICATED', username: 'ada' });
    expect(transition(ws, { type: 'SHUTDOWN' })).toMatchObject({ phase: 'off', user: null });
    expect(transition(login, { type: 'SHUTDOWN' }).phase).toBe('off');
    expect(transition(INITIAL_SHELL, { type: 'SHUTDOWN' })).toBe(INITIAL_SHELL);
  });

  it('rejects transitions that are not defined for the current phase', () => {
    expect(transition(INITIAL_SHELL, { type: 'AUTHENTICATED', username: 'x' })).toBe(INITIAL_SHELL);
    const setup = run([{ type: 'FIRMWARE_DONE' }, { type: 'CORE_READY', setupRequired: true }]);
    expect(transition(setup, { type: 'INFRA_READY' })).toBe(setup);
    expect(transition(setup, { type: 'LOCK' })).toBe(setup);
  });

  it('records failures with their phase and restarts cleanly', () => {
    const failed = run([{ type: 'FIRMWARE_DONE' }, { type: 'FAIL', error: 'storage broken' }]);
    expect(failed).toMatchObject({ phase: 'error', error: 'storage broken', failedIn: 'kernel' });
    expect(transition(failed, { type: 'RESTART' })).toEqual(INITIAL_SHELL);
  });
});
