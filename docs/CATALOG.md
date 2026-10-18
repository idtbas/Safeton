# Hardwarekatalog — Werte und Quellenkategorien

> Automatisch erzeugt aus `src/catalog` (Katalogversion 2026.10.1) mit `npm run docs:catalog`. Nicht von Hand bearbeiten.

Jeder Zahlenwert im Katalog trägt eine Quellenkategorie:

- **Hersteller** — veröffentlichter Herstellerwert (Datenblatt, Spec-Sheet, Produktbeschreibung). Werte mit dem Hinweis „total / N“ sind aus System- bzw. Rack-Gesamtwerten abgeleitet.
- **Schätzung** — nicht offiziell veröffentlicht; abgeleitet aus öffentlichen Messungen, Branchenberichten oder vergleichbaren Produkten.
- **Annahme** — Modellparameter der Simulation; plausibel, aber keine nachschlagbare Eigenschaft realer Hardware.

Umfang: 75 Einträge, 548 Werte — 196 Hersteller, 308 Schätzung, 44 Annahme.

## GPUs

### A100 SXM4 80GB `nvidia-a100-sxm4-80gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| boostClockMHz | 1,410 | Hersteller |  |
| peak.fp64 | 9.7 | Hersteller |  |
| peak.fp64Tensor | 19.5 | Hersteller |  |
| peak.tf32.dense | 156 | Hersteller |  |
| peak.tf32.sparse | 312 | Hersteller |  |
| peak.bf16.dense | 312 | Hersteller |  |
| peak.bf16.sparse | 624 | Hersteller |  |
| peak.fp16.dense | 312 | Hersteller |  |
| peak.fp16.sparse | 624 | Hersteller |  |
| peak.int8.dense | 624 | Hersteller |  |
| peak.int8.sparse | 1,248 | Hersteller |  |
| memory.capacityGB | 80 | Hersteller |  |
| memory.bandwidthGBs | 2,039 | Hersteller |  |
| interconnect.bandwidthGBs | 600 | Hersteller |  |
| power.tdpW | 400 | Hersteller |  |
| power.idleW | 52 | Schätzung |  |
| power.minPowerLimitW | 100 | Hersteller |  |
| thermal.slowdownC | 87 | Schätzung | nvidia-smi "GPU Slowdown Temp" on typical A100 SXM4 boards |
| thermal.shutdownC | 92 | Schätzung |  |
| thermal.hbmMaxC | 95 | Schätzung |  |
| thermal.air.rthKW | 0.11 | Annahme |  |
| thermal.air.heatCapacityJK | 380 | Annahme |  |
| thermal.liquid.rthKW | 0.07 | Annahme |  |
| thermal.liquid.heatCapacityJK | 240 | Annahme |  |
| kernelEfficiency | 0.62 | Annahme | Mature CUDA/cuBLAS stack; large GEMM share of training step |
| hbmEfficiency | 0.8 | Annahme |  |
| afr | 0.06 | Schätzung |  |
| costUsd | 12,000 | Schätzung | 2025 secondary-market level |

### H100 SXM5 80GB `nvidia-h100-sxm5-80gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| boostClockMHz | 1,980 | Hersteller |  |
| peak.fp64 | 34 | Hersteller |  |
| peak.fp64Tensor | 67 | Hersteller |  |
| peak.tf32.dense | 494.7 | Hersteller |  |
| peak.tf32.sparse | 989.4 | Hersteller |  |
| peak.bf16.dense | 989.4 | Hersteller |  |
| peak.bf16.sparse | 1978.9 | Hersteller |  |
| peak.fp16.dense | 989.4 | Hersteller |  |
| peak.fp16.sparse | 1978.9 | Hersteller |  |
| peak.fp8.dense | 1978.9 | Hersteller |  |
| peak.fp8.sparse | 3957.8 | Hersteller |  |
| peak.int8.dense | 1978.9 | Hersteller |  |
| peak.int8.sparse | 3957.8 | Hersteller |  |
| memory.capacityGB | 80 | Hersteller |  |
| memory.bandwidthGBs | 3,352 | Hersteller |  |
| interconnect.bandwidthGBs | 900 | Hersteller |  |
| power.tdpW | 700 | Hersteller |  |
| power.idleW | 70 | Schätzung |  |
| power.minPowerLimitW | 200 | Hersteller |  |
| thermal.slowdownC | 87 | Schätzung |  |
| thermal.shutdownC | 92 | Schätzung |  |
| thermal.hbmMaxC | 95 | Schätzung |  |
| thermal.air.rthKW | 0.072 | Annahme |  |
| thermal.air.heatCapacityJK | 560 | Annahme |  |
| thermal.liquid.rthKW | 0.045 | Annahme |  |
| thermal.liquid.heatCapacityJK | 330 | Annahme |  |
| kernelEfficiency | 0.58 | Annahme | Calibrated so 70B-class dense training lands at ~40–48 % MFU |
| hbmEfficiency | 0.8 | Annahme |  |
| afr | 0.09 | Schätzung | Derived from published large-scale training interruption statistics (GPU + HBM faults) |
| costUsd | 27,500 | Schätzung |  |

