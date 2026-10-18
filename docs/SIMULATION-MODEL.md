# Simulationsmodell

Dieses Dokument beschreibt, wie Safeton das Verhalten eines KI-Rechenzentrums berechnet:
Formeln, Annahmen und die Quellenkategorie jedes Parameters. Alle Hardwarewerte des
Katalogs mit ihrer Kategorie stehen vollständig in [CATALOG.md](CATALOG.md).

**Quellenkategorien:** **H** = Herstellerangabe · **S** = Schätzung (öffentliche Messungen,
Berichte, vergleichbare Produkte) · **A** = Simulationsannahme (Modellparameter).

> Grundsatz: Kein angezeigter Wert ist eine Zufallszahl. Zufall bestimmt nur, _wann_ etwas
> ausfällt (Poisson-Prozesse) und kleine, feste Hardwarevarianzen. Alles andere folgt aus
> Hardware, Topologie, Workload und Anlagenzustand.

## 1. Zeit und Tick-Reihenfolge

Fester Zeitschritt `dt` (Standard 1 s). Jeder Tick durchläuft die Phasen in fester
Reihenfolge:

1. Node-Zustandsautomaten (POST, Boot, Shutdown)
2. Reparatur-Tickets (automatische Behebung)
3. Stochastische Komponentenausfälle
4. Scheduling wartender Jobs
5. Workloads → GPU-Aktivität, Speicher, NIC-/NVLink-/Storage-Verkehr
6. Netzwerkauslastung und Stauungsfaktor je Job
7. Elektrik und Thermik je GPU und Node
8. Racks, Hallen, Kälteanlage, PUE, Energie
9. Telemetrie-Abtastung (global alle 5 s, je Node alle 30 s)

Die Simulationszeit beginnt bei `simulationStart` der Spec; Außentemperatur und PUE folgen
dem Klima des Standorts.

## 2. Elektrisches Modell

### GPU

```
P_static = P_idle · max(0,85; 1 + 0,004 · (T − 40 °C))         Leckstrom (A)
P_dyn    = (TDP − P_idle) · a · f^2,4                           DVFS: P ∝ f·V², V ∝ f^0,7 (A)
P_GPU    = P_static + P_dyn
```

- `a` = Aktivität = Auslastung × Intensität des Workloads (0…1).
- `f` = erreichte Taktfraktion = min(Leistungslimit-Takt, thermischer Takt, Power-Brake).
- Leistungslimit-Takt: größtes `f` mit `P_GPU ≤ Limit` (nvidia-smi `-pl`), Minimum 0,3 (A).
  Unter Volllast und hoher Temperatur greift das Limit bereits bei TDP — wie bei realen
  H100 im Training (Throttle-Grund „SW Power Cap“).
- TDP, Leerlaufleistung und minimales Leistungslimit: Katalog (H/S).

### Node

```
P_DC  = Σ P_GPU + CPUs + DIMMs + NVMe + NICs + NVSwitch + Lüfter + Baseboard
P_AC  = P_DC / η_PSU(Last je aktivem Netzteil)
```

| Komponente                                            | Modell                                                                  | Quelle                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| CPU                                                   | `P_idle + (TDP − P_idle) · Auslastung`                                  | TDP H, Idle S                   |
| DIMM                                                  | `P_idle + (P_aktiv − P_idle) · Aktivität`                               | S                               |
| NVMe                                                  | Leerlauf + aktiv nach Storage-Aktivität                                 | S                               |
| NIC / DPU                                             | 70 % statisch + 30 % verkehrsabhängig                                   | A                               |
| NVSwitch                                              | 40 % statisch + 60 % nach NVLink-Aktivität                              | Leistung S, Aufteilung A        |
| Lüfter                                                | `n_ok · P_max · Duty³` (Affinitätsgesetz)                               | P_max S, Exponent physikalisch  |
| Baseboard (BMC, PCIe-Switches, Retimer, VRM-Verluste) | 60 % statisch + 40 % nach GPU-Last                                      | S/A                             |
| Netzteile                                             | Effizienzkurve (80 PLUS Titanium/Platinum), Lastteilung auf aktive PSUs | Kurvenminima H, Zwischenwerte S |

