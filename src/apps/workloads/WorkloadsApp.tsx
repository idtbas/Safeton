/**
 * Workload management: plan and submit training and inference jobs (the engine's auto-planner
 * validates parallelism and memory before submission) and operate the running jobs.
 */
import { Rocket, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CATALOG } from '../../catalog';
import type { InferencePlan, JobSpec, JobSummary, PlanQueryResult, TrainingPlan } from '../../engine';
import { useEngineStore } from '../../os/engine/store';
import { useT } from '../../os/i18n';
import { query } from '../../os/kernel';
import {
  Badge,
  Button,
  Input,
  KeyValue,
  Progress,
  Select,
  StatusBadge,
  Table,
  Tabs,
  Toggle,
  fmt,
  type Column,
} from '../../ui';
import { AppFrame, AppStatusBar } from '../common/AppLayout';
import { ACTIVE_JOB_STATES, JOB_STATE_TONE, jobStateKey, run } from '../common/shared';

type Kind = 'training' | 'inference';
const NO_JOBS: JobSummary[] = [];

export function WorkloadsApp() {
  const t = useT();
  const topo = useEngineStore((s) => s.topology);
  const jobs = useEngineStore((s) => s.snapshot?.jobs ?? NO_JOBS);
  const [kind, setKind] = useState<Kind>('training');
  const gpusPerNode = topo?.nodes[0]?.gpus ?? 8;
  const totalGpus = topo?.gpuCount ?? 0;

  const [model, setModel] = useState('llama-3.1-70b');
  const [gpus, setGpus] = useState(() => Math.min(totalGpus, 256));
  const [precision, setPrecision] = useState<'bf16' | 'fp8'>('bf16');
  const [seqLen, setSeqLen] = useState(8192);
  const [batch, setBatch] = useState(512);
  const [tokensB, setTokensB] = useState(100);
  const [ckptMin, setCkptMin] = useState(30);
  const [asyncCkpt, setAsyncCkpt] = useState(true);

  const [infModel, setInfModel] = useState('llama-3.1-70b');
  const [replicas, setReplicas] = useState(2);
  const [tp, setTp] = useState(Math.min(4, gpusPerNode));
  const [infPrecision, setInfPrecision] = useState<'bf16' | 'fp8'>('fp8');
  const [rate, setRate] = useState(20);
  const [inTok, setInTok] = useState(1500);
  const [outTok, setOutTok] = useState(350);

  const spec: JobSpec = useMemo(
    () =>
      kind === 'training'
        ? {
            kind: 'training',
            name: `${model.replace('llama-3.1-', 'llama')}-pretrain`,
            modelId: model,
            gpus,
            precision,
            seqLen,
            globalBatch: batch,
            totalTokens: tokensB * 1e9,
            checkpointIntervalMin: ckptMin,
            asyncCheckpoint: asyncCkpt,
          }
        : {
            kind: 'inference',
            name: `${infModel.replace('llama-3.1-', 'llama')}-serving`,
            modelId: infModel,
            replicas,
            tp,
            precision: infPrecision,
            requestRate: rate,
            avgInputTokens: inTok,
            avgOutputTokens: outTok,
          },
    [
      kind,
      model,
      gpus,
      precision,
      seqLen,
      batch,
      tokensB,
      ckptMin,
      asyncCkpt,
      infModel,
      replicas,
      tp,
      infPrecision,
      rate,
      inTok,
      outTok,
    ],
  );

  const [plan, setPlan] = useState<PlanQueryResult | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      query({ type: 'plan', job: spec }).then(
        (p) => alive && setPlan(p),
        () => undefined,
      );
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [spec]);

  const models = CATALOG.models.map((m) => ({ value: m.id, label: m.name }));
  const active = jobs.filter((j) => ACTIVE_JOB_STATES.includes(j.state)).length;
  const running = jobs.filter((j) => j.state === 'running').length;
  const gpusInUse = jobs.filter((j) => ACTIVE_JOB_STATES.includes(j.state)).reduce((n, j) => n + j.gpus, 0);

  return (
    <AppFrame>
      <div className="ap-workloads">
        <div className="ap-workloads__form">
          <h3 className="ap-pane-title">{t('wl.newJob')}</h3>
          <Tabs<Kind>
            items={[
              { id: 'training', label: t('wl.training') },
              { id: 'inference', label: t('wl.inference') },
            ]}
            value={kind}
            onChange={setKind}
            label={t('wl.type')}
          />
          {kind === 'training' ? (
            <div className="ap-form-grid">
              <Select label={t('wl.model')} value={model} options={models} onChange={setModel} />
              <Input
                label="GPUs"
                type="number"
                min={gpusPerNode}
                step={gpusPerNode}
                value={gpus}
                onChange={(e) => setGpus(Number(e.target.value))}
                hint={t('wl.ofGpus', { n: fmt.formatNumber(totalGpus) })}
                mono
              />
              <Select
                label={t('wl.precision')}
                value={precision}
                options={[
                  { value: 'bf16', label: 'BF16' },
                  { value: 'fp8', label: t('wl.fp8hybrid') },
                ]}
                onChange={setPrecision}
              />
              <Input
                label={t('wl.seqLen')}
                type="number"
                value={seqLen}
                onChange={(e) => setSeqLen(Number(e.target.value))}
                mono
              />
              <Input
                label={t('wl.batch')}
                type="number"
                value={batch}
                onChange={(e) => setBatch(Number(e.target.value))}
                suffix="seq"
                mono
              />
              <Input
                label={t('wl.tokens')}
                type="number"
                value={tokensB}
                onChange={(e) => setTokensB(Number(e.target.value))}
                suffix={t('wl.billion')}
                mono
              />
              <Input
                label={t('wl.ckpt')}
                type="number"
                value={ckptMin}
                onChange={(e) => setCkptMin(Number(e.target.value))}
                suffix="min"
                mono
              />
              <div className="ap-form-grid__toggle">
                <Toggle checked={asyncCkpt} onChange={setAsyncCkpt} label={t('wl.asyncCkpt')} />
              </div>
            </div>
          ) : (
            <div className="ap-form-grid">
              <Select label={t('wl.model')} value={infModel} options={models} onChange={setInfModel} />
              <Input
                label={t('wl.replicas')}
                type="number"
                min={1}
                value={replicas}
                onChange={(e) => setReplicas(Number(e.target.value))}
                mono
              />
              <Select
                label={t('wl.tp')}
                value={String(tp)}
                options={[1, 2, 4, 8]
                  .filter((x) => x <= gpusPerNode)
                  .map((x) => ({ value: String(x), label: `TP${x}` }))}
                onChange={(v) => setTp(Number(v))}
              />
              <Select
                label={t('wl.precision')}
                value={infPrecision}
                options={[
                  { value: 'fp8', label: 'FP8' },
                  { value: 'bf16', label: 'BF16' },
                ]}
                onChange={setInfPrecision}
              />
              <Input
                label={t('wl.load')}
                type="number"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                suffix="req/s"
                mono
              />
              <Input
                label={t('wl.inTokens')}
                type="number"
                value={inTok}
                onChange={(e) => setInTok(Number(e.target.value))}
                mono
              />
              <Input
                label={t('wl.outTokens')}
                type="number"
                value={outTok}
                onChange={(e) => setOutTok(Number(e.target.value))}
                mono
              />
            </div>
          )}
          <PlanSummary plan={plan} />
          <Button
            variant="primary"
            icon={<Rocket size={14} />}
            disabled={!plan?.ok}
            onClick={() => void run({ type: 'job.submit', job: spec }, true)}
          >
            {t('wl.submit')}
          </Button>
        </div>
        <div className="ap-workloads__jobs">
          <JobsTable jobs={jobs} />
        </div>
      </div>
      <AppStatusBar>
        <span>{t('wl.status.active', { n: active })}</span>
        <span>{t('wl.status.running', { n: running })}</span>
        <span>
          {t('wl.status.gpus', { used: fmt.formatNumber(gpusInUse), total: fmt.formatNumber(totalGpus) })}
        </span>
        <span className="ap-statusbar__right">{t('wl.status.listed', { n: jobs.length })}</span>
      </AppStatusBar>
    </AppFrame>
  );
}

