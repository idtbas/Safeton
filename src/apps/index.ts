/**
 * Built-in applications. Components are loaded on first launch (code splitting), so the
 * desktop starts fast and every app arrives as its own module.
 */
import { Activity, Building2, Info, ScrollText, Server, ServerCog, Settings, Workflow } from 'lucide-react';
import { lazy } from 'react';
import { registerApp, type AppManifest } from '../os/apps/registry';

export const APP_MANIFESTS: AppManifest[] = [
  {
    id: 'monitor',
    titleKey: 'app.monitor.title',
    descriptionKey: 'app.monitor.desc',
    icon: Activity,
    hue: 195,
    category: 'monitoring',
    component: lazy(() => import('./monitor/MonitorApp').then((m) => ({ default: m.MonitorApp }))),
    defaultSize: { w: 1120, h: 720 },
    minSize: { w: 680, h: 420 },
    singleton: true,
    keywords: ['monitor', 'kpi', 'pue', 'power', 'simulation', 'telemetry', 'dashboard'],
  },
  {
    id: 'cluster',
    titleKey: 'app.cluster.title',
    descriptionKey: 'app.cluster.desc',
    icon: Server,
    hue: 235,
    category: 'infrastructure',
    component: lazy(() => import('./cluster/ClusterApp').then((m) => ({ default: m.ClusterApp }))),
    defaultSize: { w: 1180, h: 760 },
    minSize: { w: 720, h: 460 },
    singleton: true,
    keywords: ['nodes', 'fleet', 'server', 'gpu', 'rack', 'drain', 'reboot', 'maintenance'],
  },
  {
    id: 'workloads',
    titleKey: 'app.workloads.title',
    descriptionKey: 'app.workloads.desc',
    icon: Workflow,
    hue: 285,
    category: 'workloads',
    component: lazy(() => import('./workloads/WorkloadsApp').then((m) => ({ default: m.WorkloadsApp }))),
    defaultSize: { w: 1180, h: 720 },
    minSize: { w: 760, h: 460 },
    singleton: true,
    keywords: ['jobs', 'training', 'inference', 'scheduler', 'mfu', 'llm'],
  },
  {
    id: 'facility',
    titleKey: 'app.facility.title',
    descriptionKey: 'app.facility.desc',
    icon: Building2,
    hue: 155,
    category: 'infrastructure',
    component: lazy(() => import('./facility/FacilityApp').then((m) => ({ default: m.FacilityApp }))),
    defaultSize: { w: 1080, h: 700 },
    minSize: { w: 700, h: 440 },
    singleton: true,
    keywords: ['facility', 'cooling', 'chiller', 'crah', 'cdu', 'hall', 'template', 'pue', 'ups'],
  },
  {
    id: 'events',
    titleKey: 'app.events.title',
    descriptionKey: 'app.events.desc',
    icon: ScrollText,
    hue: 70,
    category: 'monitoring',
    component: lazy(() => import('./events/EventsApp').then((m) => ({ default: m.EventsApp }))),
    defaultSize: { w: 1040, h: 640 },
    minSize: { w: 640, h: 380 },
    singleton: true,
    keywords: ['log', 'events', 'syslog', 'xid', 'alarm'],
  },
  {
    id: 'settings',
    titleKey: 'app.settings.title',
    descriptionKey: 'app.settings.desc',
    icon: Settings,
    hue: 250,
    category: 'system',
    component: lazy(() => import('./settings/SettingsApp').then((m) => ({ default: m.SettingsApp }))),
    defaultSize: { w: 920, h: 660 },
    minSize: { w: 680, h: 420 },
    singleton: true,
    keywords: ['preferences', 'config', 'theme', 'wallpaper', 'password', 'backup', 'export'],
  },
  {
    id: 'node',
    titleKey: 'app.node.title',
    descriptionKey: 'app.node.desc',
    icon: ServerCog,
    hue: 235,
    category: 'infrastructure',
    component: lazy(() => import('./cluster/NodeApp').then((m) => ({ default: m.NodeApp }))),
    defaultSize: { w: 980, h: 700 },
    minSize: { w: 640, h: 420 },
    singleton: false,
    hidden: true,
  },
  {
    id: 'about',
    titleKey: 'app.about.title',
    descriptionKey: 'app.about.desc',
    icon: Info,
    hue: 210,
    category: 'system',
    component: lazy(() => import('./about/AboutApp').then((m) => ({ default: m.AboutApp }))),
    defaultSize: { w: 520, h: 640 },
    minSize: { w: 440, h: 480 },
    singleton: true,
    hidden: true,
  },
];

let registered = false;
export function registerBuiltinApps(): void {
  if (registered) return;
  registered = true;
  for (const m of APP_MANIFESTS) registerApp(m);
}
