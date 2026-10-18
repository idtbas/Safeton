/**
 * Runtime validation schemas for everything that crosses a trust boundary: persisted
 * documents (may be stale or corrupt) and imported files (arbitrary user input).
 */
import { z } from 'zod';

const redundancy = z.enum(['N', 'N+1', 'N+2', '2N']);

export const nodeOverridesSchema = z
  .object({
    gpuPowerLimitW: z.number().positive().optional(),
    dimmId: z.string().optional(),
    dimmCount: z.number().int().nonnegative().optional(),
    dataDriveId: z.string().optional(),
    dataDriveCount: z.number().int().nonnegative().optional(),
    computeNicId: z.string().optional(),
    psuId: z.string().optional(),
    psuCount: z.number().int().positive().optional(),
  })
  .strict();

export const rackTemplateSchema = z.object({
  rackId: z.string(),
  cooling: z.enum(['air', 'rdhx', 'dlc']),
  system: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('platform'),
      platformId: z.string(),
      nodesPerRack: z.number().int().positive().max(64),
      overrides: nodeOverridesSchema.optional(),
    }),
    z.object({ kind: z.literal('rack-system'), rackSystemId: z.string(), overrides: nodeOverridesSchema.optional() }),
  ]),
  pdu: z.object({ pduId: z.string(), perFeed: z.number().int().positive().max(8), feeds: z.union([z.literal(1), z.literal(2)]) }),
});

export const infraSpecSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  templateId: z.string().nullable(),
  site: z.object({
    name: z.string(),
    code: z.string(),
    city: z.string(),
    country: z.string(),
    climate: z.object({ annualMeanC: z.number(), seasonalAmplitudeC: z.number(), diurnalAmplitudeC: z.number() }),
    utility: z.object({ feedMW: z.number().positive(), feeds: z.union([z.literal(1), z.literal(2)]) }),
    ups: z.object({ upsId: z.string(), modules: z.number().int().nonnegative(), redundancy }),
    generators: z.object({ count: z.number().int().nonnegative(), unitMW: z.number().nonnegative(), redundancy }),
    plant: z.object({
      chillerId: z.string(),
      chillers: z.number().int().nonnegative(),
      chillerRedundancy: redundancy,
      chilledWaterSupplyC: z.number(),
      dryCoolerId: z.string().nullable(),
      dryCoolers: z.number().int().nonnegative(),
      warmWaterSupplyC: z.number(),
      freeCooling: z.boolean(),
    }),
    energyPriceEurPerKWh: z.number().nonnegative(),
  }),
  halls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        rows: z.array(
          z.object({
            id: z.string(),
            rackGroups: z.array(z.object({ count: z.number().int().positive().max(20_000), template: rackTemplateSchema })),
          }),
        ),
        air: z.object({ unitId: z.string(), count: z.number().int().nonnegative(), redundancy, supplyC: z.number() }),
        liquid: z
          .object({ cduId: z.string(), count: z.number().int().nonnegative(), redundancy, supplyC: z.number() })
          .nullable(),
      }),
    )
    .min(1)
    .max(64),
  fabric: z.object({
    topology: z.enum(['rail-optimized', 'fat-tree', 'none']),
    switchId: z.string(),
    oversubscription: z.number().min(1).max(8),
  }),
  storage: z.object({ systemId: z.string(), count: z.number().int().nonnegative().max(1000) }),
  simulationStart: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid ISO date'),
});

export const simStateEnvelopeSchema = z
  .object({
    format: z.literal('safeton-sim-state'),
    version: z.number().int(),
    spec: infraSpecSchema,
    fingerprint: z.string(),
    seed: z.number(),
    dt: z.number().positive(),
    tick: z.number().int().nonnegative(),
    time: z.number(),
    rng: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    arrays: z.record(z.string(), z.record(z.string(), z.any())),
    jobs: z.array(z.any()),
  })
  .loose();

export const EXPORT_FORMAT = 'safeton-export';
export const EXPORT_VERSION = 1;

export const exportBundleSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int().positive(),
  exportedAt: z.string(),
  app: z.object({ version: z.string() }).loose(),
  settings: z.unknown().optional(),
  infra: z.unknown().optional(),
  simState: z.unknown().optional(),
});
