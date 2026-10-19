/**
 * First-run setup assistant (13 steps). The draft is persisted after every change, so a reload
 * resumes at the last step; navigation and validation run through the pure `setupReducer`.
 */
import { ArrowLeft, ArrowRight, Check, Cloud, Loader2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ComponentType } from 'react';
import { useT, type MessageKey } from '../../os/i18n';
import { loadSetupDraft, saveSetupDraft } from '../../os/kernel';
import { applyAppearance, useSettingsStore } from '../../os/settings/store';
import type { ShellEvent, ShellPhase } from '../../os/shell/machine';
import {
  SETUP_STEPS,
  createDraft,
  reachableStep,
  setupReducer,
  validateStep,
  type SetupData,
  type SetupDraft,
  type SetupState,
  type SetupStepId,
} from '../../os/setup/model';
import { Button, Select, Stepper, fmt } from '../../ui';
import { BrandMark } from '../boot/BootScreen';
import { LiveDesignPanel } from './LiveDesignPanel';
import { LOCALES } from './locales';
import { AdminStep, AppearanceStep, RegionStep, SystemStep, WelcomeStep } from './steps/basic';
import { HardwareStep, NetworkStep, ProfileStep, SiteStep } from './steps/infra';
import { InitializeStep, MonitoringStep, OperationsStep, SummaryStep } from './steps/review';
import { msg, type StepProps } from './types';
import { useDesignReport } from './useDesignReport';

const STEP_COMPONENTS: Record<Exclude<SetupStepId, 'initialize'>, ComponentType<StepProps>> = {
  welcome: WelcomeStep,
  region: RegionStep,
  admin: AdminStep,
  system: SystemStep,
  appearance: AppearanceStep,
  profile: ProfileStep,
  hardware: HardwareStep,
  network: NetworkStep,
  site: SiteStep,
  monitoring: MonitoringStep,
  operations: OperationsStep,
  summary: SummaryStep,
};

/** Steps that show the live engineering check beside the form. */
const LIVE_STEPS: SetupStepId[] = ['profile', 'hardware', 'network', 'site'];
const SUMMARY = SETUP_STEPS.indexOf('summary');
const INITIALIZE = SETUP_STEPS.indexOf('initialize');
const SAVE_DEBOUNCE_MS = 300;