function PlanSummary({ plan }: { plan: PlanQueryResult | null }) {
  const t = useT();
  if (!plan) return <div className="ap-plan sf-muted">{t('wl.planning')}</div>;
  if (!plan.ok)
    return (
      <div className="ap-plan ap-plan--error">
        <StatusBadge tone="critical" label={plan.code} />
        <p>{plan.message}</p>
      </div>
    );
  const p = plan.plan;
  if ('dp' in p) {
    const tp = p as TrainingPlan;
    return (
      <div className="ap-plan">
        <div className="sf-label">{t('wl.autoPlanner')}</div>
        <KeyValue
          items={[
            [
              t('wl.plan.layout'),
              `TP${tp.tp} · PP${tp.pp}${tp.interleave > 1 ? ` (v${tp.interleave})` : ''} · DP${tp.dp} · ${tp.recompute} recompute`,
            ],
            [t('wl.plan.memory'), `${fmt.formatNumber(tp.memoryGB.total, 1, 1)} / ${tp.hbmGB} GB`],
            [
              t('wl.plan.step'),
              t('wl.plan.stepValue', {
                s: fmt.formatNumber(tp.nominalStepS, 2, 2),
                bubble: fmt.percent(tp.bubbleFraction, 0),
              }),
            ],
            ['MFU', fmt.percent(tp.nominalMfu)],
            [t('wl.plan.throughput'), `${fmt.compact(tp.tokensPerStep / tp.nominalStepS)} tok/s`],
            [t('wl.plan.duration'), fmt.duration(tp.totalSteps * tp.nominalStepS)],
            [t('wl.plan.checkpoint'), fmt.q(fmt.bytesGB(tp.checkpointGB))],
          ]}
        />
        {tp.notes.map((n) => (
          <p key={n} className="ap-plan__note">
            {n}
          </p>
        ))}
      </div>
    );
  }
  const i = p as InferencePlan;
  return (
    <div className="ap-plan">
      <div className="sf-label">{t('wl.servingPlan')}</div>
      <KeyValue
        items={[
          [t('wl.plan.nodes'), t('wl.plan.nodesValue', { nodes: i.nodes, rpn: i.replicasPerNode })],
          [t('wl.plan.weights'), fmt.q(fmt.bytesGB(i.weightsGBPerGpu))],
          [t('wl.plan.kv'), t('wl.plan.kvValue', { n: fmt.compact(i.kvCapacityTokensPerReplica) })],
          [t('wl.plan.concurrency'), t('wl.plan.concurrencyValue', { n: i.maxConcurrentPerReplica })],
          ['Prefill', `${fmt.formatNumber(i.prefillSecondsPerRequest * 1000, 0, 0)} ms/request`],
          [t('wl.plan.decode'), `${fmt.formatNumber(i.minDecodeStepS * 1000, 1, 1)} ms/token`],
          [t('wl.plan.peak'), `${fmt.compact(i.maxThroughputTokS)} tok/s`],
        ]}
      />
    </div>
  );
}

