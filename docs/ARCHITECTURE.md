# Architektur

Safeton ist eine browserbasierte Betriebssystem-Simulation für KI-Rechenzentren. Alles, was
die Oberfläche zeigt, stammt aus einer deterministischen Simulationsengine; es gibt keine
Verbindung zu realer Hardware.

## Schichten

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ src/apps/        Anwendungen (Monitor, Cluster, Workloads, Anlage, …)        │
│ src/shell/       OS-Oberfläche: Plattform-Gates, Boot, Ersteinrichtung,      │
│                  Anmeldung, Desktop (Menüleiste, Dock, Fenster, Panels)      │
│ src/preview/     Internes Werkzeug: Komponentengalerie (#/components)        │
├──────────────────────────────────────────────────────────────────────────────┤
│ src/ui/          Designsystem: Tokens, Basiskomponenten, Formatierung        │
├──────────────────────────────────────────────────────────────────────────────┤
│ src/os/          OS-Kern: Kernel, Persistenz, Einstellungen, Fenster,        │
│                  Benachrichtigungen, Engine-Store, App-Registry, Shell-      │
│                  Zustandsmaschine, Setup-Modell, Konten, i18n,               │
│                  Bestätigungen, Plattformprüfung                             │
├───────────────────────────── Nachrichtenprotokoll ───────────────────────────┤
│ src/engine/      Simulationsengine (läuft im Web Worker)                     │
│   model/         InfraSpec → Topologie, Validierung, abgeleitete Kennzahlen  │
│   physics/       Elektrik-, Thermik- und Facility-Modelle                    │
│   sim/           Tick-Schleife, Zustände, Workloads, Ausfälle, Befehle       │
│   worker/        Protokoll, Worker-Host, Client                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ src/catalog/     Hardwarekatalog (reine Daten mit Quellenkategorie)          │
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
  `infra`, `sim-state`, `meta`, `account`, `setup`) und `quarantine`.
- Jedes Dokument ist ein Umschlag `{ key, schemaVersion, savedAt, data }`. Beim Laden
  werden registrierte Migrationen (`MIGRATIONS[key][v]`: v → v+1) angewandt und mit Zod
  validiert. Ungültige oder zu neue Dokumente wandern in die Quarantäne; das System startet
  mit Standardwerten und meldet das als Benachrichtigung.
- Ohne IndexedDB (privater Modus, blockierter Speicher) arbeitet ein flüchtiger
  Speicher-Store; die Oberfläche zeigt „Volatile“.
- Export/Import: JSON-Bündel `safeton-export` v1 mit Einstellungen (inkl. Schemaversion,
  ältere Stände werden beim Import migriert), Administratorkonto, Infrastruktur und
  Simulationszustand; Typed Arrays werden Base64-kodiert. Importierte Infrastruktur wird
  vor dem Laden vollständig validiert.
- Autosave im Intervall aus den Einstellungen sowie bei `visibilitychange`/`pagehide`.
- Einstellungen tragen Schemaversion **3**. `migrateSettingsV1toV2`
  (`MIGRATIONS.settings[1]`) ergänzt Monitoring-Schwellwerte, Sicherheitsoptionen,
  Telemetrieintervall, Startmodus und Anzeigenamen; `migrateSettingsV2toV3`
  (`MIGRATIONS.settings[2]`) ergänzt den Abschnitt `desktop` (Hintergrund, Dock-Apps,
  Dock-Vergrößerung, Desktopsymbole, Widget, Sekundenanzeige). Vorhandene Werte bleiben
  jeweils erhalten.

## Shell-Ablauf

Die Oberfläche ist eine reine Zustandsmaschine (`src/os/shell/machine.ts`,
`transition(state, event)`); `src/shell/ShellApp.tsx` rendert nur den Bildschirm zur Phase.
Nicht definierte Übergänge werden verworfen, unmögliche Kombinationen (z. B. Workspace ohne
Anmeldung) sind damit ausgeschlossen.

```
firmware ──FIRMWARE_DONE──▶ kernel ──CORE_READY{setupRequired}──┬──▶ setup ──SETUP_SUBMITTED──▶ initializing
                                                                │                                   │ INITIALIZED
                                                                └──────────────▶ infrastructure ◀───┘
                                                                                     │ INFRA_READY
                                       LOGOUT ┌──────────────────────────────▶ login ◀───────┐
                                              │                                │ AUTHENTICATED │ LOGOUT
                                         locked ◀──LOCK── workspace ◀──────────┘               │
                                              └──UNLOCKED──▶ workspace ────────────────────────┘
FAIL (jede Phase) ──▶ error            RESTART ──▶ firmware
SHUTDOWN (login / workspace / locked) ──▶ off  (Einschalten = Neuladen ⇒ firmware)
```