### H200 SXM5 141GB `nvidia-h200-sxm5-141gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| boostClockMHz | 1,980 | Hersteller |  |
| peak.fp64 | 34 | Hersteller |  |
| peak.fp64Tensor | 67 | Hersteller |  |
| peak.tf32.dense | 494.7 | Hersteller |  |
| peak.tf32.sparse | 989.4 | Hersteller |  |
| peak.bf16.dense | 989.4 | Hersteller |  |
| peak.bf16.sparse | 1978.9 | Hersteller |  |
| peak.fp16.dense | 989.4 | Hersteller |  |
| peak.fp16.sparse | 1978.9 | Hersteller |  |
| peak.fp8.dense | 1978.9 | Hersteller |  |
| peak.fp8.sparse | 3957.8 | Hersteller |  |
| peak.int8.dense | 1978.9 | Hersteller |  |
| peak.int8.sparse | 3957.8 | Hersteller |  |
| memory.capacityGB | 141 | Hersteller |  |
| memory.bandwidthGBs | 4,800 | Hersteller |  |
| interconnect.bandwidthGBs | 900 | Hersteller |  |
| power.tdpW | 700 | Hersteller |  |
| power.idleW | 75 | Schätzung |  |
| power.minPowerLimitW | 200 | Hersteller |  |
| thermal.slowdownC | 87 | Schätzung |  |
| thermal.shutdownC | 92 | Schätzung |  |
| thermal.hbmMaxC | 95 | Schätzung |  |
| thermal.air.rthKW | 0.072 | Annahme |  |
| thermal.air.heatCapacityJK | 560 | Annahme |  |
| thermal.liquid.rthKW | 0.045 | Annahme |  |
| thermal.liquid.heatCapacityJK | 330 | Annahme |  |
| kernelEfficiency | 0.6 | Annahme | Same SM complex as H100; more HBM bandwidth reduces memory stalls |
| hbmEfficiency | 0.8 | Annahme |  |
| afr | 0.09 | Schätzung |  |
| costUsd | 32,000 | Schätzung |  |

### B200 SXM6 180GB `nvidia-b200-sxm6-180gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| boostClockMHz | 1,965 | Schätzung |  |
| peak.fp64 | 37 | Hersteller | HGX B200 total / 8 |
| peak.fp64Tensor | 37 | Hersteller | HGX B200 total / 8 |
| peak.tf32.dense | 1,125 | Hersteller | HGX B200 total / 8 |
| peak.tf32.sparse | 2,250 | Hersteller | HGX B200 total / 8 |
| peak.bf16.dense | 2,250 | Hersteller | HGX B200 total / 8 |
| peak.bf16.sparse | 4,500 | Hersteller | HGX B200 total / 8 |
| peak.fp16.dense | 2,250 | Hersteller | HGX B200 total / 8 |
| peak.fp16.sparse | 4,500 | Hersteller | HGX B200 total / 8 |
| peak.fp8.dense | 4,500 | Hersteller | HGX B200 total / 8 |
| peak.fp8.sparse | 9,000 | Hersteller | HGX B200 total / 8 |
| peak.fp4.dense | 9,000 | Hersteller | HGX B200 total / 8 |
| peak.fp4.sparse | 18,000 | Hersteller | HGX B200 total / 8 |
| peak.int8.dense | 4,500 | Hersteller | HGX B200 total / 8 |
| peak.int8.sparse | 9,000 | Hersteller | HGX B200 total / 8 |
| memory.capacityGB | 180 | Hersteller | HGX B200: 1.4 TB / 8 |
| memory.bandwidthGBs | 8,000 | Hersteller |  |
| interconnect.bandwidthGBs | 1,800 | Hersteller |  |
| power.tdpW | 1,000 | Hersteller |  |
| power.idleW | 120 | Schätzung |  |
| power.minPowerLimitW | 400 | Schätzung |  |
| thermal.slowdownC | 87 | Schätzung |  |
| thermal.shutdownC | 93 | Schätzung |  |
| thermal.hbmMaxC | 95 | Schätzung |  |
| thermal.air.rthKW | 0.05 | Annahme |  |
| thermal.air.heatCapacityJK | 820 | Annahme |  |
| thermal.liquid.rthKW | 0.034 | Annahme |  |
| thermal.liquid.heatCapacityJK | 470 | Annahme |  |
| kernelEfficiency | 0.52 | Annahme | Newer software stack, lower achieved fraction of a much higher peak |
| hbmEfficiency | 0.78 | Annahme |  |
| afr | 0.1 | Schätzung |  |
| costUsd | 38,000 | Schätzung |  |

