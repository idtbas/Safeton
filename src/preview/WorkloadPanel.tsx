import { Rocket, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CATALOG } from '../catalog';
import type { InferencePlan, JobSpec, JobSummary, PlanQueryResult, TrainingPlan } from '../engine';
import { query } from '../os/kernel';
import { useEngineStore } from '../os/engine/store';
import { Badge, Button, Input, KeyValue, Panel, Progress, Select, StatusBadge, Table, Tabs, Toggle, fmt, type Column } from '../ui';
import { JOB_STATE_TONE, run } from './shared';

type Kind = 'training' | 'inference';
const NO_JOBS: JobSummary[] = [];

export function WorkloadPanel() {
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
    [kind, model, gpus, precision, seqLen, batch, tokensB, ckptMin, asyncCkpt, infModel, replicas, tp, infPrecision, rate, inTok, outTok],
  );

  const [plan, setPlan] = useState<PlanQueryResult | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      query({ type: 'plan', job: spec }).then((p) => alive && setPlan(p), () => undefined);
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [spec]);

  const models = CATALOG.models.map((m) => ({ value: m.id, label: m.name }));
  const active = jobs.filter((j) => ['pending', 'initializing', 'running', 'checkpointing', 'restarting'].includes(j.state)).length;

  return (
    <Panel title="Workloads" subtitle={`${active} active · ${jobs.length} listed`} icon={<Rocket size={14} />} flush>
      <div className="pv-workloads">
        <div className="pv-workloads__form">
          <Tabs<Kind>
            items={[
              { id: 'training', label: 'Training' },
              { id: 'inference', label: 'Inference' },
            ]}
            value={kind}
            onChange={setKind}
            label="Workload type"
          />
          {kind === 'training' ? (
            <div className="pv-form-grid">
              <Select label="Model" value={model} options={models} onChange={setModel} />
              <Input label="GPUs" type="number" min={gpusPerNode} step={gpusPerNode} value={gpus} onChange={(e) => setGpus(Number(e.target.value))} hint={`of ${totalGpus.toLocaleString()}`} mono />
              <Select label="Precision" value={precision} options={[{ value: 'bf16', label: 'BF16' }, { value: 'fp8', label: 'FP8 (hybrid)' }]} onChange={setPrecision} />
              <Input label="Sequence length" type="number" value={seqLen} onChange={(e) => setSeqLen(Number(e.target.value))} mono />
              <Input label="Global batch" type="number" value={batch} onChange={(e) => setBatch(Number(e.target.value))} suffix="seq" mono />
              <Input label="Token target" type="number" value={tokensB} onChange={(e) => setTokensB(Number(e.target.value))} suffix="B" mono />
              <Input label="Checkpoint every" type="number" value={ckptMin} onChange={(e) => setCkptMin(Number(e.target.value))} suffix="min" mono />
              <div className="pv-form-grid__toggle">
                <Toggle checked={asyncCkpt} onChange={setAsyncCkpt} label="Async checkpoint" />
              </div>
            </div>
          ) : (
            <div className="pv-form-grid">
              <Select label="Model" value={infModel} options={models} onChange={setInfModel} />
              <Input label="Replicas" type="number" min={1} value={replicas} onChange={(e) => setReplicas(Number(e.target.value))} mono />
              <Select
                label="Tensor parallel"
                value={String(tp)}
                options={[1, 2, 4, 8].filter((x) => x <= gpusPerNode).map((x) => ({ value: String(x), label: `TP${x}` }))}
                onChange={(v) => setTp(Number(v))}
              />
              <Select label="Precision" value={infPrecision} options={[{ value: 'fp8', label: 'FP8' }, { value: 'bf16', label: 'BF16' }]} onChange={setInfPrecision} />
              <Input label="Offered load" type="number" value={rate} onChange={(e) => setRate(Number(e.target.value))} suffix="req/s" mono />
              <Input label="Input tokens" type="number" value={inTok} onChange={(e) => setInTok(Number(e.target.value))} mono />
              <Input label="Output tokens" type="number" value={outTok} onChange={(e) => setOutTok(Number(e.target.value))} mono />
            </div>
          )}
          <PlanSummary plan={plan} />
          <Button variant="primary" icon={<Rocket size={14} />} disabled={!plan?.ok} onClick={() => void run({ type: 'job.submit', job: spec }, true)}>
            Submit job
          </Button>
        </div>
        <div className="pv-workloads__jobs">
          <JobsTable jobs={jobs} />
        </div>
      </div>
    </Panel>
  );
}