Der Kernel bootet in zwei Phasen, damit die Ersteinrichtung dazwischen liegen kann:

| Phase                       | Kernel-Funktion         | Schritte                                                                  |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| Kern                        | `bootCore()`            | Speicher, Konfiguration, Katalog, Administratorverzeichnis, Engine-Worker |
| Infrastruktur               | `startInfrastructure()` | Zustand wiederherstellen oder Spezifikation initialisieren, Telemetrie    |
| Beides (Komponentengalerie) | `bootKernel()`          | Kern + Infrastruktur                                                      |

`setupRequired` ist wahr, solange `settings.system.setupComplete` fehlt oder kein
Administratorkonto existiert. `resetAndReconfigure()` löscht alle Dokumente und startet neu
in die Ersteinrichtung.

**Boot-Animation** (`src/shell/boot/BootScreen.tsx`): Jede Zeile beruht auf echten Daten —
Browser-Host (Kerne, Speicher, Anzeige, Speicherkontingent, Web Crypto, Worker), gemessene
Kernel-Schritte, Katalogversion, Speicher-Backend, Worker-Modus, die expandierte Topologie
(Hallen, Racks, Nodes, GPUs, Switches, Links, Fabric-Ebenen) und der erste Engine-Snapshot
(IT-Last, USV-Auslastung, Zuluft, Kältemaschinen). Die Taktung verteilt die Darstellung auf
≈ 6–10 s; `Esc` überspringt, `V` schaltet das ausführliche Textprotokoll um. Reduzierte
Bewegung (System oder Einstellung) schaltet Animationen ab.

**Start-Semantik:** `startMode = 'warm'` startet Nodes eingeschaltet. `'cold'` wirkt bei der
Inbetriebnahme ohne gespeicherten Zustand: Die Engine startet mit `initialPower: 'offline'`,
der Kernel schaltet alle Nodes ein, und der Boot wartet (Simulationszeit beschleunigt auf
60×), bis `bootMinCapacity` der Nodes POST und OS-Boot durchlaufen hat (Zeitlimit 60 s
Echtzeit, überspringbar). Spätere Starts hängen sich an den persistierten, laufenden Cluster
an (`infrastructureStartKind() === 'restored'`) — wie ein Management-Server, der neu startet,
während das Rechenzentrum weiterläuft.

## Ersteinrichtung

`src/os/setup/model.ts` enthält Datenmodell, Validierung und einen reinen Reducer; die
Oberfläche (`src/shell/setup/`) ist dünn.

| #   | Schritt              | Daten (`SetupData`)                | Wirkt auf                                                         |
| --- | -------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| 1   | Willkommen           | —                                  | —                                                                 |
| 2   | Sprache & Region     | `region`                           | `settings.region`, i18n, Formatierung                             |
| 3   | Administrator        | `admin` (Credential, nie Klartext) | Dokument `account`, `settings.system.operator/operatorName`       |
| 4   | System & Standort    | `system`                           | `settings.system.hostname`, Spezifikation (Name, Standort, Code)  |
| 5   | Erscheinungsbild     | `appearance` (Live-Vorschau)       | `settings.appearance`                                             |
| 6   | Infrastrukturprofil  | `infra.templateId`                 | setzt `infra.design` aus der Vorlage                              |
| 7   | Hardware             | `infra.design.compute/halls/…`     | `designInfrastructure` → Spezifikation                            |
| 8   | Netzwerk             | `infra.design.fabric`, Compute-NIC | Spezifikation                                                     |
| 9   | Standort & Anlage    | Klima, Energiepreis, Sollwerte     | Spezifikation (Anlage wird N+1 automatisch dimensioniert)         |
| 10  | Monitoring           | `monitoring`                       | `settings.simulation.snapshotHz/telemetryIntervalS`, `monitoring` |
| 11  | Sicherheit & Betrieb | `operations`                       | `settings.security`, `settings.simulation`                        |
| 12  | Überprüfung          | —                                  | blockiert bei `validateInfra`-Fehlern, Rücksprung zum Schritt     |
| 13  | Initialisierung      | —                                  | `completeSetup()`                                                 |

- **Entwurf:** `SetupDraft { version, current, completed[], data }` wird nach jeder Änderung
  (300 ms entprellt) und bei `pagehide` als Dokument `setup` gespeichert. Nach einem Reload
  geht es am selben Schritt weiter; eine unterbrochene Initialisierung kehrt zur Überprüfung
  zurück.