### B200 (GB200 Superchip) `nvidia-gb200-gpu`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| boostClockMHz | 2,062 | Schätzung |  |
| peak.fp64 | 45 | Hersteller | GB200 NVL72 total / 72 |
| peak.fp64Tensor | 45 | Hersteller | GB200 NVL72 total / 72 |
| peak.tf32.dense | 1,250 | Hersteller | GB200 NVL72 total / 72 |
| peak.tf32.sparse | 2,500 | Hersteller | GB200 NVL72 total / 72 |
| peak.bf16.dense | 2,500 | Hersteller | GB200 NVL72 total / 72 |
| peak.bf16.sparse | 5,000 | Hersteller | GB200 NVL72 total / 72 |
| peak.fp16.dense | 2,500 | Hersteller | GB200 NVL72 total / 72 |
| peak.fp16.sparse | 5,000 | Hersteller | GB200 NVL72 total / 72 |
| peak.fp8.dense | 5,000 | Hersteller | GB200 NVL72 total / 72 |
| peak.fp8.sparse | 10,000 | Hersteller | GB200 NVL72 total / 72 |
| peak.fp4.dense | 10,000 | Hersteller | GB200 NVL72 total / 72 |
| peak.fp4.sparse | 20,000 | Hersteller | GB200 NVL72 total / 72 |
| peak.int8.dense | 5,000 | Hersteller | GB200 NVL72 total / 72 |
| peak.int8.sparse | 10,000 | Hersteller | GB200 NVL72 total / 72 |
| memory.capacityGB | 186 | Hersteller | GB200 NVL72: 13.4 TB / 72 |
| memory.bandwidthGBs | 8,000 | Hersteller |  |
| interconnect.bandwidthGBs | 1,800 | Hersteller |  |
| power.tdpW | 1,200 | Schätzung | Configurable; superchip envelope up to 2.7 kW |
| power.idleW | 130 | Schätzung |  |
| power.minPowerLimitW | 500 | Schätzung |  |
| thermal.slowdownC | 87 | Schätzung |  |
| thermal.shutdownC | 93 | Schätzung |  |
| thermal.hbmMaxC | 95 | Schätzung |  |
| thermal.liquid.rthKW | 0.03 | Annahme |  |
| thermal.liquid.heatCapacityJK | 500 | Annahme |  |
| kernelEfficiency | 0.54 | Annahme |  |
| hbmEfficiency | 0.78 | Annahme |  |
| afr | 0.1 | Schätzung |  |
| costUsd | 30,000 | Schätzung | Superchip-system pricing per GPU |

### Instinct MI300X 192GB `amd-mi300x-192gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| boostClockMHz | 2,100 | Hersteller |  |
| peak.fp64 | 81.7 | Hersteller |  |
| peak.fp64Tensor | 163.4 | Hersteller |  |
| peak.tf32.dense | 653.7 | Hersteller |  |
| peak.tf32.sparse | 1307.4 | Hersteller |  |
| peak.bf16.dense | 1307.4 | Hersteller |  |
| peak.bf16.sparse | 2614.9 | Hersteller |  |
| peak.fp16.dense | 1307.4 | Hersteller |  |
| peak.fp16.sparse | 2614.9 | Hersteller |  |
| peak.fp8.dense | 2614.9 | Hersteller |  |
| peak.fp8.sparse | 5229.8 | Hersteller |  |
| peak.int8.dense | 2614.9 | Hersteller |  |
| peak.int8.sparse | 5229.8 | Hersteller |  |
| memory.capacityGB | 192 | Hersteller |  |
| memory.bandwidthGBs | 5,300 | Hersteller |  |
| interconnect.bandwidthGBs | 896 | Hersteller | 7 links × 128 GB/s |
| power.tdpW | 750 | Hersteller |  |
| power.idleW | 90 | Schätzung |  |
| power.minPowerLimitW | 300 | Schätzung |  |
| thermal.slowdownC | 90 | Schätzung | Junction hotspot limit, edge sensor equivalent |
| thermal.shutdownC | 105 | Schätzung |  |
| thermal.hbmMaxC | 95 | Schätzung |  |
| thermal.air.rthKW | 0.068 | Annahme |  |
| thermal.air.heatCapacityJK | 620 | Annahme |  |
| thermal.liquid.rthKW | 0.042 | Annahme |  |
| thermal.liquid.heatCapacityJK | 360 | Annahme |  |
| kernelEfficiency | 0.45 | Annahme | ROCm stack achieves a lower fraction of the higher nominal peak in public benchmarks |
| hbmEfficiency | 0.75 | Annahme |  |
| afr | 0.1 | Schätzung |  |
| costUsd | 17,500 | Schätzung |  |

