/**
 * Shell state machine: the top-level lifecycle of the operating system UI.
 *
 *   firmware → kernel ─┬─ (setup required) → setup → initializing ─┐
 *                      └──────────────────────────────────────────┴→ infrastructure → login ⇄ workspace ⇄ locked
 *
 * Transitions are a pure function of (phase, event). Unknown transitions are rejected (the
 * phase stays unchanged), so no combination of flags can produce an impossible screen.
 */
import { create } from 'zustand';

export type ShellPhase =
  | 'firmware'
  | 'kernel'
  | 'setup'
  | 'initializing'
  | 'infrastructure'
  | 'login'
  | 'workspace'
  | 'locked'
  | 'error';

export type ShellEvent =
  | { type: 'FIRMWARE_DONE' }
  | { type: 'CORE_READY'; setupRequired: boolean }
  | { type: 'SETUP_SUBMITTED' }
  | { type: 'INITIALIZED' }
  | { type: 'INFRA_READY' }
  | { type: 'AUTHENTICATED'; username: string }
  | { type: 'LOCK' }
  | { type: 'UNLOCKED' }
  | { type: 'LOGOUT' }
  | { type: 'FAIL'; error: string }
  | { type: 'RESTART' };

export interface ShellState {
  phase: ShellPhase;
  /** Signed-in user (workspace / locked). */
  user: string | null;
  error: string | null;
  /** Phase the error occurred in. */
  failedIn: ShellPhase | null;
}

export const INITIAL_SHELL: ShellState = { phase: 'firmware', user: null, error: null, failedIn: null };

export function transition(state: ShellState, event: ShellEvent): ShellState {
  const { phase } = state;
  if (event.type === 'FAIL') return { ...state, phase: 'error', error: event.error, failedIn: phase };
  if (event.type === 'RESTART') return INITIAL_SHELL;
  switch (phase) {
    case 'firmware':
      if (event.type === 'FIRMWARE_DONE') return { ...state, phase: 'kernel' };
      break;
    case 'kernel':
      if (event.type === 'CORE_READY')
        return { ...state, phase: event.setupRequired ? 'setup' : 'infrastructure' };
      break;
    case 'setup':
      if (event.type === 'SETUP_SUBMITTED') return { ...state, phase: 'initializing' };
      break;
    case 'initializing':
      if (event.type === 'INITIALIZED') return { ...state, phase: 'infrastructure' };
      break;
    case 'infrastructure':
      if (event.type === 'INFRA_READY') return { ...state, phase: 'login' };
      break;
    case 'login':
      if (event.type === 'AUTHENTICATED') return { ...state, phase: 'workspace', user: event.username };
      break;
    case 'workspace':
      if (event.type === 'LOCK') return { ...state, phase: 'locked' };
      if (event.type === 'LOGOUT') return { ...state, phase: 'login', user: null };
      break;
    case 'locked':
      if (event.type === 'UNLOCKED') return { ...state, phase: 'workspace' };
      if (event.type === 'LOGOUT') return { ...state, phase: 'login', user: null };
      break;
    case 'error':
      break;
  }
  return state;
}

interface ShellStore extends ShellState {
  send: (event: ShellEvent) => void;
}

export const useShellStore = create<ShellStore>((set, get) => ({
  ...INITIAL_SHELL,
  send: (event) => {
    const { send: _send, ...current } = get();
    const next = transition(current, event);
    if (next !== current) set(next);
  },
}));
