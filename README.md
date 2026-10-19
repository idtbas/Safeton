# Safeton

Browserbasiertes Betriebssystem zur Simulation und Verwaltung von KI-Rechenzentren — vom
einzelnen 8-GPU-Server bis zum Hyperscale-Campus mit 32 768 GPUs.

> **Alles ist simuliert.** Safeton steuert keine reale Hardware und baut keine
> Serververbindungen auf. Die Simulation ist deterministisch und leitet jeden angezeigten
> Wert aus Katalogdaten, Topologie, Workloads und Anlagenzustand ab.

**Stand: Etappe 2 von 5 + Desktop-Umgebung.** Safeton startet wie ein Betriebssystem:
Firmware/POST → Kernel & Dienste → Ersteinrichtung (13 Schritte) → Systeminitialisierung
(optional Kaltstart aller Nodes) → Anmeldung → Desktop mit Menüleiste, Dock, Fenstern,
Systemsuche, Kontroll- und Mitteilungszentrale. Sieben Anwendungen laufen in eigenen Fenstern:
Systemmonitor, Cluster-Manager (mit Node-Detailfenstern), Workloads, Rechenzentrum,
Ereignisse & Logs, Einstellungen und „Über Safeton“.

**Plattform:** nur Desktop-Computer und Tablets im Desktop-Modus (Querformat, ab 1024 × 640
Pixel). Safeton startet **ausschließlich als installierte Anwendung** (PWA: „Installieren“ in
Chrome/Edge, „Zum Dock hinzufügen“ in Safari, „Zum Home-Bildschirm“ auf dem iPad) — im
normalen Browser-Tab erscheint stattdessen die Installationsanleitung.

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

Im Entwicklungs-Build zeigt die Installationsseite zusätzlich „Im Browser fortfahren (nur
Entwicklungs-Build)“; Produktions-Builds haben diese Abkürzung nicht. Zum Testen der echten
Installation: `npm run build && npm run preview`, dann in Chrome über das Installationssymbol in
der Adressleiste installieren.

Beim ersten Start bootet das System und führt durch die Ersteinrichtung (Administrator,
Standort, Erscheinungsbild, Infrastruktur, Monitoring, Sicherheit). Der Fortschritt wird nach
jedem Schritt gespeichert; ein Neuladen setzt am selben Schritt fort. Während des Boots: `Esc`
überspringt, `V` zeigt die Boot-Konsole.

### Bedienung des Desktops

| Aktion                     | So geht's                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Programme starten          | Dock, Doppelklick auf Desktop-Symbole, Programmübersicht (Raster-Symbol im Dock)                        |
| Systemsuche                | `Strg/⌘ K` — Apps, Aktionen, Einstellungen, Nodes (Hostname/Rack), Jobs                                 |
| Fenster anordnen           | Titelleiste an linken/rechten Rand ziehen (halbe Fläche), an oberen Rand (Vollbild); `Strg Alt ←/→/↑/↓` |
| Fenster wechseln/schließen | ``Alt ` `` (wechseln), `Alt W` (schließen), `Alt M` (minimieren); Menü „Fenster“                        |
| Sperren · Neustart · Aus   | `Strg Alt L` · `Strg/⌘ R` · Systemmenü (Logo oben links)                                                |
| Systemzustand sichern      | `Strg/⌘ S`                                                                                              |
| Tastenkürzel               | `Strg/⌘ /`                                                                                              |

Rechtsklick öffnet Kontextmenüs (Schreibtisch, Fenstertitel, Dock); das Browser-Kontextmenü,
Seitenzoom und Textauswahl außerhalb von Inhalten sind abgeschaltet. Entwicklerwerkzeug:
Hilfe → Entwicklung → Designsystem (`#/components`).

## Skripte

| Befehl                            | Zweck                                                                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Entwicklungsserver                                                                                                                                                                 |
| `npm run build`                   | Typecheck und Produktions-Build nach `dist/`                                                                                                                                       |
| `npm run preview`                 | Produktions-Build lokal ausliefern                                                                                                                                                 |
| `npm test`                        | Vitest-Testsuite (Katalog, Validierung, Physik, Determinismus, Energiebilanz, Workloads, Ausfälle, Persistenz, Fenster, Shell-Zustandsmaschine, Setup, Migration, Anmeldung, i18n) |
| `npm run test:e2e`                | Playwright-Browsertest: kompletter Setup-Durchlauf mit Reload, Boot, Login, zweiter Start; Screenshots in `e2e/screenshots/`                                                       |
| `npm run typecheck`               | TypeScript (strict)                                                                                                                                                                |
| `npm run lint`                    | ESLint inkl. Schichtregeln (Engine darf keine UI importieren)                                                                                                                      |
| `npm run format` / `format:check` | Prettier                                                                                                                                                                           |
| `npm run check`                   | Typecheck, Lint, Format und Tests in einem                                                                                                                                         |
| `npm run bench`                   | Engine-Benchmark über alle Vorlagen                                                                                                                                                |
| `npm run icons`                   | App-Icons (PNG) aus den SVG-Quellen in `public/icons` erzeugen                                                                                                                     |
| `npm run docs:catalog`            | `docs/CATALOG.md` aus dem Katalog neu erzeugen                                                                                                                                     |

## Deployment auf GitHub Pages

Der Workflow `.github/workflows/ci.yml` prüft jeden Push und Pull Request (Typecheck, Lint,
Format, Tests, Build, Playwright-Browsertests mit Screenshots als Artefakt). Pushes auf den **Standard-Branch** werden zusätzlich auf GitHub Pages
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
  os/        OS-Kern: Kernel, Persistenz, Einstellungen, Fenster, Benachrichtigungen, App-Registry,
             Shell-Zustandsmaschine, Setup-Modell, Konten, i18n, Bestätigungsdienst
  shell/     OS-Oberfläche: Plattform-Gates, Boot, Ersteinrichtung, Anmeldung/Sperre, Desktop
  ui/        Designsystem: Tokens, Komponenten, Formatierung
  apps/      Anwendungen (Systemmonitor, Cluster, Workloads, Rechenzentrum, Ereignisse, Einstellungen, Über)
  preview/   Entwicklerwerkzeug: Komponentengalerie des Designsystems
e2e/         Playwright-Browsertests
docs/        Vision, Architektur, Simulationsmodell, Katalog
scripts/     Benchmark und Dokumentgenerator
```