function PlanSummary({ plan }: { plan: PlanQueryResult | null }) {
  if (!plan) return <div className="pv-plan sf-muted">Planning…</div>;
  if (!plan.ok)
    return (
      <div className="pv-plan pv-plan--error">
        <StatusBadge tone="critical" label={plan.code} />
        <p>{plan.message}</p>
      </div>
    );
  const p = plan.plan;
  if ('dp' in p) {
    const t = p as TrainingPlan;
    return (
      <div className="pv-plan">
        <div className="sf-label">Auto-planner (nominal, healthy fabric)</div>
        <KeyValue
          items={[
            ['Layout', `TP${t.tp} · PP${t.pp}${t.interleave > 1 ? ` (v${t.interleave})` : ''} · DP${t.dp} · ${t.recompute} recompute`],
            ['Memory / GPU', `${fmt.formatNumber(t.memoryGB.total, 1, 1)} / ${t.hbmGB} GB`],
            ['Step time', `${fmt.formatNumber(t.nominalStepS, 2, 2)} s · bubble ${fmt.percent(t.bubbleFraction)}`],
            ['MFU', fmt.percent(t.nominalMfu)],
            ['Throughput', `${fmt.compact(t.tokensPerStep / t.nominalStepS)} tok/s`],
            ['Duration', fmt.duration(t.totalSteps * t.nominalStepS)],
            ['Checkpoint', fmt.q(fmt.bytesGB(t.checkpointGB))],
          ]}
        />
      </div>
    );
  }
  const i = p as InferencePlan;
  return (
    <div className="pv-plan">
      <div className="sf-label">Serving plan</div>
      <KeyValue
        items={[
          ['Nodes', `${i.nodes} (${i.replicasPerNode} replica/node)`],
          ['Weights / GPU', fmt.q(fmt.bytesGB(i.weightsGBPerGpu))],
          ['KV capacity', `${fmt.compact(i.kvCapacityTokensPerReplica)} tokens/replica`],
          ['Max concurrency', `${i.maxConcurrentPerReplica} seq/replica`],
          ['Prefill', `${fmt.formatNumber((i.prefillSecondsPerRequest * 1000), 0, 0)} ms/request`],
          ['Decode floor', `${fmt.formatNumber((i.minDecodeStepS * 1000), 1, 1)} ms/token`],
          ['Peak throughput', `${fmt.compact(i.maxThroughputTokS)} tok/s`],
        ]}
      />
    </div>
  );
}

function JobsTable({ jobs }: { jobs: JobSummary[] }) {
  const columns: Column<JobSummary>[] = [
    { id: 'id', header: 'Job', width: '64px', cell: (j) => <span className="mono">{j.id}</span>, sortValue: (j) => j.id },
    {
      id: 'name',
      header: 'Name',
      width: 'minmax(150px, 1.4fr)',
      cell: (j) => (
        <span title={j.reason ?? undefined} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {j.name} <span className="sf-muted">· {j.kind}</span>
        </span>
      ),
    },
    { id: 'state', header: 'State', width: '124px', cell: (j) => <StatusBadge tone={JOB_STATE_TONE[j.state]} label={j.state} pulse={j.state === 'initializing' || j.state === 'checkpointing'} /> },
    { id: 'gpus', header: 'GPUs', width: '64px', align: 'right', cell: (j) => j.gpus.toLocaleString(), sortValue: (j) => j.gpus },
    {
      id: 'progress',
      header: 'Progress',
      width: 'minmax(120px, 1fr)',
      cell: (j) =>
        j.kind === 'training' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <div style={{ flex: 1 }}>
              <Progress value={j.progress} thin label={`Job ${j.id} progress`} />
            </div>
            <span className="mono sf-muted" style={{ fontSize: 'var(--fs-xs)' }}>
              {fmt.percent(j.progress, 1)}
            </span>
          </div>
        ) : (
          <span className="sf-muted">{fmt.formatNumber(j.metrics.servedRps, 1, 1)} req/s · SLO {fmt.percent(j.metrics.sloAttainment, 0)}</span>
        ),
    },
    {
      id: 'perf',
      header: 'Performance',
      width: '170px',
      cell: (j) =>
        j.kind === 'training' ? (
          <span className="mono">
            MFU {fmt.percent(j.metrics.mfu)} · {fmt.formatNumber(j.metrics.stepTimeS, 1, 1)}s
          </span>
        ) : (
          <span className="mono">
            TTFT {fmt.formatNumber((j.metrics.ttftS * 1000), 0, 0)}ms · {fmt.formatNumber((j.metrics.tpotS * 1000), 0, 0)}ms/t
          </span>
        ),
    },
    { id: 'restarts', header: 'Rst', width: '44px', align: 'right', cell: (j) => (j.restarts ? <Badge tone="serious">{j.restarts}</Badge> : <span className="sf-muted">0</span>) },
    { id: 'goodput', header: 'Goodput', width: '72px', align: 'right', cell: (j) => fmt.percent(j.goodput, 1), sortValue: (j) => j.goodput },
    { id: 'eta', header: 'ETA', width: '78px', align: 'right', cell: (j) => (j.etaS !== null && j.state !== 'completed' ? fmt.duration(j.etaS) : '—') },
    {
      id: 'actions',
      header: '',
      width: '40px',
      cell: (j) =>
        ['pending', 'initializing', 'running', 'checkpointing', 'restarting'].includes(j.state) ? (
          <Button size="sm" variant="ghost" iconOnly icon={<Square size={12} />} aria-label={`Cancel job ${j.id}`} title="Cancel job" onClick={() => void run({ type: 'job.cancel', jobId: j.id })} />
        ) : null,
    },
  ];
  return <Table rows={jobs} columns={columns} rowKey={(j) => j.id} empty="No jobs submitted yet" label="Jobs" />;
}
