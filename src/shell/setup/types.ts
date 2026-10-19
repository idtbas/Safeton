import type { Dispatch } from 'react';
import type { ValidationReport } from '../../engine';
import type { MessageKey, Translate } from '../../os/i18n';
import type { SetupAction, SetupData, StepErrors } from '../../os/setup/model';

export interface StepProps {
  data: SetupData;
  update: (fn: (data: SetupData) => SetupData) => void;
  dispatch: Dispatch<SetupAction>;
  errors: StepErrors;
  t: Translate;
  /** Translated error for a field, if any. */
  err: (field: string) => string | undefined;
  /** Registers an async guard that runs before advancing (e.g. key derivation). */
  setBeforeNext: (fn: (() => Promise<boolean>) | null) => void;
  /** Jump to a step (summary / validation links). */
  goto: (step: number) => void;
  /** Debounced engineering validation of the current design. */
  design: { report: ValidationReport; pending: boolean };
  /** Index of the step being shown. */
  current: number;
}

export const msg = (t: Translate, key: string | undefined) => (key ? t(key as MessageKey) : undefined);