Der Bottom-up-Spitzenwert jeder Server-Plattform liegt in den Tests innerhalb von −10 %/+5 %
der veröffentlichten maximalen Systemleistung (z. B. HGX H100: berechnet 9,86 kW, Hersteller
10,2 kW).

**PSU-Ausfälle:** Fallen so viele Netzteile aus, dass die verbleibenden die Spitzenlast
nicht tragen, wird der Power Brake aktiv (Takt ≤ 50 %, Throttle „HW Power Brake Slowdown“).
Ohne Netzteil verliert der Node die Stromversorgung.

**Ausgeschaltete Nodes** ziehen 25 W BMC-Standby (A).

## 3. Thermisches Modell

Jede GPU ist ein RC-Glied mit konzentrierter Wärmekapazität:

```
C · dT/dt = P − (T − T_ref) / R
T(t+dt)   = T_ss + (T − T_ss) · e^(−dt/τ),   T_ss = T_ref + P · R,   τ = R · C
```

Die exakte Lösung ist für jedes `dt` stabil.

| Größe                       | Luftkühlung                                                                              | Direkte Flüssigkeitskühlung (DLC)                                   | Quelle |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| `R` bei voller Kühlung      | 0,05–0,11 K/W je GPU-Modell                                                              | 0,03–0,07 K/W                                                       | A      |
| `C`                         | 380–820 J/K (τ ≈ 40 s)                                                                   | 240–500 J/K (τ ≈ 15 s)                                              | A      |
| `R` bei reduzierter Kühlung | `R_voll · (1/Luftstrom)^0,55`, Luftstrom = Duty · (0,35 + 0,65 · Anteil intakter Lüfter) | `R_voll · (1/Durchfluss)^0,4`                                       | A      |
| Bezugstemperatur            | Rack-Einlass; hintere GPU-Reihe + (1 + 4 · Last) K vorgewärmt                            | Kühlmittelvorlauf + 1 + 5 · Last K, nachgelagerte Coldplates +1,5 K | A      |
| Fertigungsvarianz           | `R × U(0,94; 1,06)` je GPU, aus Topologie geseedet                                       | gleich                                                              | A      |

**Lüfterregelung (Firmware-Kurve, A):** Ziel-Duty linear von 25 % bei 45 °C bis 100 % bei
78 °C (heißeste GPU), Änderungsrate ≤ 8 %/s. Während POST laufen die Lüfter auf 100 %.

**Drosselung:** Oberhalb der Slowdown-Temperatur (S) sinkt der Takt linear bis 45 % an der
Shutdown-Temperatur (A). Erreicht eine GPU die Shutdown-Temperatur, schaltet der BMC den
Node ab (Thermal Trip, Xid 79, Job-Abbruch).

**Einlasstemperatur:** Hallen-Zuluft + statischer Rack-Versatz (0–1,5 K, A) + Hotspot bei
Raumluft-Racks über 25 kW (+0,15 K je kW, τ = 120 s, A).

Typische Ergebnisse: H100 luftgekühlt im Leerlauf 33–38 °C, unter Training 73–79 °C bei
24 °C Zuluft; B200 mit DLC unter Last 50–65 °C.

## 4. Rack-, Hallen- und Anlagenmodell

### Wärmeaufteilung je Rack

- **Luft:** gesamte Wärme in den Raum.
- **RDHx (aktive Rücktür, 75 kW, S):** Luftseitige Wärme wird bis zur Türkapazität ins
  Kaltwasser abgeführt, der Rest geht in den Raum.
- **DLC:** GPU-, CPU- und NVSwitch-Wärme in den Flüssigkeitskreislauf, Rest (DIMMs, NICs,
  Laufwerke, PSU-Verluste, Lüfter) in die Luft. Ergibt ≈ 78 % (HGX B200) bzw. ≈ 84 %
  (GB200 NVL72) Flüssigkeitsanteil.

