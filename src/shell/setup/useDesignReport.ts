import { useEffect, useState } from 'react';
import type { ValidationReport } from '../../engine';
import { validateSetupInfra, type SetupData } from '../../os/setup/model';

/**
 * Debounced engineering validation of the design (live feedback in the hardware, network and
 * site steps). Returns the last report and whether a newer one is pending.
 */
export function useDesignReport(
  data: SetupData,
  delayMs = 250,
): { report: ValidationReport; pending: boolean } {
  const [report, setReport] = useState<ValidationReport>(() => validateSetupInfra(data));
  const [pending, setPending] = useState(false);
  const design = data.infra.design;
  const system = data.system;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the debounced validation as pending
    setPending(true);
    const timer = setTimeout(() => {
      setReport(validateSetupInfra({ ...data, infra: { ...data.infra, design }, system }));
      setPending(false);
    }, delayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the design and naming affect the report
  }, [design, system, delayMs]);
  return { report, pending };
}