### Instinct MI325X 256GB `amd-mi325x-256gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| boostClockMHz | 2,100 | Hersteller |  |
| peak.fp64 | 81.7 | Hersteller |  |
| peak.fp64Tensor | 163.4 | Hersteller |  |
| peak.tf32.dense | 653.7 | Hersteller |  |
| peak.tf32.sparse | 1307.4 | Hersteller |  |
| peak.bf16.dense | 1307.4 | Hersteller |  |
| peak.bf16.sparse | 2614.9 | Hersteller |  |
| peak.fp16.dense | 1307.4 | Hersteller |  |
| peak.fp16.sparse | 2614.9 | Hersteller |  |
| peak.fp8.dense | 2614.9 | Hersteller |  |
| peak.fp8.sparse | 5229.8 | Hersteller |  |
| peak.int8.dense | 2614.9 | Hersteller |  |
| peak.int8.sparse | 5229.8 | Hersteller |  |
| memory.capacityGB | 256 | Hersteller |  |
| memory.bandwidthGBs | 6,000 | Hersteller |  |
| interconnect.bandwidthGBs | 896 | Hersteller |  |
| power.tdpW | 1,000 | Hersteller |  |
| power.idleW | 110 | Schätzung |  |
| power.minPowerLimitW | 400 | Schätzung |  |
| thermal.slowdownC | 90 | Schätzung |  |
| thermal.shutdownC | 105 | Schätzung |  |
| thermal.hbmMaxC | 95 | Schätzung |  |
| thermal.air.rthKW | 0.052 | Annahme |  |
| thermal.air.heatCapacityJK | 780 | Annahme |  |
| thermal.liquid.rthKW | 0.035 | Annahme |  |
| thermal.liquid.heatCapacityJK | 450 | Annahme |  |
| kernelEfficiency | 0.47 | Annahme |  |
| hbmEfficiency | 0.75 | Annahme |  |
| afr | 0.1 | Schätzung |  |
| costUsd | 22,000 | Schätzung |  |

## CPUs

### EPYC 7742 `amd-epyc-7742`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| baseGHz | 2.25 | Hersteller |  |
| boostGHz | 3.4 | Hersteller |  |
| l3MB | 256 | Hersteller |  |
| tdpW | 225 | Hersteller |  |
| idleW | 70 | Schätzung |  |
| memory.onPackageGB | 0 | Hersteller |  |
| afr | 0.002 | Schätzung |  |
| costUsd | 6,950 | Schätzung |  |

### Xeon Platinum 8480C `intel-xeon-8480c`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| baseGHz | 2 | Hersteller |  |
| boostGHz | 3.8 | Hersteller |  |
| l3MB | 105 | Hersteller |  |
| tdpW | 350 | Hersteller |  |
| idleW | 95 | Schätzung |  |
| memory.onPackageGB | 0 | Hersteller |  |
| afr | 0.002 | Schätzung |  |
| costUsd | 10,710 | Hersteller | Intel recommended customer price, 8480+ |

### Xeon Platinum 8570 `intel-xeon-8570`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| baseGHz | 2.1 | Hersteller |  |
| boostGHz | 4 | Hersteller |  |
| l3MB | 300 | Hersteller |  |
| tdpW | 350 | Hersteller |  |
| idleW | 95 | Schätzung |  |
| memory.onPackageGB | 0 | Hersteller |  |
| afr | 0.002 | Schätzung |  |
| costUsd | 9,600 | Schätzung |  |

### Xeon 6980P `intel-xeon-6980p`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| baseGHz | 2 | Hersteller |  |
| boostGHz | 3.9 | Hersteller |  |
| l3MB | 504 | Hersteller |  |
| tdpW | 500 | Hersteller |  |
| idleW | 130 | Schätzung |  |
| memory.onPackageGB | 0 | Hersteller |  |
| afr | 0.002 | Schätzung |  |
| costUsd | 12,500 | Schätzung |  |

### EPYC 9654 `amd-epyc-9654`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| baseGHz | 2.4 | Hersteller |  |
| boostGHz | 3.7 | Hersteller |  |
| l3MB | 384 | Hersteller |  |
| tdpW | 360 | Hersteller |  |
| idleW | 100 | Schätzung |  |
| memory.onPackageGB | 0 | Hersteller |  |
| afr | 0.002 | Schätzung |  |
| costUsd | 11,805 | Hersteller | AMD launch list price |

### EPYC 9755 `amd-epyc-9755`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| baseGHz | 2.7 | Hersteller |  |
| boostGHz | 4.1 | Hersteller |  |
| l3MB | 512 | Hersteller |  |
| tdpW | 500 | Hersteller |  |
| idleW | 125 | Schätzung |  |
| memory.onPackageGB | 0 | Hersteller |  |
| afr | 0.002 | Schätzung |  |
| costUsd | 12,984 | Hersteller | AMD launch list price |

### Grace `nvidia-grace`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| baseGHz | 3.1 | Schätzung |  |
| boostGHz | 3.2 | Schätzung |  |
| l3MB | 114 | Hersteller |  |
| tdpW | 300 | Schätzung | Including on-package LPDDR5X |
| idleW | 70 | Schätzung |  |
| memory.onPackageGB | 480 | Hersteller |  |
| memory.onPackageBandwidthGBs | 512 | Hersteller |  |
| afr | 0.002 | Schätzung |  |
| costUsd | 4,000 | Schätzung |  |

## Arbeitsspeicher (DIMMs)

### 64 GB DDR4-3200 RDIMM (2Rx4) `ddr4-3200-64gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| powerActiveW | 6.5 | Schätzung |  |
| powerIdleW | 2.5 | Schätzung |  |
| afr | 0.004 | Schätzung |  |
| costUsd | 180 | Schätzung |  |