### Hallen-Dynamik

```
Kapazität_Luft = (installiert − ausgefallen) · Gerätekapazität
Zuluft_Ziel    = Sollwert + min(25; max(0; Last/Kapazität − 1) · 40 K) + 0,8 · ΔT_Kaltwasser   (A)
Zuluft         → Ziel mit τ = 300 s
Vorlauf_DLC    = Sollwert + min(30; Überlast · 25 K) + Kälteunterstützung,  τ = 120 s          (A)
Kaltwasser     = Sollwert + min(30; Überlast_Kältemaschinen · 20 K),        τ = 600 s          (A)
```

Ein Ausfall von Kältemaschinen erwärmt dadurch das Kaltwasser → die Zuluft → die GPU-Einlässe
→ GPUs drosseln oder schalten ab → Jobs werden langsamer oder starten neu.

### Facility-Leistung und PUE

```
P_Facility = P_IT + P_Kälte + P_Lüfter(CRAH, RDHx) + P_Pumpen(CDU) + P_Rückkühler
           + P_USV-Verluste + P_Verteilverluste + P_Sonstiges
PUE        = P_Facility / P_IT
```

| Parameter                                    | Wert                                                                             | Quelle                            |
| -------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------- |
| COP Kältemaschine                            | linear zwischen COP@15 °C und COP@35 °C Außentemperatur                          | S                                 |
| Freie Kühlung Kaltwasser                     | voll bei Außen ≤ Vorlauf − 8 K, keine ab Vorlauf − 2 K                           | A                                 |
| Freie Kühlung Warmwasser (Rückkühler)        | voll bei Außen ≤ Vorlauf − 6 K, keine ab Vorlauf − 1 K                           | A                                 |
| Economiser-Pumpen                            | 2 % der frei gekühlten Last                                                      | A                                 |
| Kälteunterstützung Warmwasser                | COP × 1,3 (wärmerer Rücklauf)                                                    | A                                 |
| Parasitäre Leistung CRAH/RDHx/CDU/Rückkühler | Katalogwerte je Gerät                                                            | S                                 |
| USV-Wirkungsgrad                             | Kurve über Last je installiertem Modul                                           | S                                 |
| Verteilverluste                              | 1,2 % von IT + USV-Verlust, 1 % der Kühlleistung                                 | A                                 |
| Sonstiges (Licht, Sicherheit, Büros)         | 0,4 % der IT-Designlast, mind. 2 kW                                              | A                                 |
| Klima                                        | Jahresmittel + saisonale Amplitude (Max. Tag 200) + Tagesamplitude (Max. 15 Uhr) | A (je Standort plausibel gewählt) |
| Auslegungs-Außentemperatur                   | Mittel + saisonale + Tagesamplitude + 5 K                                        | A (≈ ASHRAE 0,4 %)                |

Ergebnisse: luftgekühlt/RDHx Jahres-PUE ≈ 1,15–1,25 (Frankfurt), DLC mit Rückkühlern
≈ 1,08–1,12; bei Hitze steigt der PUE (Hyperscale Dallas: 1,27 bei 40 °C Auslegung).

## 5. Training (3D-Parallelität)

### Planung

Der Auto-Planer probiert TP ∈ {1, 2, 4, 8} (≤ GPUs je Node, ≤ Scale-up-Domäne, Teiler der
Attention-Heads), PP ∈ {1, 2, 4, … ≤ Layer} und Recompute ∈ {selektiv, voll} und wählt die
schnellste Konfiguration, die in den HBM passt. DP = GPUs / (TP · PP) muss den globalen
Batch teilen.

**FLOPs (Modell-FLOPs, für MFU):**

```
F_Token = 6 · N_aktiv + 12 · L · h · s            (Kaplan/PaLM)
F_Step  = Batch · s · F_Token
Hardware-FLOPs = F_Step · (1,03 bei selektivem / 4/3 bei vollem Recompute)
```