export function SetupWizard({ phase, send }: { phase: ShellPhase; send: (e: ShellEvent) => void }) {
  const [initial, setInitial] = useState<{ draft: SetupDraft; resumed: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadSetupDraft()
      .catch(() => null)
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          // An interrupted initialisation resumes at the review (nothing was committed).
          const current = saved.current === INITIALIZE && phase === 'setup' ? SUMMARY : saved.current;
          setInitial({ draft: { ...saved, current }, resumed: saved.completed.length > 0 });
        } else setInitial({ draft: createDraft(), resumed: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);
  if (!initial)
    return (
      <div className="sh-setup-stage">
        <div className="os-wallpaper" data-wallpaper="nebula" aria-hidden />
      </div>
    );
  return <Wizard initial={initial.draft} resumed={initial.resumed} phase={phase} send={send} />;
}

function Wizard({
  initial,
  resumed,
  phase,
  send,
}: {
  initial: SetupDraft;
  resumed: boolean;
  phase: ShellPhase;
  send: (e: ShellEvent) => void;
}) {
  const [state, dispatch] = useReducer(setupReducer, { draft: initial, errors: {} } satisfies SetupState);
  const { draft, errors } = state;
  const { data } = draft;
  const step = SETUP_STEPS[draft.current]!;
  const t = useT(data.region.locale);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showResumed, setShowResumed] = useState(resumed);
  const beforeNext = useRef<(() => Promise<boolean>) | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const design = useDesignReport(data);

  // Regional formatting and appearance follow the draft live (preview of the final system).
  fmt.configureFormatting(data.region);
  useEffect(() => {
    applyAppearance({ ...useSettingsStore.getState().settings, appearance: data.appearance });
  }, [data.appearance]);
  useEffect(() => {
    document.documentElement.lang = data.region.locale.slice(0, 2);
  }, [data.region.locale]);

  // Persist the draft (debounced) while the setup is being edited.
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
    if (phase !== 'setup') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflects the pending save in the footer
    setSaved('saving');
    const timer = setTimeout(() => {
      void saveSetupDraft(draft).then(() => setSaved('saved'));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, phase]);
  useEffect(() => {
    if (phase !== 'setup') return;
    const flush = () => void saveSetupDraft(latest.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [phase]);

  // Move focus to the step heading for keyboard and screen-reader users.
  const currentStep = draft.current;
  const shownStep = useRef(currentStep);
  useEffect(() => {
    if (shownStep.current === currentStep) return;
    shownStep.current = currentStep;
    headingRef.current?.focus();
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [currentStep]);

  // Focus the first invalid field after a rejected "continue".
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const goto = useCallback((s: number) => dispatch({ type: 'goto', step: s }), []);
  const update = useCallback(
    (fn: (d: SetupData) => SetupData) => dispatch({ type: 'update', update: fn }),
    [],
  );
  const setBeforeNext = useCallback((fn: (() => Promise<boolean>) | null) => {
    beforeNext.current = fn;
  }, []);

  // Live field validation for the design steps (debounced engineering check runs separately).
  const liveErrors = useMemo(
    () => (step === 'hardware' || step === 'network' || step === 'site' ? validateStep(step, data) : {}),
    [step, data],
  );
  const shownErrors = useMemo(() => ({ ...liveErrors, ...errors }), [liveErrors, errors]);
  const err = useCallback((field: string) => msg(t, shownErrors[field]), [t, shownErrors]);

  const next = async () => {
    if (busy) return;
    setShowResumed(false);
    if (beforeNext.current) {
      setBusy(true);
      try {
        if (!(await beforeNext.current())) return;
      } finally {
        setBusy(false);
      }
    }
    if (step === 'summary') {
      if (Object.keys(validateStep('summary', data)).length > 0) return;
      dispatch({ type: 'next' });
      send({ type: 'SETUP_SUBMITTED' });
      return;
    }
    dispatch({ type: 'next' });
  };

  const onInitialized = useCallback(() => send({ type: 'INITIALIZED' }), [send]);

  const props: StepProps = {
    data,
    update,
    dispatch,
    errors: shownErrors,
    t,
    err,
    setBeforeNext,
    goto,
    design,
    current: draft.current,
  };
  const Step = step === 'initialize' ? null : STEP_COMPONENTS[step];
  const live = LIVE_STEPS.includes(step);
  const summaryBlocked = step === 'summary' && (design.report.errors > 0 || design.pending);
  const hasErrors = Object.keys(errors).length > 0;
  const reachable = phase === 'setup' ? Math.min(reachableStep(draft), SUMMARY) : -1;

  return (
    <div className="sh-setup-stage">
      <div className="os-wallpaper" data-wallpaper="nebula" aria-hidden />
      <div className="sh-setup" role="dialog" aria-label={t('setup.title')}>
        <div className="sh-setup__titlebar" aria-hidden>
          <BrandMark size={14} />
          <span>{t('setup.windowTitle')}</span>
        </div>
        <aside className="sh-setup__side">
          <Stepper
            label={t('ui.stepper.label')}
            doneLabel={t('ui.stepper.done')}
            currentLabel={t('ui.stepper.current')}
            current={draft.current}
            completed={draft.completed}
            reachable={reachable}
            onSelect={phase === 'setup' ? goto : undefined}
            items={SETUP_STEPS.map((s) => ({
              id: s,
              title: t(`setup.step.${s}.title` as MessageKey),
              description: t(`setup.step.${s}.desc` as MessageKey),
            }))}
          />
          <p className="sh-setup__notice sf-muted">{t('common.simulationNotice')}</p>
        </aside>

        <main className="sh-setup__main">
          <header className="sh-setup__header">
            <div className="sh-setup__heading">
              <span className="sf-label">
                {t('setup.stepOf', { n: draft.current + 1, total: SETUP_STEPS.length })}
              </span>
              <h1 ref={headingRef} tabIndex={-1}>
                {t(`setup.step.${step}.title` as MessageKey)}
              </h1>
              <p className="sf-secondary">{t(`setup.step.${step}.desc` as MessageKey)}</p>
            </div>
            {phase === 'setup' && (
              <div className="sh-setup__lang">
                <Select
                  aria-label={t('setup.region.language')}
                  value={data.region.locale}
                  options={LOCALES}
                  onChange={(locale) => update((d) => ({ ...d, region: { ...d.region, locale } }))}
                />
              </div>
            )}
          </header>

          <div className="sh-setup__body" ref={bodyRef}>
            <form
              className="sh-setup__form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!summaryBlocked) void next();
              }}
            >
              {showResumed && (
                <p className="sh-note" data-tone="info" role="status">
                  <RotateCcw size={14} /> {t('setup.resumed')}
                </p>
              )}
              {hasErrors && (
                <p className="sh-note" data-tone="critical" role="alert">
                  {t('setup.fixErrors')}
                </p>
              )}
              {Step ? <Step {...props} /> : <InitializeStep {...props} onDone={onInitialized} />}
              {/* Enter in any field submits the step. */}
              <button type="submit" hidden tabIndex={-1} aria-hidden />
            </form>
            {live && (
              <LiveDesignPanel
                report={design.report}
                pending={design.pending}
                t={t}
                goto={goto}
                current={draft.current}
              />
            )}
          </div>

          {step !== 'initialize' && (
            <footer className="sh-setup__footer">
              <Button
                variant="ghost"
                icon={<ArrowLeft size={14} />}
                disabled={draft.current === 0 || busy}
                onClick={() => dispatch({ type: 'back' })}
              >
                {t('common.back')}
              </Button>
              <span className="sh-setup__saved sf-muted" role="status" aria-live="polite">
                {saved === 'saving' ? (
                  <Loader2 size={12} className="sh-spin" />
                ) : saved === 'saved' ? (
                  <>
                    <Cloud size={12} /> {t('setup.saved')}
                  </>
                ) : null}
              </span>
              <Button
                variant="primary"
                loading={busy}
                disabled={summaryBlocked}
                icon={step === 'summary' ? <Check size={14} /> : undefined}
                onClick={() => void next()}
              >
                {busy
                  ? t('setup.admin.hashing')
                  : step === 'summary'
                    ? t('setup.finish')
                    : t('common.continue')}
                {step !== 'summary' && !busy && <ArrowRight size={14} />}
              </Button>
            </footer>
          )}
        </main>
      </div>
    </div>
  );
}
