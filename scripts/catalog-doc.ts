/**
 * Generates docs/CATALOG.md: every catalog value with its provenance category.
 * Usage: npm run docs:catalog
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATALOG, CATALOG_VERSION, allCatalogItems, type Q } from '../src/catalog';

const LABEL: Record<Q['src'], string> = {
  vendor: 'Hersteller',
  estimate: 'Schätzung',
  assumption: 'Annahme',
};

function rows(obj: unknown, path = ''): [string, Q][] {
  if (!obj || typeof obj !== 'object') return [];
  if ('v' in obj && 'src' in obj) return [[path, obj as Q]];
  return Object.entries(obj).flatMap(([k, v]) => rows(v, path ? `${path}.${k}` : k));
}

const fmt = (v: number) =>
  Number.isInteger(v) ? v.toLocaleString('en-US') : String(Number(v.toPrecision(6)));
const sections: [string, readonly { id: string; name?: string }[]][] = [
  ['GPUs', CATALOG.gpus],
  ['CPUs', CATALOG.cpus],
  ['Arbeitsspeicher (DIMMs)', CATALOG.dimms],
  ['NVMe', CATALOG.nvme],
  ['Netzwerkadapter', CATALOG.nics],
  ['Switches', CATALOG.switches],
  ['NVSwitch', CATALOG.nvswitches],
  ['Netzteile', CATALOG.psus],
  ['Speichersysteme', CATALOG.storage],
  ['Racks', CATALOG.racks],
  ['PDUs', CATALOG.pdus],
  ['USV', CATALOG.ups],
  ['Kühlung', CATALOG.cooling],
  ['Superchips', CATALOG.superchips],
  ['Server-Plattformen', CATALOG.platforms],
  ['Rack-Systeme', CATALOG.rackSystems],
  ['Modellarchitekturen', CATALOG.models],
];

let total = 0;
const counts: Record<Q['src'], number> = { vendor: 0, estimate: 0, assumption: 0 };
let body = '';
for (const [title, items] of sections) {
  body += `\n## ${title}\n`;
  for (const item of items) {
    const values = rows(item).filter(([p]) => p !== '');
    body += `\n### ${item.name ?? item.id} \`${item.id}\`\n\n| Feld | Wert | Quelle | Hinweis |\n|---|---:|---|---|\n`;
    for (const [path, q] of values) {
      total++;
      counts[q.src]++;
      body += `| ${path} | ${fmt(q.v)} | ${LABEL[q.src]} | ${q.note ?? ''} |\n`;
    }
  }
}

const header = `# Hardwarekatalog — Werte und Quellenkategorien

> Automatisch erzeugt aus \`src/catalog\` (Katalogversion ${CATALOG_VERSION}) mit \`npm run docs:catalog\`. Nicht von Hand bearbeiten.

Jeder Zahlenwert im Katalog trägt eine Quellenkategorie:

- **Hersteller** — veröffentlichter Herstellerwert (Datenblatt, Spec-Sheet, Produktbeschreibung). Werte mit dem Hinweis „total / N“ sind aus System- bzw. Rack-Gesamtwerten abgeleitet.
- **Schätzung** — nicht offiziell veröffentlicht; abgeleitet aus öffentlichen Messungen, Branchenberichten oder vergleichbaren Produkten.
- **Annahme** — Modellparameter der Simulation; plausibel, aber keine nachschlagbare Eigenschaft realer Hardware.

Umfang: ${allCatalogItems().length + CATALOG.models.length} Einträge, ${total} Werte — ${counts.vendor} Hersteller, ${counts.estimate} Schätzung, ${counts.assumption} Annahme.
`;

writeFileSync(fileURLToPath(new URL('../docs/CATALOG.md', import.meta.url)), header + body);
console.log(`docs/CATALOG.md: ${total} values`);