### 64 GB DDR5-4800 RDIMM (2Rx4) `ddr5-4800-64gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| powerActiveW | 8 | Schätzung |  |
| powerIdleW | 3 | Schätzung |  |
| afr | 0.004 | Schätzung |  |
| costUsd | 250 | Schätzung |  |

### 64 GB DDR5-5600 RDIMM (2Rx4) `ddr5-5600-64gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| powerActiveW | 8.5 | Schätzung |  |
| powerIdleW | 3 | Schätzung |  |
| afr | 0.004 | Schätzung |  |
| costUsd | 280 | Schätzung |  |

### 96 GB DDR5-5600 RDIMM (2Rx4) `ddr5-5600-96gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| powerActiveW | 10 | Schätzung |  |
| powerIdleW | 3.5 | Schätzung |  |
| afr | 0.004 | Schätzung |  |
| costUsd | 420 | Schätzung |  |

### 64 GB DDR5-6400 RDIMM (2Rx4) `ddr5-6400-64gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| powerActiveW | 9 | Schätzung |  |
| powerIdleW | 3.2 | Schätzung |  |
| afr | 0.004 | Schätzung |  |
| costUsd | 320 | Schätzung |  |

### 128 GB DDR5-6400 RDIMM (2Rx4) `ddr5-6400-128gb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| powerActiveW | 12 | Schätzung |  |
| powerIdleW | 4 | Schätzung |  |
| afr | 0.004 | Schätzung |  |
| costUsd | 800 | Schätzung |  |

## NVMe

### Samsung PM9A3 1.92 TB (M.2) `samsung-pm9a3-1.92tb-m2`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| seqReadGBs | 5.5 | Schätzung |  |
| seqWriteGBs | 2 | Schätzung |  |
| randReadKIOPS | 800 | Schätzung |  |
| powerActiveW | 8.2 | Schätzung |  |
| powerIdleW | 2.5 | Schätzung |  |
| afr | 0.0044 | Schätzung | From 2 M h MTBF |
| costUsd | 300 | Schätzung |  |

### Samsung PM1733 3.84 TB (U.2) `samsung-pm1733-3.84tb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| seqReadGBs | 7 | Hersteller |  |
| seqWriteGBs | 3.8 | Schätzung |  |
| randReadKIOPS | 1,500 | Schätzung |  |
| powerActiveW | 20 | Schätzung |  |
| powerIdleW | 6 | Schätzung |  |
| afr | 0.0044 | Schätzung |  |
| costUsd | 700 | Schätzung |  |

### Samsung PM1743 3.84 TB (U.2) `samsung-pm1743-3.84tb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| seqReadGBs | 12 | Schätzung |  |
| seqWriteGBs | 4.8 | Schätzung |  |
| randReadKIOPS | 2,400 | Schätzung |  |
| powerActiveW | 25 | Schätzung |  |
| powerIdleW | 8 | Schätzung |  |
| afr | 0.0044 | Schätzung |  |
| costUsd | 950 | Schätzung |  |

### Samsung PM1743 15.36 TB (U.2) `samsung-pm1743-15.36tb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| seqReadGBs | 13 | Hersteller |  |
| seqWriteGBs | 6.6 | Hersteller |  |
| randReadKIOPS | 2,500 | Hersteller |  |
| powerActiveW | 25 | Schätzung |  |
| powerIdleW | 8 | Schätzung |  |
| afr | 0.0044 | Schätzung |  |
| costUsd | 3,000 | Schätzung |  |

### Kioxia XD7P 3.84 TB (E1.S) `kioxia-xd7p-3.84tb-e1s`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| seqReadGBs | 7.2 | Schätzung |  |
| seqWriteGBs | 4.8 | Schätzung |  |
| randReadKIOPS | 1,650 | Schätzung |  |
| powerActiveW | 16 | Schätzung |  |
| powerIdleW | 5 | Schätzung |  |
| afr | 0.0044 | Schätzung |  |
| costUsd | 900 | Schätzung |  |

### Solidigm D5-P5336 61.44 TB (U.2, QLC) `solidigm-d5p5336-61.44tb`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| seqReadGBs | 7 | Hersteller |  |
| seqWriteGBs | 3 | Schätzung |  |
| randReadKIOPS | 1,005 | Schätzung |  |
| powerActiveW | 25 | Schätzung |  |
| powerIdleW | 5 | Schätzung |  |
| afr | 0.0044 | Schätzung |  |
| costUsd | 7,000 | Schätzung |  |

## Netzwerkadapter

### ConnectX-6 VPI HDR `nvidia-cx6-hdr`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| powerW | 20 | Schätzung |  |
| latencyNs | 600 | Schätzung |  |
| afr | 0.01 | Schätzung |  |
| costUsd | 1,300 | Schätzung |  |

### ConnectX-7 VPI NDR (OSFP) `nvidia-cx7-ndr`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| powerW | 25 | Schätzung |  |
| latencyNs | 600 | Schätzung |  |
| afr | 0.012 | Schätzung |  |
| costUsd | 2,200 | Schätzung |  |

