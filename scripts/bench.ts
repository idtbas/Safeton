/**
 * Engine benchmark: bundles scripts/bench-run.ts with esbuild and runs it.
 * Usage: npm run bench [-- <template-id>]
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'safeton-bench-'));
const outfile = join(dir, 'bench.mjs');
try {
  await build({
    entryPoints: [fileURLToPath(new URL('./bench-run.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile,
    logLevel: 'warning',
  });
  await import(pathToFileURL(outfile).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
