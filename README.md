# Safeton

Browserbasiertes Betriebssystem zur Simulation und Verwaltung von KI-Rechenzentren — vom
einzelnen 8-GPU-Server bis zum Hyperscale-Campus mit 32 768 GPUs.

> **Alles ist simuliert.** Safeton steuert keine reale Hardware und baut keine
> Serververbindungen auf. Die Simulation ist deterministisch und leitet jeden angezeigten
> Wert aus Katalogdaten, Topologie, Workloads und Anlagenzustand ab.

**Stand: Etappe 1 von 5 — Fundament.** Enthalten sind Hardwarekatalog,
Infrastrukturmodell mit Validierung, Simulationsengine im Web Worker, Persistenz,
OS-Kern und Designsystem sowie eine interne _Engineering Preview_ zum Nachweis. Boot,
Ersteinrichtung, Desktop und Anwendungen folgen in den nächsten Etappen.

- Vision: [docs/VISION.md](docs/VISION.md)
- Architektur: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Simulationsmodell (Formeln, Annahmen, Performance): [docs/SIMULATION-MODEL.md](docs/SIMULATION-MODEL.md)
- Hardwarekatalog mit Quellenkategorie jedes Werts: [docs/CATALOG.md](docs/CATALOG.md)

## Schnellstart

Voraussetzung: Node.js ≥ 22.12 und npm.

```bash
npm ci
npm run dev        # Entwicklungsserver, http://localhost:5173
```

Die Startseite ist die Engineering Preview (`#/preview`), die Komponentengalerie liegt
unter `#/components`.

### Was die Engineering Preview zeigt

1. **Infrastrukturvorlage laden** — sechs Vorlagen (Einzelserver bis Hyperscale) inklusive
   Validierungsbericht und abgeleiteter Kennzahlen (Peak-FLOPS, HBM, Fabric, Leistung, PUE,
   CapEx, Energiekosten).
2. **Simulation steuern** — Start/Pause, Einzelschritte, Zeitfaktor 1×–1800×,
   Ausfallrate, automatische Behebung.
3. **Trainingsjob starten** — der Auto-Planer zeigt Parallelisierung, Speicherbedarf, Schrittzeit
   und MFU vor dem Absenden. Danach steigen Auslastung, Leistung, Temperatur,
   HBM-Belegung und Fabric-Verkehr kausal an; Checkpoints erscheinen im Ereignisprotokoll.
4. **Ausfälle auslösen** — Node-Crash, GPU-Xid, PSU, NIC, Lüfter, Switch, Kühlgerät,
   Kältemaschine. Jobs brechen ab, verlieren den Fortschritt seit dem letzten Checkpoint und
   starten neu; Nodes werden repariert.
5. **Persistenz** — Zustand wird automatisch in IndexedDB gespeichert; nach einem Neuladen
   läuft die Simulation an derselben Stelle weiter. Export/Import als JSON, Reset.

## Skripte

| Befehl                            | Zweck                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Entwicklungsserver                                                                                                      |
| `npm run build`                   | Typecheck und Produktions-Build nach `dist/`                                                                            |
| `npm run preview`                 | Produktions-Build lokal ausliefern                                                                                      |
| `npm test`                        | Vitest-Testsuite (Katalog, Validierung, Physik, Determinismus, Energiebilanz, Workloads, Ausfälle, Persistenz, Fenster) |
| `npm run typecheck`               | TypeScript (strict)                                                                                                     |
| `npm run lint`                    | ESLint inkl. Schichtregeln (Engine darf keine UI importieren)                                                           |
| `npm run format` / `format:check` | Prettier                                                                                                                |
| `npm run check`                   | Typecheck, Lint, Format und Tests in einem                                                                              |
| `npm run bench`                   | Engine-Benchmark über alle Vorlagen                                                                                     |
| `npm run docs:catalog`            | `docs/CATALOG.md` aus dem Katalog neu erzeugen                                                                          |

## Deployment auf GitHub Pages

Der Workflow `.github/workflows/ci.yml` prüft jeden Push und Pull Request (Typecheck, Lint,
Format, Tests, Build). Pushes auf den **Standard-Branch** werden zusätzlich auf GitHub Pages
veröffentlicht; der Basis-Pfad (z. B. `/Safeton/`) wird automatisch gesetzt.

Einmalige Einrichtung im Repository:

1. **Settings → Pages → Build and deployment → Source: „GitHub Actions“** auswählen.
2. Den Branch, der veröffentlicht werden soll, als Standard-Branch festlegen (oder Etappen
   per Pull Request in den Standard-Branch übernehmen).

Lokal lässt sich ein Pages-Build mit Unterpfad so prüfen:

```bash
BASE_PATH=/Safeton/ npm run build && npx vite preview --base /Safeton/
```

## Projektstruktur

```
src/
  catalog/   Hardwarekatalog (GPUs, CPUs, Speicher, Netzwerk, Plattformen, Anlagentechnik, Modelle)
  engine/    Simulationsengine: model/ physics/ sim/ worker/
  os/        OS-Kern: Kernel, Persistenz, Einstellungen, Fenster, Benachrichtigungen, App-Registry
  ui/        Designsystem: Tokens, Komponenten, Formatierung
  apps/      Anwendungen (Registry-Schnittstelle, ab Etappe 3 befüllt)
  preview/   Etappe 1: Engineering Preview und Komponentengalerie
docs/        Vision, Architektur, Simulationsmodell, Katalog
scripts/     Benchmark und Dokumentgenerator
```