### ConnectX-8 SuperNIC XDR `nvidia-cx8-xdr`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| powerW | 35 | Schätzung |  |
| latencyNs | 550 | Schätzung |  |
| afr | 0.012 | Schätzung |  |
| costUsd | 3,500 | Schätzung |  |

### BlueField-3 DPU B3220 `nvidia-bf3-b3220`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| powerW | 75 | Schätzung | Typical; 150 W maximum board power |
| latencyNs | 800 | Schätzung |  |
| afr | 0.012 | Schätzung |  |
| costUsd | 3,000 | Schätzung |  |

## Switches

### Quantum QM8700 (HDR) `nvidia-qm8700`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| switchingTbps | 16 | Hersteller |  |
| latencyNs | 130 | Hersteller |  |
| powerTypicalW | 350 | Schätzung |  |
| powerMaxW | 650 | Schätzung |  |
| afr | 0.015 | Schätzung |  |
| costUsd | 22,000 | Schätzung |  |

### Quantum-2 QM9700 (NDR) `nvidia-qm9700`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| switchingTbps | 51.2 | Hersteller |  |
| latencyNs | 130 | Schätzung |  |
| powerTypicalW | 1,100 | Schätzung |  |
| powerMaxW | 1,720 | Schätzung |  |
| afr | 0.015 | Schätzung |  |
| costUsd | 35,000 | Schätzung |  |

### Quantum-X800 Q3400 (XDR) `nvidia-q3400`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| switchingTbps | 115.2 | Hersteller |  |
| latencyNs | 150 | Schätzung |  |
| powerTypicalW | 4,200 | Schätzung |  |
| powerMaxW | 6,000 | Schätzung |  |
| afr | 0.02 | Schätzung |  |
| costUsd | 180,000 | Schätzung |  |

### Spectrum-4 SN5600 (800GbE) `nvidia-sn5600`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| switchingTbps | 51.2 | Hersteller |  |
| latencyNs | 550 | Schätzung |  |
| powerTypicalW | 1,300 | Schätzung |  |
| powerMaxW | 2,100 | Schätzung |  |
| afr | 0.015 | Schätzung |  |
| costUsd | 60,000 | Schätzung |  |

### Spectrum-3 SN4700 (400GbE) `nvidia-sn4700`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| switchingTbps | 12.8 | Hersteller |  |
| latencyNs | 425 | Schätzung |  |
| powerTypicalW | 650 | Schätzung |  |
| powerMaxW | 900 | Schätzung |  |
| afr | 0.015 | Schätzung |  |
| costUsd | 30,000 | Schätzung |  |

## NVSwitch

### NVSwitch (2nd gen) `nvswitch-gen2`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| bandwidthGBs | 1,800 | Schätzung |  |
| powerW | 70 | Schätzung |  |
| afr | 0.005 | Schätzung |  |

### NVSwitch (3rd gen) `nvswitch-gen3`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| bandwidthGBs | 3,200 | Hersteller |  |
| powerW | 110 | Schätzung |  |
| afr | 0.005 | Schätzung |  |

### NVLink 5 Switch `nvswitch-gen4`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| bandwidthGBs | 7,200 | Hersteller |  |
| powerW | 250 | Schätzung |  |
| afr | 0.005 | Schätzung |  |

## Netzteile

### 3000 W CRPS (80 PLUS Platinum) `psu-crps-3000-platinum`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| ratedW | 3,000 | Hersteller |  |
| afr | 0.01 | Schätzung |  |
| costUsd | 450 | Schätzung |  |

### 3000 W CRPS (80 PLUS Titanium) `psu-crps-3000-titanium`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| ratedW | 3,000 | Hersteller |  |
| afr | 0.01 | Schätzung |  |
| costUsd | 550 | Schätzung |  |

### 3300 W CRPS (80 PLUS Titanium) `psu-crps-3300-titanium`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| ratedW | 3,300 | Hersteller |  |
| afr | 0.01 | Schätzung |  |
| costUsd | 600 | Schätzung |  |

### 54 V DC busbar feed (rack power shelf) `busbar-54v-feed`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| ratedW | 8,000 | Annahme | Tray busbar clip rating |
| afr | 0.002 | Schätzung |  |
| costUsd | 0 | Schätzung |  |

## Speichersysteme

### DDN AI400X2 (EXAScaler / Lustre) `ddn-ai400x2`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| usableTB | 560 | Schätzung |  |
| readGBs | 90 | Schätzung |  |
| writeGBs | 65 | Schätzung |  |
| powerW | 2,600 | Schätzung |  |
| afr | 0.02 | Schätzung |  |
| costUsd | 450,000 | Schätzung |  |

### All-flash scale-out NFS node `generic-flash-nfs-node`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| usableTB | 300 | Schätzung |  |
| readGBs | 25 | Schätzung |  |
| writeGBs | 12 | Schätzung |  |
| powerW | 1,400 | Schätzung |  |
| afr | 0.02 | Schätzung |  |
| costUsd | 160,000 | Schätzung |  |

## Racks

### 42U 600 × 1200 mm enclosure `rack-42u-600`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| staticLoadKg | 1,360 | Hersteller |  |
| emptyWeightKg | 130 | Schätzung |  |
| costUsd | 2,500 | Schätzung |  |

