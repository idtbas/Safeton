# Architektur

Safeton ist eine browserbasierte Betriebssystem-Simulation für KI-Rechenzentren. Alles, was
die Oberfläche zeigt, stammt aus einer deterministischen Simulationsengine; es gibt keine
Verbindung zu realer Hardware.

## Schichten

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ src/apps/        Anwendungen (ab Etappe 3) — registrieren nur ein Manifest   │
│ src/preview/     Etappe 1: Engineering Preview + Komponentengalerie          │
├──────────────────────────────────────────────────────────────────────────────┤
│ src/ui/          Designsystem: Tokens, Basiskomponenten, Formatierung        │
├──────────────────────────────────────────────────────────────────────────────┤
│ src/os/          OS-Kern: Kernel, Persistenz, Einstellungen, Fenster,        │
│                  Benachrichtigungen, Engine-Store, App-Registry               │
├───────────────────────────── Nachrichtenprotokoll ───────────────────────────┤
│ src/engine/      Simulationsengine (läuft im Web Worker)                      │
│   model/         InfraSpec → Topologie, Validierung, abgeleitete Kennzahlen  │
│   physics/       Elektrik-, Thermik- und Facility-Modelle                     │
│   sim/           Tick-Schleife, Zustände, Workloads, Ausfälle, Befehle       │
│   worker/        Protokoll, Worker-Host, Client                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ src/catalog/     Hardwarekatalog (reine Daten mit Quellenkategorie)           │
└──────────────────────────────────────────────────────────────────────────────┘
```

Abhängigkeiten zeigen nur nach unten. ESLint erzwingt, dass `src/engine` und `src/catalog`
weder React, Zustand, idb noch obere Schichten importieren (`no-restricted-imports`).

## Datenfluss

```
           Befehl (typisiert)                         Snapshot (4 Hz, transferierbar)
UI / Terminal ───────────────▶ Kernel ──▶ EngineClient ══▶ Worker: EngineHost ──▶ Simulation
     ▲                                                         │  Echtzeitschleife (50 ms)
     │                                                         │  sim.step() × N
     └──── Zustand-Stores ◀── ingestSnapshot ◀════════════════┘
                │
                └── Ereignisse ──▶ Benachrichtigungen (gefiltert nach Schweregrad)