- **Validierung:** `validateStep` liefert Feld → i18n-Schlüssel. Schritte 7–9 validieren
  Feldbereiche sofort und die Engineering-Prüfung (`validateSetupInfra`, memoisiert)
  entprellt (250 ms) im Live-Panel. `stepForIssue` ordnet jede Validierungsmeldung dem
  zuständigen Schritt zu.
- **Navigation:** `setupReducer` (`next`/`back`/`goto`/`update`/`selectTemplate`). `next`
  validiert den aktuellen Schritt; `goto` erlaubt nur erreichbare Schritte; ein Profilwechsel
  setzt die abhängigen Schritte 7–9 und die Überprüfung zurück.
- **Commit:** `completeSetup` schreibt Konto und Spezifikation, danach die Einstellungen —
  `setupComplete` ist die Commit-Markierung, ein Abbruch davor lässt das System im
  Setup-Modus mit intaktem Entwurf. Anschließend startet die Infrastrukturphase.

## Konten und Anmeldung

- Ein lokales Administratorkonto (`src/os/auth/credentials.ts`): PBKDF2-HMAC-SHA-256 über
  Web Crypto, 600 000 Iterationen, 128-Bit-Salt, konstante Vergleichszeit. Das Passwort
  verlässt den Browser nie und wird nie im Klartext gespeichert.
- Richtlinie: ≥ 12 Zeichen, ≥ 3 Zeichenklassen, enthält nicht den Benutzernamen, keine
  gängigen Passwörter.
- Fehlversuche: ab dem dritten in Folge Sperre 1 s, 2 s, 4 s … (max. 30 s).
- Sitzungen werden nicht persistiert: Ein Neuladen entspricht einem Neustart der Konsole und
  verlangt erneute Anmeldung. Inaktivität sperrt den Bildschirm (oder meldet ab) nach
  `security.sessionTimeoutMin`.
- Dies schützt nur die simulierte Konsole vor beiläufigem Zugriff; es ist kein
  Sicherheitsmechanismus für reale Infrastruktur.

## Internationalisierung

- `src/os/i18n/en.ts` ist das Quellwörterbuch (`as const`, liefert den Typ `MessageKey`),
  `de.ts` ist als `Record<MessageKey, string>` typisiert — fehlende Übersetzungen sind
  Compilerfehler. Ein Test prüft zusätzlich gleiche Schlüssel und Platzhalter.
- `useT()` (React) bzw. `t()` (Kernel) übersetzen mit `{name}`-Interpolation; die Sprache folgt
  `settings.region.locale`. Der Setup-Assistent nutzt `useT(draft.locale)` für eine
  Live-Umschaltung.
- Engine-Ereignistexte bleiben englisch, wie in realen Infrastruktur-Logs.

## Überwachung und Bestätigungen

- Der Kernel wertet jeden Snapshot gegen `settings.monitoring` aus (max. GPU-Temperatur
  Warnung/kritisch, Hallen-Zuluft, PUE ab 30 % Auslegungslast). Alarme sind flankengesteuert
  mit Hysterese (`useAlertStore`) und erzeugen Benachrichtigungen bei Eintritt und Ende.
- `src/os/confirm.ts`: `requestConfirm()` / `confirmCommand(cmd)`. Kritische Befehle
  (Ausschalten, Neustart, Wartung, Fehlerinjektion, Job-Abbruch, Switch deaktivieren) werden
  bestätigt, wenn `security.confirmCritical` aktiv ist. `ConfirmHost` rendert die Anfrage.

## Erweiterung

- **Neue Hardware:** Datensatz in `src/catalog/*.ts` ergänzen (jeder Wert mit `vendor()`,
  `est()` oder `assume()`), `npm run docs:catalog` ausführen. Katalogtests prüfen
  Referenzen, Einheiten und Plausibilität.
- **Neue Plattform:** Komposition in `platforms.ts`; der Test „bottom-up power“ vergleicht
  die berechnete Spitzenleistung mit der veröffentlichten Systemleistung.
- **Neue Anwendung:** Komponente unter `src/apps/<name>/` anlegen (Standardexport, wird
  per `lazy()` nachgeladen), Texte in `en.ts`/`de.ts` ergänzen und ein `AppManifest`
  (Titel, Beschreibung, Symbol, Farbton, Kategorie, Größen, `singleton`) in
  `src/apps/index.ts` registrieren. Damit erscheint die App im Starter, in der Suche und
  optional im Dock. Geöffnet wird über `openApp(appId, args)` (`src/apps/launch.ts`); Daten
  kommen ausschließlich aus `useEngineStore` und `kernel.query`/`kernel.command`
  (Befehle mit Bestätigung über `run()` aus `src/apps/common/shared.ts`).