### 48U 800 × 1200 mm high-density enclosure `rack-48u-800`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| staticLoadKg | 1,600 | Schätzung |  |
| emptyWeightKg | 170 | Schätzung |  |
| costUsd | 3,800 | Schätzung |  |

### MGX / ORv3-class 48U liquid-cooled rack (busbar, manifolds) `rack-mgx-48u`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| staticLoadKg | 1,800 | Schätzung |  |
| emptyWeightKg | 300 | Schätzung |  |
| costUsd | 25,000 | Schätzung |  |

## PDUs

### Switched rack PDU 3Φ 415 V 32 A `pdu-3ph-415v-32a`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 18.4013 | Annahme | √3 · V · I · 0.8 continuous derating |
| costUsd | 2,800 | Schätzung |  |

### Switched rack PDU 3Φ 415 V 60 A `pdu-3ph-415v-60a`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 34.5025 | Annahme | √3 · V · I · 0.8 continuous derating |
| costUsd | 3,600 | Schätzung |  |

### Busway tap-off 3Φ 415 V 125 A `pdu-3ph-415v-125a`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 71.8801 | Annahme | √3 · V · I · 0.8 continuous derating |
| costUsd | 6,000 | Schätzung |  |

## USV

### Modular double-conversion UPS (50 kW modules, Li-ion) `ups-modular-50`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| moduleKW | 50 | Hersteller |  |
| runtimeMinAtFullLoad | 8 | Schätzung |  |
| costUsdPerModule | 30,000 | Schätzung |  |

### Modular double-conversion UPS (250 kW modules, Li-ion) `ups-modular-250`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| moduleKW | 250 | Hersteller |  |
| runtimeMinAtFullLoad | 5 | Schätzung |  |
| costUsdPerModule | 120,000 | Schätzung |  |

## Kühlung

### Chilled-water CRAH 150 kW `crah-150`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 150 | Schätzung |  |
| parasiticW | 5,500 | Schätzung |  |
| afr | 0.03 | Schätzung |  |
| costUsd | 60,000 | Schätzung |  |

### Chilled-water in-row cooler 50 kW `inrow-50`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 50 | Schätzung |  |
| parasiticW | 1,200 | Schätzung |  |
| afr | 0.03 | Schätzung |  |
| costUsd | 20,000 | Schätzung |  |

### Active rear-door heat exchanger 75 kW `rdhx-75`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 75 | Schätzung |  |
| parasiticW | 1,000 | Schätzung |  |
| afr | 0.02 | Schätzung |  |
| costUsd | 18,000 | Schätzung |  |

### In-rack coolant distribution unit 150 kW `cdu-inrack-150`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 150 | Schätzung |  |
| parasiticW | 1,800 | Schätzung |  |
| afr | 0.03 | Schätzung |  |
| costUsd | 45,000 | Schätzung |  |

### Row-level coolant distribution unit 1.35 MW `cdu-row-1350`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 1,350 | Schätzung |  |
| parasiticW | 12,000 | Schätzung |  |
| afr | 0.03 | Schätzung |  |
| costUsd | 350,000 | Schätzung |  |

### Air-cooled scroll chiller 250 kW (free-cooling coil) `chiller-air-250`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 250 | Schätzung |  |
| parasiticW | 0 | Schätzung |  |
| copAt35C | 3 | Schätzung |  |
| copAt15C | 5.2 | Schätzung |  |
| afr | 0.04 | Schätzung |  |
| costUsd | 140,000 | Schätzung |  |

### Air-cooled screw chiller 1 MW (free-cooling coil) `chiller-air-1000`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 1,000 | Schätzung |  |
| parasiticW | 0 | Schätzung |  |
| copAt35C | 3.1 | Schätzung |  |
| copAt15C | 5.5 | Schätzung |  |
| afr | 0.04 | Schätzung |  |
| costUsd | 450,000 | Schätzung |  |

### Water-cooled centrifugal chiller 3.5 MW (incl. cooling tower) `chiller-water-3500`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 3,500 | Schätzung |  |
| parasiticW | 0 | Schätzung |  |
| copAt35C | 4.8 | Schätzung |  |
| copAt15C | 7 | Schätzung |  |
| afr | 0.03 | Schätzung |  |
| costUsd | 1,200,000 | Schätzung |  |

### Adiabatic dry cooler 1.2 MW (warm-water loop) `drycooler-1200`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| capacityKW | 1,200 | Schätzung |  |
| parasiticW | 18,000 | Schätzung |  |
| afr | 0.03 | Schätzung |  |
| costUsd | 180,000 | Schätzung |  |

## Superchips

### GB200 Grace Blackwell Superchip `nvidia-gb200-superchip`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| c2cBandwidthGBs | 900 | Hersteller |  |
| maxModulePowerW | 2,700 | Hersteller |  |

## Server-Plattformen