function JobsTable({ jobs }: { jobs: JobSummary[] }) {
  const t = useT();
  const columns: Column<JobSummary>[] = [
    {
      id: 'id',
      header: t('wl.col.job'),
      width: '64px',
      cell: (j) => <span className="mono">{j.id}</span>,
      sortValue: (j) => j.id,
    },
    {
      id: 'name',
      header: t('wl.col.name'),
      width: 'minmax(150px, 1.4fr)',
      cell: (j) => (
        <span title={j.reason ?? undefined} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {j.name}{' '}
          <span className="sf-muted">· {t(j.kind === 'training' ? 'wl.training' : 'wl.inference')}</span>
        </span>
      ),
    },
    {
      id: 'state',
      header: t('wl.col.state'),
      width: '130px',
      cell: (j) => (
        <StatusBadge
          tone={JOB_STATE_TONE[j.state]}
          label={t(jobStateKey(j.state))}
          pulse={j.state === 'initializing' || j.state === 'checkpointing'}
        />
      ),
    },
    {
      id: 'gpus',
      header: 'GPUs',
      width: '64px',
      align: 'right',
      cell: (j) => fmt.formatNumber(j.gpus),
      sortValue: (j) => j.gpus,
    },
    {
      id: 'progress',
      header: t('wl.col.progress'),
      width: 'minmax(120px, 1fr)',
      cell: (j) =>
        j.kind === 'training' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <div style={{ flex: 1 }}>
              <Progress value={j.progress} thin label={t('wl.progressOf', { id: j.id })} />
            </div>
            <span className="mono sf-muted" style={{ fontSize: 'var(--fs-xs)' }}>
              {fmt.percent(j.progress, 1)}
            </span>
          </div>
        ) : (
          <span className="sf-muted">
            {fmt.formatNumber(j.metrics.servedRps, 1, 1)} req/s · SLO{' '}
            {fmt.percent(j.metrics.sloAttainment, 0)}
          </span>
        ),
    },
    {
      id: 'perf',
      header: t('wl.col.performance'),
      width: '170px',
      cell: (j) =>
        j.kind === 'training' ? (
          <span className="mono">
            MFU {fmt.percent(j.metrics.mfu)} · {fmt.formatNumber(j.metrics.stepTimeS, 1, 1)}s
          </span>
        ) : (
          <span className="mono">
            TTFT {fmt.formatNumber(j.metrics.ttftS * 1000, 0, 0)}ms ·{' '}
            {fmt.formatNumber(j.metrics.tpotS * 1000, 0, 0)}ms/t
          </span>
        ),
    },
    {
      id: 'restarts',
      header: t('wl.col.restarts'),
      width: '44px',
      align: 'right',
      cell: (j) =>
        j.restarts ? <Badge tone="serious">{j.restarts}</Badge> : <span className="sf-muted">0</span>,
    },
    {
      id: 'goodput',
      header: 'Goodput',
      width: '72px',
      align: 'right',
      cell: (j) => fmt.percent(j.goodput, 1),
      sortValue: (j) => j.goodput,
    },
    {
      id: 'eta',
      header: t('wl.col.eta'),
      width: '78px',
      align: 'right',
      cell: (j) => (j.etaS !== null && j.state !== 'completed' ? fmt.duration(j.etaS) : '—'),
    },
    {
      id: 'actions',
      header: '',
      width: '40px',
      cell: (j) =>
        ACTIVE_JOB_STATES.includes(j.state) ? (
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<Square size={12} />}
            aria-label={t('wl.cancelN', { id: j.id })}
            title={t('cmd.job.cancel')}
            onClick={() => void run({ type: 'job.cancel', jobId: j.id })}
          />
        ) : null,
    },
  ];
  return (
    <Table rows={jobs} columns={columns} rowKey={(j) => j.id} empty={t('wl.empty')} label={t('wl.jobs')} />
  );
}