- **Neuer Befehl:** Typ in `Command` ergänzen, Handler in `sim/commands.ts`. Der Compiler
  erzwingt die vollständige Behandlung (erschöpfender `switch`).
- **Schemaänderung persistierter Daten:** Version in `CURRENT_VERSIONS` erhöhen und eine
  Migration in `MIGRATIONS` registrieren.

## Entscheidungen

| Thema                      | Entscheidung                                                              | Begründung                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Build                      | Vite 8, React 19, TypeScript 6 (strict)                                   | Schneller Build, Worker-Bundling eingebaut; TS 6 statt 7, weil typescript-eslint TS 7 noch nicht unterstützt |
| Zustand                    | Zustand 5                                                                 | Minimal, selektive Abonnements, außerhalb von React nutzbar (Kernel)                                         |
| Engine-Laufzeit            | Web Worker, In-Process-Fallback                                           | UI bleibt auch bei 32 768 GPUs flüssig                                                                       |
| Laufzeitdaten              | Struct-of-Arrays in Typed Arrays                                          | Cache-freundlich, billig zu serialisieren und zu transferieren                                               |
| Validierung externer Daten | Zod 4                                                                     | Persistierte und importierte Daten sind nicht vertrauenswürdig                                               |
| Persistenz                 | IndexedDB über `idb`                                                      | Große Binärzustände (Typed Arrays) ohne Serialisierungsaufwand                                               |
| Icons / Schriften          | lucide-react, Inter + JetBrains Mono (selbst gehostet über Fontsource)    | Keine externen Laufzeitabhängigkeiten, offline lauffähig                                                     |
| Routing                    | Hash-basiert; `#/components` internes Werkzeug, sonst Shell               | Funktioniert auf GitHub Pages ohne Server-Rewrites                                                           |
| Shell-Ablauf               | Reine Zustandsmaschine + Phasen-Rendering                                 | Testbar ohne DOM, keine widersprüchlichen Flags                                                              |
| i18n                       | Eigene typisierte Wörterbücher (de/en)                                    | Kein Laufzeit-Framework nötig; Vollständigkeit vom Compiler erzwungen                                        |
| Passwörter                 | PBKDF2-SHA-256, 600 000 Iterationen (Web Crypto)                          | OWASP-Empfehlung, ohne Zusatzbibliothek verfügbar                                                            |
| Browsertests               | Playwright gegen den Produktions-Build                                    | Prüft den echten Ablauf inkl. IndexedDB, Worker und Reload                                                   |
| Auslieferung               | Nur als installierte PWA (standalone), nur Desktop/Tablet im Desktopmodus | Fühlt sich wie ein eigenständiges System an: kein Browser-Rahmen, offline startfähig                         |
| Fenster-Inhalt             | Lazy geladene Apps, Fehlergrenze pro Fenster, Container Queries           | Kleiner Start-Bundle; ein App-Fehler reißt den Desktop nicht mit; Layout passt sich der Fenstergröße an      |
| Menüs                      | Portale in `document.body`                                                | Verschachteltes `backdrop-filter` der Menüleiste würde Menüs sonst unscharf/transparent machen               |

## Plattform und Auslieferung

`src/Root.tsx` prüft vor allem anderen zwei Bedingungen (`src/os/platform.ts`, reine und
getestete Funktionen):

1. **Gerät** (`assessDevice`): Smartphones (iPhone, Android mit „Mobile“,
   `userAgentData.mobile`) und Tablets in der Mobilansicht (iPad-UA, Android ohne „Mobile“)
   werden abgewiesen, ebenso Bildschirme unter 1024 × 640 CSS-Pixeln. iPadOS im
   Desktopmodus meldet sich als „Macintosh“ mit Touchpunkten und ist zugelassen.
2. **Installation** (`isStandaloneDisplay`): Die Konsole läuft nur als installierte
   Anwendung (`display-mode` standalone / fullscreen / window-controls-overlay oder
   `navigator.standalone`). Sonst zeigt `InstallGate` plattformgerechte Anweisungen
   (Chromium: Installationsdialog über `beforeinstallprompt`; Safari macOS: „Zum Dock
   hinzufügen“; iPadOS: Teilen → „Zum Home-Bildschirm“; Firefox: anderer Browser nötig) und
   eine Prüfung der Voraussetzungen (Web Crypto, IndexedDB, Worker, sicherer Kontext).
   Nur der Entwicklungs-Build (`npm run dev`) bietet „Im Browser fortfahren“.