### HGX A100 8-GPU server `hgx-a100-8gpu`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| weightKg | 123 | Hersteller |  |
| fans.maxPowerW | 100 | Schätzung |  |
| baseboardW | 450 | Schätzung |  |
| maxPowerW | 6,500 | Hersteller |  |
| boot.postSeconds | 120 | Schätzung |  |
| boot.osBootSeconds | 70 | Schätzung |  |
| boot.shutdownSeconds | 40 | Schätzung |  |
| chassisCostUsd | 30,000 | Schätzung |  |

### HGX H100 8-GPU server `hgx-h100-8gpu`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| weightKg | 130.5 | Hersteller |  |
| fans.maxPowerW | 110 | Schätzung |  |
| baseboardW | 600 | Schätzung |  |
| maxPowerW | 10,200 | Hersteller |  |
| boot.postSeconds | 150 | Schätzung |  |
| boot.osBootSeconds | 75 | Schätzung |  |
| boot.shutdownSeconds | 45 | Schätzung |  |
| chassisCostUsd | 45,000 | Schätzung |  |

### HGX H200 8-GPU server `hgx-h200-8gpu`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| weightKg | 130.5 | Hersteller |  |
| fans.maxPowerW | 110 | Schätzung |  |
| baseboardW | 600 | Schätzung |  |
| maxPowerW | 10,200 | Hersteller |  |
| boot.postSeconds | 150 | Schätzung |  |
| boot.osBootSeconds | 75 | Schätzung |  |
| boot.shutdownSeconds | 45 | Schätzung |  |
| chassisCostUsd | 45,000 | Schätzung |  |

### HGX B200 8-GPU server `hgx-b200-8gpu`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| weightKg | 142 | Hersteller |  |
| fans.maxPowerW | 120 | Schätzung |  |
| baseboardW | 750 | Schätzung |  |
| maxPowerW | 14,300 | Hersteller |  |
| boot.postSeconds | 180 | Schätzung |  |
| boot.osBootSeconds | 80 | Schätzung |  |
| boot.shutdownSeconds | 45 | Schätzung |  |
| chassisCostUsd | 60,000 | Schätzung |  |

### GB200 NVL72 compute tray `gb200-nvl72-tray`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| weightKg | 48 | Schätzung |  |
| fans.maxPowerW | 25 | Schätzung | Residual air for NICs, drives and VRMs |
| baseboardW | 300 | Schätzung |  |
| maxPowerW | 6,500 | Schätzung |  |
| boot.postSeconds | 200 | Schätzung |  |
| boot.osBootSeconds | 90 | Schätzung |  |
| boot.shutdownSeconds | 50 | Schätzung |  |
| chassisCostUsd | 40,000 | Schätzung |  |

### Instinct MI300X 8-GPU server `mi300x-8gpu`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| weightKg | 120 | Schätzung |  |
| fans.maxPowerW | 100 | Schätzung |  |
| baseboardW | 550 | Schätzung |  |
| maxPowerW | 10,000 | Schätzung |  |
| boot.postSeconds | 160 | Schätzung |  |
| boot.osBootSeconds | 80 | Schätzung |  |
| boot.shutdownSeconds | 45 | Schätzung |  |
| chassisCostUsd | 40,000 | Schätzung |  |

### Instinct MI325X 8-GPU server `mi325x-8gpu`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| weightKg | 125 | Schätzung |  |
| fans.maxPowerW | 110 | Schätzung |  |
| baseboardW | 600 | Schätzung |  |
| maxPowerW | 12,500 | Schätzung |  |
| boot.postSeconds | 160 | Schätzung |  |
| boot.osBootSeconds | 80 | Schätzung |  |
| boot.shutdownSeconds | 45 | Schätzung |  |
| chassisCostUsd | 45,000 | Schätzung |  |

## Rack-Systeme

### GB200 NVL72 rack `gb200-nvl72`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| switchTrayOverheadW | 600 | Schätzung |  |
| powerShelfKW | 33 | Schätzung |  |
| weightKg | 1,360 | Schätzung |  |
| maxPowerKW | 132 | Schätzung |  |
| costUsd | 400,000 | Schätzung | Rack integration: MGX rack, NVLink switch trays, power shelves, manifolds (compute trays costed bottom-up) |

## Modellarchitekturen

### Llama 3.1 8B `llama-3.1-8b`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| params | 8,030,000,000 | Hersteller |  |
| activeParams | 8,030,000,000 | Hersteller |  |

### Llama 3.1 70B `llama-3.1-70b`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| params | 70,600,000,000 | Hersteller |  |
| activeParams | 70,600,000,000 | Hersteller |  |

### Llama 3.1 405B `llama-3.1-405b`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| params | 405,900,000,000 | Hersteller |  |
| activeParams | 405,900,000,000 | Hersteller |  |

### GPT-3 175B `gpt3-175b`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| params | 175,000,000,000 | Hersteller |  |
| activeParams | 175,000,000,000 | Hersteller |  |

### Mixtral 8x22B (MoE) `mixtral-8x22b`

| Feld | Wert | Quelle | Hinweis |
|---|---:|---|---|
| params | 141,000,000,000 | Hersteller |  |
| activeParams | 39,000,000,000 | Hersteller |  |
