/**
 * Application registry. Applications register a manifest; the window manager, dock, launcher
 * and system search only ever deal with manifests, never with app internals.
 */
import type { ComponentType, LazyExoticComponent } from 'react';
import type { MessageKey } from '../i18n';

export type AppCategory = 'system' | 'infrastructure' | 'monitoring' | 'workloads' | 'tools';

export interface AppWindowProps {
  windowId: string;
  /** Launch arguments (e.g. the node to open in a detail view, a settings section). */
  args?: Record<string, unknown>;
}

export type AppIconComponent = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

export interface AppManifest {
  id: string;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  icon: AppIconComponent;
  /** OKLCH hue of the app icon tile. */
  hue: number;
  category: AppCategory;
  component: LazyExoticComponent<ComponentType<AppWindowProps>> | ComponentType<AppWindowProps>;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  /** At most one window of this app. */
  singleton: boolean;
  /** Search keywords for the system search (language-neutral technical terms). */
  keywords?: string[];
  /** Hidden from launcher and desktop (utility windows such as “About”). */
  hidden?: boolean;
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

/** Registered apps in registration order (the order the system presents them in). */
export function listApps(): AppManifest[] {
  return [...registry.values()];
}

export function unregisterApp(id: string): void {
  registry.delete(id);
}