Während des Betriebs blendet `ViewportGuard` unter 1024 × 600 Pixeln eine Sperre ein
(„Fenster vergrößern“ bzw. „Gerät drehen“).

- **Manifest** (`public/manifest.webmanifest`): `standalone` mit `display_override`
  `window-controls-overlay`, Querformat, Symbole in 192/512 px inkl. maskierbarer Variante
  (`npm run icons` erzeugt die PNGs aus den SVGs).
- **Service Worker** (`public/sw.js`, nur im Produktions-Build registriert): Navigation
  netzwerk-first mit Offline-Rückfall, Assets cache-first. Der Cache-Name enthält den Scope.
- **Window Controls Overlay:** Die Menüleiste nutzt `env(titlebar-area-*)` und
  `app-region: drag`, sodass sie unter Windows/ChromeOS/macOS die Titelleiste ersetzt.
- **Browserverhalten abgeschaltet** (`src/shell/useOsChrome.ts`): Kontextmenü (außer in
  Eingabefeldern), Seitenzoom per Strg+Mausrad/Strg ±, Pinch-Gesten, Ziehen von Bildern und
  Links, Textauswahl außerhalb von Inhalten.

## Desktop-Umgebung

`src/shell/desktop/` bildet die Arbeitsumgebung nach der Anmeldung:

| Teil              | Datei                                  | Aufgabe                                                                                     |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| Menüleiste        | `MenuBar.tsx`                          | Systemmenü, App-, Fenster-, Gehe-zu-, Hilfemenü; Statusbereich (Cluster, Alarme, Uhr)       |
| Dock              | `Dock.tsx`                             | Angeheftete und laufende Apps, Laufanzeige, Vergrößerung, Starter                           |
| Starter / Suche   | `Launcher.tsx`                         | Apps, Nodes und Jobs durchsuchen (Strg/⌘ + K oder Strg/⌘ + Leertaste)                       |
| Panels            | `Panels.tsx`                           | Kontrollzentrum, Mitteilungszentrale, Kalender                                              |
| Fenster           | `WindowLayer.tsx`, `os/windows/*`      | Ziehen, Größe, Einrasten (links/rechts/maximieren), Kacheln, Wechseln, Fehlergrenze pro App |
| Oberfläche        | `DesktopSurface.tsx`                   | Hintergrund, Desktopsymbole, Cluster-Widget, Kontextmenü                                    |
| Systemdialoge     | `SystemDialogs.tsx`                    | Neustart/Ausschalten mit 60-s-Countdown, Tastenkürzel                                       |
| Aktionen / Kürzel | `actions.ts`, `useDesktopShortcuts.ts` | Sperren, Abmelden, Ruhezustand, Neustart, Ausschalten, Speichern, Vollbild                  |
| Energiezustände   | `../PowerScreens.tsx`                  | Ausgeschaltet (Einschalten = Kaltstart) und Ruhezustand                                     |

Anwendungen (`src/apps/`):

| App           | ID          | Inhalt                                                                                                                         |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Monitor       | `monitor`   | Simulationssteuerung, Kennzahlen, Leistungsbilanz, Node-Zustände, Engine-Leistung                                              |
| Cluster       | `cluster`   | Node-Karte (Auslastung/Temperatur/Leistung), Auswahl, Befehle, Fehlerinjektion                                                 |
| Node          | `node`      | Einzelner Node (mehrere Fenster möglich): GPUs, Sensoren, Fehler, Befehle                                                      |
| Workloads     | `workloads` | Jobs planen (Auto-Planer-Vorschau) und starten, laufende Jobs, Abbruch                                                         |
| Anlage        | `facility`  | Übersicht, Anlagentechnik (USV, Kühlung), Konfiguration und Sollwerte                                                          |
| Ereignisse    | `events`    | Ereignisprotokoll mit Filter nach Schweregrad, Quelle und Text                                                                 |
| Einstellungen | `settings`  | Konto (inkl. Passwortwechsel), Darstellung, Desktop, Region, Mitteilungen, Monitoring, Sicherheit, Simulation, Sicherung, Info |
| Über Safeton  | `about`     | Version, System- und Clusterdaten                                                                                              |

Fensterlayouts werden nicht persistiert: Ein Neustart beginnt mit leerem Desktop.