**Speicher je GPU (gemischte Präzision, verteilter Optimizer):**

| Anteil        | Bytes je Parameter (geteilt durch TP · PP)                                                                        | Quelle |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| Gewichte      | 2 (BF16) bzw. 3 (FP8 + BF16-Kopie)                                                                                | A      |
| Gradienten    | 4 (FP32-Hauptgradienten)                                                                                          | A      |
| Optimizer     | 12 / DP (FP32-Master, Adam m, v)                                                                                  | A      |
| Aktivierungen | 34 · s · h je Layer (selektiv) bzw. 2 · s · h (voll) · Layer/PP · min(PP, Mikrobatches) / TP (Korthikanti et al.) | A      |
| Logits        | s · Vokabular · 4 / TP                                                                                            | A      |
| Laufzeit      | 5 GB + 8 % Fragmentierung, nutzbar 97 % HBM                                                                       | A      |

Passt keine Konfiguration, meldet die Submission `JOB_OUT_OF_MEMORY` mit dem kleinsten
erreichbaren Bedarf (z. B. 70B auf 8 × H100: 177,7 GB je GPU nötig).

### Schrittzeit

```
t_compute = Hardware-FLOPs / (GPUs · Peak_Präzision · η_Kernel · f_min)
t_pipe    = t_compute · Stufen-Ungleichgewicht · (1 + (PP − 1) / (v · m))
t_TP      = 0,6 · Bytes_TP / BW_NVLink                    (40 % überlappt, A)
t_PP      = 0,3 · Bytes_PP / BW_(NVLink|NIC)              (A)
t_DP      = max(0; Bytes_DP/BW_NIC + Bytes_DP_NVL/BW_NVLink − 0,8 · ⅔ · t_pipe)
t_Step    = (t_pipe + t_TP + t_PP + t_DP) · (1 + 0,0035 · log2(Nodes)) + 0,015 · t_compute
MFU       = F_Step / (t_Step · GPUs · Dense-Peak der Präzision)
```

| Parameter                                                     | Wert                                                                                                                    | Quelle                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `η_Kernel` (Anteil vom Dense-Peak bei GEMM-lastigem Training) | A100 0,62 · H100 0,58 · H200 0,60 · B200 0,52 · GB200 0,54 · MI300X 0,45 · MI325X 0,47                                  | A (kalibriert auf öffentliche MFU-Berichte) |
| FP8-Beschleunigung gegenüber BF16 (Ende-zu-Ende)              | 1,3                                                                                                                     | A                                           |
| NCCL-Busbandbreite                                            | NVLink 75 %, NIC 85 % der Linkrate                                                                                      | A                                           |
| Interleaving `v`                                              | 2, wenn Layer je Stufe gerade                                                                                           | A                                           |
| Stufen-Ungleichgewicht                                        | `(⌈L/PP⌉ + e) / ((L + e)/PP)`, `e = Vokabular/(12·h)` (LM-Head)                                                         | A                                           |
| Bytes TP                                                      | `4 · Layer/PP · m · 2(TP−1)/TP · s · h · 2` (× 1,5 bei vollem Recompute)                                                | A                                           |
| Bytes DP                                                      | `2 · (DP−1)/DP · Parameter/(TP·PP) · 2` (Reduce-Scatter + All-Gather)                                                   | A                                           |
| Hierarchische Reduktion                                       | DP-Ränge in derselben NVLink-Domäne reduzieren über NVLink, nur `1/k` über NIC (`k` = DP-Ränge je Domäne; NVL72 bis 18) | A                                           |
| Straggler                                                     | Synchrones Training läuft mit dem kleinsten Takt aller GPUs des Jobs                                                    | physikalisch                                |

Ergebnisse (nominal, gesunde Fabric): Llama 3.1 70B auf 256 × H100: TP8·PP2·DP16, 62 GB je
GPU, 17,5 s je Schritt, **46 % MFU**, 240 k Token/s. Llama 3.1 405B auf 16 384 × B200 mit
Batch 2048: **32 % MFU**. Zu kleine Batches für die Skala erzeugen einen sichtbaren Hinweis
(Pipeline-Blase).

