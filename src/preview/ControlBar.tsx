import { Pause, Play, StepForward } from 'lucide-react';
import { setRunning, setTimeScale, stepSimulation } from '../os/kernel';
import { useEngineStore } from '../os/engine/store';
import { useSettingsStore } from '../os/settings/store';
import { Badge, Button, ButtonGroup, Select, Toggle, Tooltip, fmt } from '../ui';

const SCALES = [1, 10, 60, 300, 1800];

export function ControlBar() {
  const snap = useEngineStore((s) => s.snapshot);
  const update = useSettingsStore((s) => s.update);
  if (!snap) return null;
  return (
    <div className="pv-controls">
      <Button
        variant="primary"
        icon={snap.running ? <Pause size={14} /> : <Play size={14} />}
        onClick={() => void setRunning(!snap.running)}
      >
        {snap.running ? 'Pause' : 'Run'}
      </Button>
      <ButtonGroup label="Single step">
        <Tooltip content="Advance one tick (1 simulated second)">
          <Button icon={<StepForward size={14} />} onClick={() => void stepSimulation(1)}>
            1 s
          </Button>
        </Tooltip>
        <Button onClick={() => void stepSimulation(60)}>1 min</Button>
        <Button onClick={() => void stepSimulation(900)}>15 min</Button>
      </ButtonGroup>
      <span className="sf-divider" />
      <span className="sf-label">Time scale</span>
      <ButtonGroup label="Time scale">
        {SCALES.map((s) => (
          <Button key={s} pressed={snap.timeScale === s} onClick={() => void setTimeScale(s)}>
            {s}×
          </Button>
        ))}
      </ButtonGroup>
      <span className="sf-divider" />
      <div style={{ width: 190 }}>
        <Select
          aria-label="Failure rate"
          value={String(snap.failureRateMultiplier)}
          options={[
            { value: '0', label: 'Failures off' },
            { value: '1', label: 'Failures 1× (realistic)' },
            { value: '10', label: 'Failures 10×' },
            { value: '100', label: 'Failures 100×' },
            { value: '1000', label: 'Failures 1000× (chaos)' },
            ...(![0, 1, 10, 100, 1000].includes(snap.failureRateMultiplier)
              ? [{ value: String(snap.failureRateMultiplier), label: `Failures ${snap.failureRateMultiplier}×` }]
              : []),
          ]}
          onChange={(v) => update({ simulation: { failureRateMultiplier: Number(v) } })}
        />
      </div>
      <Toggle
        checked={snap.autoRemediation}
        onChange={(v) => update({ simulation: { autoRemediation: v } })}
        label="Auto-remediation"
      />
      <span style={{ marginLeft: 'auto' }} />
      <span className="sf-muted mono" style={{ fontSize: 'var(--fs-xs)' }}>
        tick {fmt.formatNumber(snap.tick)} · Δt {snap.dt}s
      </span>
      {!snap.running && <Badge tone="warning">Paused</Badge>}
    </div>
  );
}
