/**
 * Public surface of the simulation engine. Upper layers import from here only.
 */
export * from './sim/types';
export type {
  InfraSpec,
  HallSpec,
  RackTemplate,
  FabricSpec,
  SiteSpec,
  NodeOverrides,
  RackCooling,
  Redundancy,
  FabricTopology,
  RackSystemRef,
} from './model/spec';
export { INFRA_SPEC_VERSION } from './model/spec';
export {
  TEMPLATES,
  CLIMATE_PRESETS,
  buildTemplate,
  designInfrastructure,
  type InfraTemplate,
  type DesignInput,
  type ClimatePreset,
} from './model/templates';
export { validateInfra, type ValidationIssue, type ValidationReport } from './model/validate';
export { expandTopology, type Topology } from './model/topology';
export { deriveMetrics, type DerivedMetrics } from './model/derive';
export {
  Simulation,
  SIM_STATE_FORMAT,
  SIM_STATE_VERSION,
  SERIES_KEYS,
  type SimStateBlob,
  type SimulationOptions,
  type SeriesKey,
} from './sim/simulation';
export { EngineClient, type EngineMode } from './worker/client';
export type { ControlSettings, InitResult, QueryResultMap, PlanQueryResult } from './worker/protocol';
export { MAX_TIME_SCALE } from './worker/host';