### Laufzeitverhalten

| Phase                           | Dauer                                                                                                 | GPU-Last                                               | Quelle       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------ |
| Initialisierung                 | 45 s + 12 s · log2(Nodes) (+ Checkpoint laden bei Neustart)                                           | 4 %                                                    | A            |
| Training                        | Schrittzeit dynamisch je Tick                                                                         | Auslastung 97 %, Intensität 0,55 + 0,45 · Rechenanteil | A            |
| Checkpoint                      | `Größe / Storage-Bandbreite`, asynchron: 15 % blockierend                                             | 12 %                                                   | A            |
| Absturz erkannt (NCCL-Watchdog) | 60–180 s; GPUs hängen bei 100 % „Auslastung“, wenig Leistung                                          | 100 % / 0,12                                           | A            |
| Neustart                        | Teardown → Warteschlange → Init + Checkpoint laden; Fortschritt seit letztem Checkpoint geht verloren | —                                                      | physikalisch |

- Checkpoint-Größe: 14 Bytes je Parameter (BF16-Gewichte, FP32-Master, Adam m/v) (A).
- Storage-Bandbreite: min(Σ Speichersysteme, Nodes · Storage-NIC-Bandbreite) · 0,6 (A),
  geteilt zwischen gleichzeitig schreibenden Jobs. Ohne Shared Storage: lokale NVMe.
- **Goodput** = produktive Zeit / allozierte Zeit (verlorene Schritte werden abgezogen).

### Scheduler

Gang-Scheduling ganzer Nodes in strenger Priorität/FIFO-Reihenfolge (kein Backfill).
Topologiebewusst: bevorzugt die kleinste Leaf-Gruppe, die den Job vollständig aufnimmt;
sonst die größten Gruppen zuerst. Training verlangt Nodes ohne GPU-, NVSwitch-, Thermik- oder
NIC-Fehler; Nodes im Drain, in Wartung oder ohne Strom sind ausgeschlossen.

## 6. Inferenz

```
Gewichte/GPU   = Parameter · Bytes(Präzision) / TP
KV/Token/GPU   = 2 · L · KV-Heads · (h/Heads) · Bytes / min(TP, KV-Heads)
Max. Parallelität = KV-Kapazität / (Eingabe + Ausgabe), höchstens 512
Decode-Schritt  t(B) = max(a + b·B, c·B)
   a = Gewichte/(BW_HBM · η_HBM) + TP-Latenz (2 · L · 6 µs) + 2,5 ms Framework
   b = Kontext · KV/Token/GPU / (BW_HBM · η_HBM)
   c = 2 · N_aktiv / (TP · Peak · 0,4)
Prefill        = 2 · N_aktiv · Eingabe / (TP · Peak · 0,55)
```

Je Tick wird die angebotene Last auf gesunde Replikate verteilt; die Batchgröße folgt aus
`B / t(B) = Tokenrate`. Übersteigt die Last die Kapazität, wächst die Warteschlange; TTFT
enthält Warte- und Prefill-Zeit, TPOT den Decode-Schritt. SLO-Erfüllung: TTFT ≤ 2 s und
TPOT ≤ 100 ms (A). Fällt ein Node aus, verliert der Dienst dessen Replikate; der Scheduler
ersetzt sie durch freie Nodes (Modell laden: 40 s + Gewichte / Storage-Bandbreite + 20 s).

Parameter `η_HBM` (0,75–0,80), Prefill-Effizienz 0,55, Decode-Rechen-Effizienz 0,4 sind A.

## 7. Netzwerk (Scale-out-Fabric)

### Topologie

- **Rail-optimiert:** Je Rail (GPU-Index) ein eigener Fat-Tree; GPU _i_ jedes Nodes hängt am
  Rail _i_.
