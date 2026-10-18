/**
 * Application manifests. Stage 1 ships the registry interface only; the applications
 * (terminal, monitors, managers, configurator, settings, …) arrive in later stages.
 */
import { registerApp, type AppManifest } from '../os/apps/registry';

export const APP_MANIFESTS: AppManifest[] = [];

let registered = false;
export function registerBuiltinApps(): void {
  if (registered) return;
  registered = true;
  for (const m of APP_MANIFESTS) registerApp(m);
}
