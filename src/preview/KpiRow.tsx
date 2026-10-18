import { useEngineStore } from '../os/engine/store';
import { MetricTile, fmt } from '../ui';

const tail = (arr: number[] | undefined, n = 120) => (arr ? arr.slice(Math.max(0, arr.length - n)) : []);

export function KpiRow() {
  const snap = useEngineStore((s) => s.snapshot);
  const series = useEngineStore((s) => s.series);
  if (!snap) return null;
  const f = snap.facility;
  const c = snap.cluster;
  const it = fmt.power(f.itPowerW);
  const fac = fmt.power(f.facilityPowerW);
  const net = fmt.bandwidthGbps(c.fabricTrafficGbps);
  const pf = c.achievedPflops;
  const tok = fmt.count(c.trainingTokensPerSec + c.inferenceTokensPerSec);
  return (
    <div className="pv-kpis">
      <MetricTile
        label="IT load"
        value={it.value}
        unit={it.unit}
        trend={tail(series.itPowerW)}
        trendFormat={(v) => fmt.q(fmt.power(v))}
        foot={`GPUs ${fmt.q(fmt.power(c.gpuPowerW))}`}
      />
      <MetricTile
        label="Facility load"
        value={fac.value}
        unit={fac.unit}
        trend={tail(series.facilityPowerW)}
        trendFormat={(v) => fmt.q(fmt.power(v))}
        foot={`Cooling ${fmt.q(fmt.power(f.coolingPowerW))}`}
      />
      <MetricTile
        label="PUE"
        value={fmt.formatNumber(f.pue, 3, 3)}
        trend={tail(series.pue)}
        trendFormat={(v) => fmt.formatNumber(v, 3, 3)}
        foot={`Ambient ${fmt.temperature(f.ambientC)} · free cooling ${fmt.percent(Math.max(f.freeCoolingChilled, f.freeCoolingWarm), 0)}`}
      />
      <MetricTile
        label="GPU utilisation"
        value={fmt.formatNumber(c.gpuUtilAvg * 100, 1, 1)}
        unit="%"
        trend={tail(series.gpuUtil)}
        trendFormat={(v) => fmt.percent(v)}
        foot={`${c.gpusAllocated.toLocaleString()} / ${c.gpusTotal.toLocaleString()} allocated`}
      />
      <MetricTile
        label="GPU temperature"
        value={fmt.formatNumber(c.gpuTempAvg, 1, 1)}
        unit="°C avg"
        trend={tail(series.gpuTempMax)}
        trendFormat={(v) => `max ${fmt.temperature(v)}`}
        trendColor="var(--series-2)"
        foot={`max ${fmt.temperature(c.gpuTempMax)} · ${c.throttledGpus} throttled`}
      />
      <MetricTile
        label="Fabric throughput"
        value={net.value}
        unit={net.unit}
        trend={tail(series.fabricGbps)}
        trendFormat={(v) => fmt.q(fmt.bandwidthGbps(v))}
        foot={`${fmt.percent(c.fabricCapacityGbps > 0 ? c.fabricTrafficGbps / c.fabricCapacityGbps : 0)} of injection · ${c.switchesDown} switch down`}
      />
      <MetricTile
        label="Tokens / s"
        value={tok.value}
        unit={tok.unit}
        trend={tail(series.trainTokS)}
        trendFormat={(v) => `train ${fmt.compact(v)}/s`}
        foot={`train ${fmt.compact(c.trainingTokensPerSec)} · infer ${fmt.compact(c.inferenceTokensPerSec)}`}
      />
      <MetricTile
        label="Achieved compute"
        value={fmt.formatNumber(pf, pf >= 100 ? 0 : 1, pf >= 100 ? 0 : 1)}
        unit="PFLOP/s"
        trend={tail(series.achievedPflops)}
        trendFormat={(v) => `${fmt.formatNumber(v, 1, 1)} PF/s`}
        foot={`Energy ${fmt.q(fmt.energyWh(f.energyMWh * 1e6))} · ${fmt.currency(f.energyCostEur)}`}
      />
    </div>
  );
}
