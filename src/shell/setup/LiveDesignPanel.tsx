import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { ValidationIssue, ValidationReport } from '../../engine';
import type { Translate } from '../../os/i18n';
import { SETUP_STEPS, stepForIssue } from '../../os/setup/model';
import { fmt } from '../../ui';

export function IssueList({
  issues,
  t,
  goto,
  limit = 8,
  current,
}: {
  issues: ValidationIssue[];
  t: Translate;
  goto?: (step: number) => void;
  limit?: number;
  /** Index of the step being shown (no jump link for its own issues). */
  current?: number;
}) {
  const sorted = [...issues].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1,
  );
  const shown = sorted.slice(0, limit);
  return (
    <ul className="sh-issues">
      {shown.map((i, k) => {
        const step = SETUP_STEPS.indexOf(stepForIssue(i));
        return (
          <li key={`${i.code}-${i.path}-${k}`} data-severity={i.severity}>
            {i.severity === 'error' ? (
              <XCircle size={13} aria-label={t('severity.error')} />
            ) : (
              <AlertTriangle size={13} aria-label={t('severity.warning')} />
            )}
            <span className="sh-issues__text">
              <span>{i.message}</span>
              <span className="sh-issues__meta mono">
                {i.code}
                {i.path ? ` · ${i.path}` : ''}
              </span>
            </span>
            {goto && step !== current && (
              <button type="button" className="sh-link" onClick={() => goto(step)}>
                {t('setup.summary.fix', { step: t(`setup.step.${SETUP_STEPS[step]!}.title`) })}
              </button>
            )}
          </li>
        );
      })}
      {sorted.length > shown.length && <li className="sf-muted">+ {sorted.length - shown.length}</li>}
    </ul>
  );
}

export function LiveDesignPanel({
  report,
  pending,
  t,
  goto,
  current,
}: {
  report: ValidationReport;
  pending: boolean;
  t: Translate;
  goto: (step: number) => void;
  current: number;
}) {
  const m = report.metrics;
  const status = pending ? 'pending' : report.errors > 0 ? 'error' : report.warnings > 0 ? 'warning' : 'ok';
  return (
    <aside className="sh-live" aria-label={t('setup.live.title')} aria-busy={pending}>
      <div className="sh-live__head">
        <span className="sf-label">{t('setup.live.title')}</span>
        <span className="sh-live__status" data-status={status} role="status">
          {status === 'pending' ? (
            <>
              <Loader2 size={13} className="sh-spin" /> {t('setup.live.checking')}
            </>
          ) : status === 'error' ? (
            <>
              <XCircle size={13} /> {t('setup.live.errors', { n: report.errors })}
            </>
          ) : (
            <>
              <CheckCircle2 size={13} /> {t('setup.live.ok')}
              {report.warnings > 0 && ` · ${t('setup.live.warnings', { n: report.warnings })}`}
            </>
          )}
        </span>
      </div>
      {m && (
        <dl className="sh-live__metrics">
          <div>
            <dt>{t('setup.live.gpus')}</dt>
            <dd className="num">{fmt.formatNumber(m.counts.gpus)}</dd>
          </div>
          <div>
            <dt>{t('setup.live.bf16')}</dt>
            <dd className="num">{fmt.q(fmt.flops(m.compute.peakDense.bf16 * 1e15))}</dd>
          </div>
          <div>
            <dt>{t('setup.live.itPeak')}</dt>
            <dd className="num">{fmt.q(fmt.power(m.power.itPeakKW * 1000))}</dd>
          </div>
          <div>
            <dt>{t('setup.live.facility')}</dt>
            <dd className="num">{fmt.q(fmt.power(m.power.facilityPeakKW * 1000))}</dd>
          </div>
          <div>
            <dt>{t('setup.live.pue')}</dt>
            <dd className="num">{fmt.formatNumber(m.power.pueAnnual, 2, 2)}</dd>
          </div>
          <div>
            <dt>{t('setup.live.capex')}</dt>
            <dd className="num">{fmt.currency(m.cost.totalUsd, 'USD')}</dd>
          </div>
        </dl>
      )}
      {report.issues.length > 0 && (
        <IssueList issues={report.issues} t={t} goto={goto} current={current} limit={6} />
      )}
    </aside>
  );
}