- **Fat-Tree:** Eine Ebene; alle Ports eines Nodes landen in derselben Leaf-Gruppe.
- Stufen je Ebene aus Radix `k` und Überbuchung `r`: ≤ k Endpunkte → 1 Switch;
  Downlinks `⌊k·r/(1+r)⌋`; ≤ k Leaves → 2 Stufen (Spines = ⌈Leaves · Uplinks / k⌉);
  sonst 3 Stufen (Pods aus k/2 Leaves, Core-Gruppen je Spine-Index). Mehr als k Pods →
  Validierungsfehler `FABRIC_TOO_LARGE`.
- Latenz: NIC (S) + Switch-Port-zu-Port (H/S) + Kabel 5 ns/m (3 m Zugang, 30 m Leaf–Spine,
  60 m Spine–Core) (A).

### Auslastung und Stau

```
Anteil über Leaf hinaus = 1 − (Job-Nodes unter diesem Leaf / Job-Nodes)        (A)
Uplink-Bedarf(Leaf)     = Σ Bedarf je Rail · Anteil
Uplink-Kapazität        = Σ intakte Trunks (ausgefallene Spines/Links zählen nicht)
Stau(Job)               = max(1; max über Leaves/Pods des Jobs Bedarf/Kapazität), geglättet τ = 20 s
```

Der Stau teilt die NIC-Bandbreite in der Schrittzeit. Bei 1:1-Fabrics entsteht Stau nur
nach Ausfällen; bei Überbuchung sinkt der Durchsatz verkehrsintensiver Jobs. Fällt ein
NIC/Rail aus, läuft der Verkehr über die übrigen Rails (Faktor intakte/alle Rails), und
Trainingsjobs auf dem Node brechen zunächst mit einem NCCL-Fehler ab.

Switch-Leistung: typische Leistung · (0,85 + 0,15 · Auslastung); ausgefallen 30 %,
administrativ aus 50 % (A).

## 8. Ausfallmodell

Ausfälle sind Poisson-Prozesse mit Rate `λ = AFR · Menge · Multiplikator / Jahr`.

| Komponente                       | AFR                                                                                      | Wirkung                                                                                                        | Quelle                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GPU inkl. HBM                    | 6–10 %/Jahr, Arrhenius-gewichtet (Ea = 0,5 eV, Bezug 70 °C), Leerlauf 40 % der Last-Rate | Xid-Verteilung unten                                                                                           | S (aus veröffentlichten Unterbrechungsstatistiken großer Trainingsläufe) |
| Netzteil                         | 1 % je PSU                                                                               | Redundanz ↓, ggf. Power Brake / Stromverlust                                                                   | S                                                                        |
| Lüfter                           | 2 % je Modul                                                                             | Luftstrom ↓ → höhere Temperatur                                                                                | A                                                                        |
| NIC                              | 1,2 % je Adapter + 3 % Linkflaps je Rail                                                 | Rail down; Flap erholt sich nach 20–180 s                                                                      | S/A                                                                      |
| DIMM (nicht korrigierbar)        | 0,4 % je DIMM                                                                            | Kernel Panic, Hardwaretausch                                                                                   | S                                                                        |
| NVMe                             | 0,44 % je Laufwerk (aus 2 Mio. h MTBF)                                                   | Node degradiert, Hot-Swap                                                                                      | S                                                                        |
| Node-Absturz (Software/Firmware) | 5 % je Node + CPU-AFR                                                                    | Node hängt, Neustart                                                                                           | A                                                                        |
| NVSwitch                         | 0,5 % je Chip                                                                            | GPUs isoliert, Hardwaretausch                                                                                  | S                                                                        |
| Fabric-Switch                    | 1,5–2 %                                                                                  | Leaf: Rail für alle angeschlossenen Nodes weg; Spine/Core: Kapazität ↓, übergreifende Jobs brechen mit 50 % ab | S/A                                                                      |
| CRAH / CDU / Kältemaschine       | 3–4 %                                                                                    | Kapazität ↓ → Temperaturen ↑                                                                                   | S                                                                        |

