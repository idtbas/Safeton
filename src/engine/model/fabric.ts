/**
 * Backend (scale-out) fabric planning: folded-Clos / fat-tree sizing per plane.
 *
 * - `rail-optimized`: one independent fat-tree per rail. GPU i of every node connects to
 *   plane i, so ring/tree collectives between same-index GPUs stay within one plane
 *   (NVIDIA SuperPOD reference style).
 * - `fat-tree`: one plane; all adapters of a node land on the same leaf group.
 */
import type { SwitchSpec } from '../../catalog';
import type { FabricTopology } from './spec';

export interface FabricPlan {
  readonly topology: FabricTopology;
  readonly switchSpec: SwitchSpec | null;
  readonly planes: number;
  readonly endpointsPerPlane: number;
  readonly tiers: 0 | 1 | 2 | 3;
  readonly radix: number;
  readonly portSpeedGbps: number;
  readonly downPorts: number;
  readonly upPorts: number;
  readonly leavesPerPlane: number;
  /** 3-tier only: leaves per pod. */
  readonly leavesPerPod: number;
  readonly podsPerPlane: number;
  /** 2-tier: spines per plane. 3-tier: spines per pod. */
  readonly spinesPerGroup: number;
  readonly spinesPerPlane: number;
  readonly coreGroups: number;
  readonly coresPerGroup: number;
  readonly coresPerPlane: number;
  /** Effective leaf down:up bandwidth ratio. */
  readonly oversubscription: number;
  readonly error: string | null;
}

const EMPTY: Omit<FabricPlan, 'topology' | 'switchSpec' | 'planes' | 'endpointsPerPlane' | 'error'> = {
  tiers: 0,
  radix: 0,
  portSpeedGbps: 0,
  downPorts: 0,
  upPorts: 0,
  leavesPerPlane: 0,
  leavesPerPod: 0,
  podsPerPlane: 0,
  spinesPerGroup: 0,
  spinesPerPlane: 0,
  coreGroups: 0,
  coresPerGroup: 0,
  coresPerPlane: 0,
  oversubscription: 1,
};

export function planFabric(
  topology: FabricTopology,
  switchSpec: SwitchSpec | null,
  oversubscription: number,
  planes: number,
  endpointsPerPlane: number,
): FabricPlan {
  if (topology === 'none' || !switchSpec || endpointsPerPlane === 0 || planes === 0) {
    return { ...EMPTY, topology: 'none', switchSpec: null, planes: 0, endpointsPerPlane: 0, error: null };
  }
  const k = switchSpec.ports;
  const s = switchSpec.portSpeedGbps;
  const base = { topology, switchSpec, planes, endpointsPerPlane, radix: k, portSpeedGbps: s };

  if (endpointsPerPlane <= k) {
    return {
      ...EMPTY,
      ...base,
      tiers: 1,
      downPorts: k,
      upPorts: 0,
      leavesPerPlane: 1,
      oversubscription: 1,
      error: null,
    };
  }

  const r = Math.max(1, oversubscription);
  const down = Math.max(Math.ceil(k / 2), Math.min(k - 1, Math.floor((k * r) / (1 + r))));
  const up = k - down;
  const leaves = Math.ceil(endpointsPerPlane / down);
  const effectiveOversub = down / up;

  if (leaves <= k) {
    const spines = Math.max(1, Math.ceil((leaves * up) / k));
    return {
      ...EMPTY,
      ...base,
      tiers: 2,
      downPorts: down,
      upPorts: up,
      leavesPerPlane: leaves,
      leavesPerPod: leaves,
      podsPerPlane: 1,
      spinesPerGroup: spines,
      spinesPerPlane: spines,
      oversubscription: effectiveOversub,
      error: null,
    };
  }

  // Three tiers: pods of k/2 leaves, each pod with `up` aggregation spines (one port from every
  // leaf to every spine of its pod). Spine j of every pod connects to core group j.
  const leavesPerPod = Math.floor(k / 2);
  const pods = Math.ceil(leaves / leavesPerPod);
  const spinesPerPod = up;
  const spineUp = k - leavesPerPod;
  const coresPerGroup = Math.max(1, Math.ceil((pods * spineUp) / k));
  const error =
    pods > k
      ? `Fabric exceeds 3-tier fat-tree capacity: ${endpointsPerPlane} endpoints per plane need ${pods} pods, radix ${k} supports ${k}`
      : null;
  return {
    ...EMPTY,
    ...base,
    tiers: 3,
    downPorts: down,
    upPorts: up,
    leavesPerPlane: leaves,
    leavesPerPod,
    podsPerPlane: pods,
    spinesPerGroup: spinesPerPod,
    spinesPerPlane: spinesPerPod * pods,
    coreGroups: spinesPerPod,
    coresPerGroup,
    coresPerPlane: spinesPerPod * coresPerGroup,
    oversubscription: effectiveOversub,
    error,
  };
}

export function fabricSwitchCount(plan: FabricPlan): number {
  return plan.planes * (plan.leavesPerPlane + plan.spinesPerPlane + plan.coresPerPlane);
}

/** Cable latency: 5 ns per metre of fibre (assumption: typical run lengths per tier). */
export const CABLE_NS_PER_M = 5;
export const CABLE_LENGTH_M = { access: 3, leafSpine: 30, spineCore: 60 } as const;