```

1. **Spec → Topologie.** Eine `InfraSpec` beschreibt einen Standort kompakt (Hallen, Reihen,
   Rack-Gruppen `count × template`, Fabric, Storage, Anlagentechnik). `expandTopology`
   erzeugt daraus deterministisch jeden Rack, Node, GPU, Switch und Link (Struct-of-Arrays
   für Links). Gleiche Spec ⇒ gleicher Topologie-Fingerprint.
2. **Validierung.** `validateInfra` prüft zuerst Katalogreferenzen und Wertebereiche, danach
   physikalische Regeln (Platz, Gewicht, Leistung, Kühlung, Redundanz, Fabric, USV,
   Netzanschluss). Jedes Problem hat Code, Schweregrad, Spec-Pfad und Parameter.
3. **Simulation.** Die `Simulation` hält den Laufzeitzustand in Typed Arrays (`state.ts`)
   und rückt pro Tick um `dt` (Standard 1 s) vor — Phasen siehe
   [SIMULATION-MODEL.md](SIMULATION-MODEL.md).
4. **Worker.** `EngineHost` führt die Echtzeitschleife: Zeitfaktor × Echtzeit ergibt die
   Anzahl Ticks; pro 50-ms-Schleife höchstens 30 ms Rechenzeit. Reicht das nicht, wird der
   Rückstand verworfen und `lagging` gemeldet (keine Todesspirale). Snapshots enthalten
   Spaltendaten (Node-/Rack-/Switch-Arrays) als transferierbare Puffer.
5. **OS-Kern.** Der Kernel bootet in benannten Schritten (Speicher, Konfiguration, Katalog,
   Engine, Zustand, Telemetrie), spiegelt Snapshots in Zustand-Stores, leitet Ereignisse an
   die Benachrichtigungen weiter und speichert periodisch.

## Befehls-API

Alle Zustandsänderungen laufen über `Command` (`src/engine/sim/types.ts`) und werden mit
Tick im Journal festgehalten. GUI und künftiges Terminal rufen denselben Pfad
(`kernel.command`) auf und verhalten sich dadurch identisch.

| Bereich    | Befehle                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Simulation | `sim.setFailureRate`, `sim.setAutoRemediation`                                                                                       |
| Nodes      | `node.powerOn`, `node.powerOff`, `node.reboot`, `node.drain`, `node.resume`, `node.maintenance`, `node.repair`, `node.setPowerLimit` |
| Fabric     | `switch.setAdminState`, `switch.repair`                                                                                              |
| Facility   | `facility.setSetpoint`, `facility.repairAll`                                                                                         |
| Workloads  | `job.submit`, `job.cancel`, `job.setRequestRate`                                                                                     |
| Chaos      | `fault.inject` (Node-Crash, GPU-Xid, PSU, Lüfter, NIC, DIMM, Switch, Kühlgerät, Kältemaschine)                                       |

Node-Ziele (`NodeSelector`) sind Indizes, Hostnamen, `{ rack }`, `{ hall }` oder `'all'`.
Ergebnisse sind `{ ok: true, message, data? }` oder `{ ok: false, error: { code, message } }`.

Lesende Abfragen (`Query`): `topology`, `node.detail`, `job.detail`, `jobs`, `series`,
`events`, `plan` (Trockenlauf des Auto-Planers) und `stateHash`.

## Determinismus

- Ein einziger Zufallsgenerator (xoshiro128\*\*, seedbar, Zustand serialisierbar).
- Hardwarevarianz (thermischer Widerstand je GPU, Rack-Einlassversatz) wird aus dem
  Topologie-Fingerprint geseedet — sie ist eine Eigenschaft der „installierten Hardware“.
- Befehle wirken nur zwischen Ticks. Seed + Befehlsjournal bestimmen den Lauf vollständig.
- `stateHash()` hasht alle Arrays und Objektzustände; Tests prüfen gleiche Hashes für
  gleiche Läufe und für Läufe mit Speichern/Wiederherstellen mitten im Lauf.

## Persistenz

- IndexedDB-Datenbank `safeton` (Version 1) mit Store `docs` (Dokumente `settings`,
  `infra`, `sim-state`, `meta`) und `quarantine`.
- Jedes Dokument ist ein Umschlag `{ key, schemaVersion, savedAt, data }`. Beim Laden
  werden registrierte Migrationen (`MIGRATIONS[key][v]`: v → v+1) angewandt und mit Zod
  validiert. Ungültige oder zu neue Dokumente wandern in die Quarantäne; das System startet
  mit Standardwerten und meldet das als Benachrichtigung.
- Ohne IndexedDB (privater Modus, blockierter Speicher) arbeitet ein flüchtiger
  Speicher-Store; die Oberfläche zeigt „Volatile“.
- Export/Import: JSON-Bündel `safeton-export` v1 mit Einstellungen, Infrastruktur und
  Simulationszustand; Typed Arrays werden Base64-kodiert. Importierte Infrastruktur wird
  vor dem Laden vollständig validiert.
- Autosave im Intervall aus den Einstellungen sowie bei `visibilitychange`/`pagehide`.

## Erweiterung

- **Neue Hardware:** Datensatz in `src/catalog/*.ts` ergänzen (jeder Wert mit `vendor()`,
  `est()` oder `assume()`), `npm run docs:catalog` ausführen. Katalogtests prüfen
  Referenzen, Einheiten und Plausibilität.
- **Neue Plattform:** Komposition in `platforms.ts`; der Test „bottom-up power“ vergleicht
  die berechnete Spitzenleistung mit der veröffentlichten Systemleistung.
- **Neue Anwendung (ab Etappe 3):** Komponente unter `src/apps/<name>/` anlegen und ein
  `AppManifest` in `src/apps/index.ts` registrieren. Fenster entstehen über
  `useWindowStore.open(appId, …)`; Daten kommen ausschließlich aus `useEngineStore` und
  `kernel.query`/`kernel.command`.
- **Neuer Befehl:** Typ in `Command` ergänzen, Handler in `sim/commands.ts`. Der Compiler
  erzwingt die vollständige Behandlung (erschöpfender `switch`).
- **Schemaänderung persistierter Daten:** Version in `CURRENT_VERSIONS` erhöhen und eine
  Migration in `MIGRATIONS` registrieren.

## Entscheidungen

| Thema                      | Entscheidung                                                           | Begründung                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Build                      | Vite 8, React 19, TypeScript 6 (strict)                                | Schneller Build, Worker-Bundling eingebaut; TS 6 statt 7, weil typescript-eslint TS 7 noch nicht unterstützt |
| Zustand                    | Zustand 5                                                              | Minimal, selektive Abonnements, außerhalb von React nutzbar (Kernel)                                         |
| Engine-Laufzeit            | Web Worker, In-Process-Fallback                                        | UI bleibt auch bei 32 768 GPUs flüssig                                                                       |
| Laufzeitdaten              | Struct-of-Arrays in Typed Arrays                                       | Cache-freundlich, billig zu serialisieren und zu transferieren                                               |
| Validierung externer Daten | Zod 4                                                                  | Persistierte und importierte Daten sind nicht vertrauenswürdig                                               |
| Persistenz                 | IndexedDB über `idb`                                                   | Große Binärzustände (Typed Arrays) ohne Serialisierungsaufwand                                               |
| Icons / Schriften          | lucide-react, Inter + JetBrains Mono (selbst gehostet über Fontsource) | Keine externen Laufzeitabhängigkeiten, offline lauffähig                                                     |
| Routing (Etappe 1)         | Hash-basiert                                                           | Funktioniert auf GitHub Pages ohne Server-Rewrites                                                           |