**GPU-Fehlerbilder (A, gewichtet):** Xid 79 „fallen off the bus“ 25 % (40 % davon
Hardwaredefekt), Xid 48 DBE 20 %, Xid 74 NVLink 15 %, Xid 94 eingedämmter ECC-Fehler 15 %
(nur Job-Abbruch), Xid 119 GSP-Timeout 10 %, Xid 63 Row-Remap ausstehend 8 % (GPU
degradiert, kein Abbruch), Xid 95 5 %, Xid 64 Remap-Fehler 2 % (Hardware). AMD-GPUs
erzeugen entsprechende `amdgpu`-RAS-Meldungen. Ein Neustart setzt Reset-pflichtige GPUs
zurück; ausgeführte Row-Remaps erhöhen den Zähler „retired rows“.

**POST-Fehler:** 0,4 % je Einschaltvorgang (A).

### Automatische Behebung

Mit aktivierter Auto-Remediation öffnet jeder Ausfall ein Ticket mit exponentialverteilter
Reparaturzeit (mindestens 10 min) um diese Mittelwerte (A): GPU-Reset 15 min, Absturz 15 min,
Thermal Trip 30 min, Hardwaretausch 4 h, Hot-Swap (PSU, Lüfter, NVMe) 2 h, Switch 2 h,
CRAH/CDU 8 h, Kältemaschine 24 h. Nodes mit laufendem Job werden zuerst gedraint.

Der globale Ausfall-Multiplikator (0 = aus, 1 = realistisch, bis 1000 = Chaos) skaliert alle
Raten.

## 9. Grenzen und Vereinfachungen

- Fabric-Verkehr wird auf Leaf-/Pod-Ebene aggregiert, nicht paket- oder flussgenau; Routing
  ist ideal verteilt (ECMP/adaptives Routing).
- Inferenz-Jobs belegen ganze Nodes; Kubernetes-artiges Teilen eines Nodes zwischen Jobs
  folgt später.
- MoE-Modelle verwenden aktive Parameter für FLOPs und Gesamtparameter für Speicher und
  DP-Verkehr; Expert-Parallel-All-to-All ist nicht modelliert.
- Der Scheduler kennt keine Präemption und kein Backfill.
- Speicher (Shared Storage) wird als Bandbreitenpool modelliert, nicht als Dateisystem.
- Klima ist ein deterministisches Sinusmodell ohne Wetterereignisse.
- Kosten (CapEx, Energie) sind Schätzungen für Größenordnungen, keine Angebote.

## 10. Performance

Gemessen mit `npm run bench` (gebündelt mit esbuild, Node 22, Container-CPU). „max ×realtime“
ist der höchste Zeitfaktor, den der Worker bei 60 % Rechenbudget halten kann.

| Vorlage             |   GPUs | Nodes | Szenario                              | ms/Tick | p95 ms | max ×realtime |
| ------------------- | -----: | ----: | ------------------------------------- | ------: | -----: | ------------: |
| single-server       |      8 |     1 | Last                                  |    0,03 |   0,06 |      > 10 000 |
| cluster-256         |    256 |    32 | Last                                  |    0,04 |   0,06 |      > 10 000 |
| enterprise-4096     |  4 096 |   512 | Last                                  |    0,91 |   1,42 |         ~ 650 |
| supercomputer-nvl72 |  4 608 | 1 152 | Last                                  |    1,56 |   2,38 |         ~ 390 |
| hyperscale-32k      | 32 768 | 4 096 | Leerlauf                              |    5,19 |   8,43 |         ~ 115 |
| hyperscale-32k      | 32 768 | 4 096 | Last (16k-GPU-Training, Ausfälle ×50) |    8,00 |  12,56 |          ~ 75 |

Im Browser (Chromium, Worker) lief die Hyperscale-Vorlage mit einem 16 384-GPU-Job stabil
bei 61× Echtzeit (7,3 ms/Tick); die Oberfläche blieb bei 60 fps. Snapshot-Erzeugung: < 10 ms,
Serialisierung des gesamten Zustands: < 2 ms (32 768 GPUs).
