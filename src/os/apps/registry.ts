/**
 * Application registry. Applications (stage 3+) register a manifest; the window manager and
 * launcher only ever deal with manifests, never with app internals.
 */
import type { ComponentType, LazyExoticComponent } from 'react';

export type AppCategory = 'system' | 'infrastructure' | 'monitoring' | 'workloads' | 'tools';

export interface AppWindowProps {
  windowId: string;
  /** Launch arguments (e.g. the node to open in a detail view). */
  args?: Record<string, unknown>;
}

export interface AppManifest {
  id: string;
  title: string;
  /** lucide-react icon name. */
  icon: string;
  category: AppCategory;
  description: string;
  component: LazyExoticComponent<ComponentType<AppWindowProps>> | ComponentType<AppWindowProps>;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  /** At most one window of this app. */
  singleton: boolean;
  /** Search keywords for the system launcher. */
  keywords?: string[];
}

const registry = new Map<string, AppManifest>();

export function registerApp(manifest: AppManifest): void {
  if (registry.has(manifest.id)) throw new Error(`App "${manifest.id}" is already registered`);
  if (manifest.minSize.w > manifest.defaultSize.w || manifest.minSize.h > manifest.defaultSize.h) {
    throw new Error(`App "${manifest.id}": minimum size exceeds default size`);
  }
  registry.set(manifest.id, manifest);
}

export function getApp(id: string): AppManifest | undefined {
  return registry.get(id);
}

export function listApps(): AppManifest[] {
  return [...registry.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function unregisterApp(id: string): void {
  registry.delete(id);
}
